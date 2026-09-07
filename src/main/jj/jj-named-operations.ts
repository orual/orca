import { normalize, sep } from 'node:path'
import type {
  JjCommandOptions,
  JjCurrentChangeMetadata,
  JjCurrentChangeMetadataResult,
  JjDetection,
  JjExecutor,
  JjLocalBookmark,
  JjLocalBookmarksResult,
  JjRemote,
  JjRemoteListResult,
  JjWorkspace,
  JjWorkspaceListOptions,
  JjWorkspaceListResult
} from '../../shared/jj-types'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import {
  compareVersion,
  failureForProcess,
  failureForThrown,
  isSuccessful,
  parseJjVersion,
  text,
  JJ_MINIMUM_VERSION
} from './jj-output-parsing'
import {
  CURRENT_CHANGE_TEMPLATE,
  JJ_COMMAND_TIMEOUT_MS,
  JJ_MAX_OUTPUT_BYTES,
  LOCAL_BOOKMARK_TEMPLATE,
  WORKSPACE_TEMPLATE
} from './jj-operation-context'

export async function detectJj(
  run: JjExecutor,
  options: JjCommandOptions = {}
): Promise<JjDetection> {
  const commandOptions = {
    timeoutMs: options.timeoutMs ?? JJ_COMMAND_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {})
  }
  try {
    const versionResult = await run({ args: ['--version'], ...commandOptions })
    if (!isSuccessful(versionResult)) {
      return failureForProcess(versionResult, 'jj detection')
    }
    const version = parseJjVersion(text(versionResult.stdout))
    if (!version) {
      return { ok: false, kind: 'unsupported', message: 'jj returned an unrecognized version.' }
    }
    if (compareVersion(version, [0, 44, 0]) < 0) {
      return {
        ok: false,
        kind: 'unsupported',
        message: `jj ${version.version} is unsupported; jj ${JJ_MINIMUM_VERSION} or newer is required.`
      }
    }
    const rootResult = await run({ args: ['--ignore-working-copy', 'root'], ...commandOptions })
    if (!isSuccessful(rootResult)) {
      return failureForProcess(rootResult, 'jj repository detection')
    }
    const root = text(rootResult.stdout).trim()
    if (!root) {
      return { ok: false, kind: 'stale', message: 'jj returned an empty repository root.' }
    }
    const gitRootResult = await run({
      args: ['--ignore-working-copy', 'git', 'root'],
      ...commandOptions
    })
    const gitRoot = isSuccessful(gitRootResult) ? text(gitRootResult.stdout).trim() : null
    const normalizedRoot = normalize(root)
    const normalizedGitRoot = gitRoot ? normalize(gitRoot) : null
    const colocated = normalizedGitRoot === normalize(`${normalizedRoot}${sep}.git`)
    return {
      ok: true,
      ...version,
      root,
      colocated,
      repositoryIdentity: normalizedGitRoot
    }
  } catch (error) {
    return failureForThrown(error, 'jj detection')
  }
}

export async function listWorkspaces(
  run: JjExecutor,
  options: JjWorkspaceListOptions = {}
): Promise<JjWorkspaceListResult> {
  try {
    const result = await run({
      args: ['--ignore-working-copy', 'workspace', 'list', '--template', WORKSPACE_TEMPLATE],
      timeoutMs: options.timeoutMs ?? JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES,
      ...(options.signal ? { signal: options.signal } : {})
    })
    if (!isSuccessful(result)) {
      return failureForProcess(result, 'jj workspace list')
    }
    const workspaces: JjWorkspace[] = []
    for (const line of text(result.stdout).split(/\r?\n/)) {
      if (!line) {
        continue
      }
      const separator = line.indexOf('\t')
      if (separator < 1) {
        return { ok: false, kind: 'error', message: 'jj workspace list returned malformed output.' }
      }
      try {
        const name = JSON.parse(line.slice(0, separator))
        const root = JSON.parse(line.slice(separator + 1))
        if (typeof name !== 'string' || (root !== null && typeof root !== 'string')) {
          throw new Error('invalid workspace fields')
        }
        workspaces.push({ name, root })
      } catch {
        return { ok: false, kind: 'error', message: 'jj workspace list returned malformed output.' }
      }
    }
    return { ok: true, workspaces }
  } catch (error) {
    return failureForThrown(error, 'jj workspace list')
  }
}

export async function getCurrentChangeMetadata(
  run: JjExecutor
): Promise<JjCurrentChangeMetadataResult> {
  try {
    const result = await run({
      args: ['log', '--no-graph', '--revisions', '@', '--template', CURRENT_CHANGE_TEMPLATE],
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    if (!isSuccessful(result)) {
      return failureForProcess(result, 'jj current change metadata')
    }
    const fields = text(result.stdout).trimEnd().split('\t')
    if (fields.length !== 5) {
      return {
        ok: false,
        kind: 'error',
        message: 'jj current change metadata returned malformed output.'
      }
    }
    const [commitJson, changeJson, descriptionJson, conflictedJson, bookmarksJson] = fields
    const commitId = JSON.parse(commitJson ?? 'null')
    const changeId = JSON.parse(changeJson ?? 'null')
    const description = JSON.parse(descriptionJson ?? 'null')
    const conflicted = JSON.parse(conflictedJson ?? 'null')
    const bookmarks = JSON.parse(bookmarksJson ?? 'null')
    if (
      typeof commitId !== 'string' ||
      !commitId ||
      typeof changeId !== 'string' ||
      !changeId ||
      typeof description !== 'string' ||
      typeof conflicted !== 'boolean' ||
      !Array.isArray(bookmarks)
    ) {
      throw new Error('invalid current change fields')
    }
    const parsedBookmarks = bookmarks.map((bookmark) => {
      if (!bookmark || typeof bookmark !== 'object' || typeof bookmark.name !== 'string') {
        throw new Error('invalid bookmark')
      }
      return { name: bookmark.name, readOnly: true as const }
    })
    const rootResult = await run({
      args: ['root'],
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    if (!isSuccessful(rootResult)) {
      return failureForProcess(rootResult, 'jj workspace root')
    }
    const root = text(rootResult.stdout).trim()
    if (!root) {
      return { ok: false, kind: 'stale', message: 'jj returned an empty workspace root.' }
    }
    const workspaces = await listWorkspaces(run)
    if (!workspaces.ok) {
      return workspaces
    }
    const workspaceRoot = normalizeRuntimePathForComparison(root)
    const workspace = workspaces.workspaces.find(
      (entry) =>
        entry.root !== null && normalizeRuntimePathForComparison(entry.root) === workspaceRoot
    )
    const metadata: JjCurrentChangeMetadata = {
      commitId,
      changeId,
      description,
      bookmarks: parsedBookmarks,
      conflicted,
      workspaceName: workspace?.name ?? null
    }
    return { ok: true, metadata }
  } catch (error) {
    return failureForThrown(error, 'jj current change metadata')
  }
}

export async function listLocalBookmarks(run: JjExecutor): Promise<JjLocalBookmarksResult> {
  try {
    const result = await run({
      args: ['--ignore-working-copy', 'bookmark', 'list', '--template', LOCAL_BOOKMARK_TEMPLATE],
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    if (!isSuccessful(result)) {
      return failureForProcess(result, 'jj bookmark list')
    }
    const bookmarks: JjLocalBookmark[] = []
    for (const line of text(result.stdout).split(/\r?\n/)) {
      if (!line) {
        continue
      }
      const separator = line.indexOf('\t')
      if (separator < 1) {
        return { ok: false, kind: 'error', message: 'jj bookmark list returned malformed output.' }
      }
      try {
        const name = JSON.parse(line.slice(0, separator))
        const commitId = JSON.parse(line.slice(separator + 1))
        if (typeof name !== 'string' || (commitId !== null && typeof commitId !== 'string')) {
          throw new Error('invalid bookmark fields')
        }
        bookmarks.push({ name, commitId })
      } catch {
        return { ok: false, kind: 'error', message: 'jj bookmark list returned malformed output.' }
      }
    }
    return { ok: true, bookmarks }
  } catch (error) {
    return failureForThrown(error, 'jj bookmark list')
  }
}

export async function listRemotes(run: JjExecutor): Promise<JjRemoteListResult> {
  try {
    const result = await run({
      args: ['--ignore-working-copy', 'git', 'remote', 'list'],
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    if (!isSuccessful(result)) {
      return failureForProcess(result, 'jj git remote list')
    }
    const remotes: JjRemote[] = []
    for (const line of text(result.stdout).split(/\r?\n/)) {
      if (!line.trim()) {
        continue
      }
      const separator = line.indexOf('\t')
      if (separator <= 0) {
        return {
          ok: false,
          kind: 'error',
          message: 'jj git remote list returned malformed output.'
        }
      }
      const name = line.slice(0, separator)
      const url = line.slice(separator + 1)
      if (!name || !url || name.startsWith('-')) {
        return { ok: false, kind: 'error', message: 'jj git remote list returned invalid output.' }
      }
      remotes.push({ name, url })
    }
    return { ok: true, remotes }
  } catch (error) {
    return failureForThrown(error, 'jj git remote list')
  }
}

export type NamedJjOperations = {
  detect: typeof detectJj
  listWorkspaces: typeof listWorkspaces
  getCurrentChangeMetadata: typeof getCurrentChangeMetadata
  listLocalBookmarks: typeof listLocalBookmarks
  listRemotes: typeof listRemotes
}
