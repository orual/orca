import type {
  JjBookmarkMutationInput,
  JjBookmarkMutationResult,
  JjCommitInput,
  JjCommitResult,
  JjDescribeInput,
  JjDescribeResult,
  JjExecutor
} from '../../shared/jj-types'
import { listJjChanges } from './jj-change-listing'
import { getCurrentChangeMetadata, listLocalBookmarks } from './jj-named-operations'
import {
  JJ_COMMAND_TIMEOUT_MS,
  JJ_MAX_OUTPUT_BYTES,
  mutationResult,
  uncertainMutation
} from './jj-operation-context'

export async function describeCurrentChange(
  run: JjExecutor,
  input: JjDescribeInput
): Promise<JjDescribeResult> {
  if (!input.expectedCommitId) {
    return { ok: false, kind: 'stale', message: 'A full expected commit ID is required.' }
  }
  try {
    const current = await getCurrentChangeMetadata(run)
    if (!current.ok) {
      return current
    }
    if (current.metadata.commitId !== input.expectedCommitId) {
      return {
        ok: false,
        kind: 'stale',
        message: 'The jj working copy changed; refresh before describing.'
      }
    }
    const result = await run({
      args: ['describe', '--message', input.message, input.expectedCommitId],
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    return mutationResult(result, 'jj describe')
  } catch (error) {
    return uncertainMutation('jj describe', error)
  }
}

export async function mutateBookmark(
  run: JjExecutor,
  operation: 'create' | 'move',
  input: JjBookmarkMutationInput
): Promise<JjBookmarkMutationResult> {
  if (!input.expectedCommitId) {
    return { ok: false, kind: 'stale', message: 'A full expected commit ID is required.' }
  }
  if (!input.name || input.name.includes('\0')) {
    return { ok: false, kind: 'error', message: 'A bookmark name is required.' }
  }
  try {
    const current = await getCurrentChangeMetadata(run)
    if (!current.ok) {
      return current
    }
    if (current.metadata.commitId !== input.expectedCommitId) {
      return {
        ok: false,
        kind: 'stale',
        message: 'The jj working copy changed; refresh before bookmarking.'
      }
    }
    if (current.metadata.conflicted) {
      return {
        ok: false,
        kind: 'stale',
        message:
          'Cannot mutate a bookmark while the current jj change is conflicted; resolve it first.'
      }
    }
    if (operation === 'move') {
      const listed = await listLocalBookmarks(run)
      if (!listed.ok) {
        return listed
      }
      const bookmark = listed.bookmarks.find((entry) => entry.name === input.name)
      if (!bookmark) {
        return { ok: false, kind: 'stale', message: `Local bookmark not found: ${input.name}` }
      }
      if (bookmark.commitId === null) {
        return { ok: false, kind: 'stale', message: `Local bookmark is conflicted: ${input.name}` }
      }
    }
    const args =
      operation === 'create'
        ? ['bookmark', 'create', '--revision', input.expectedCommitId, '--', input.name]
        : ['bookmark', 'move', `exact:${input.name}`, '--to', input.expectedCommitId]
    const result = await run({
      args,
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    return mutationResult(result, `jj bookmark ${operation}`)
  } catch (error) {
    return uncertainMutation(`jj bookmark ${operation}`, error)
  }
}

export async function commitJj(run: JjExecutor, input: JjCommitInput): Promise<JjCommitResult> {
  if (!input.expectedCommitId) {
    return { ok: false, kind: 'stale', message: 'A full expected commit ID is required.' }
  }
  if (!input.message) {
    return { ok: false, kind: 'error', message: 'A commit message is required.' }
  }
  if (input.intent.kind === 'selected' && input.intent.paths.length === 0) {
    return {
      ok: false,
      kind: 'stale',
      message: 'Select at least one current change before committing.'
    }
  }
  const initial = await getCurrentChangeMetadata(run)
  if (!initial.ok) {
    return initial
  }
  if (initial.metadata.commitId !== input.expectedCommitId) {
    return {
      ok: false,
      kind: 'stale',
      message: 'The jj working copy changed; refresh before committing.'
    }
  }
  let filesets: string[] = []
  if (input.intent.kind === 'selected') {
    const changes = await listJjChanges(run)
    if (!changes.ok) {
      return changes
    }
    const selected = new Set(input.intent.paths)
    const matched = new Set<string>()
    for (const change of changes.changes) {
      if (
        selected.has(change.path) ||
        (change.originalPath !== undefined && selected.has(change.originalPath))
      ) {
        matched.add(change.path)
        if (change.originalPath !== undefined) {
          matched.add(change.originalPath)
        }
      }
    }
    const unmatched = [...selected].filter((path) => !matched.has(path))
    if (unmatched.length > 0) {
      return {
        ok: false,
        kind: 'stale',
        message: `Selected jj paths are stale or not changed: ${unmatched.join(', ')}`
      }
    }
    filesets = [...matched].map((path) => `file:${JSON.stringify(path)}`)
  }
  // Re-read identity after selection validation; this is not a CAS against external jj writers.
  const current = await getCurrentChangeMetadata(run)
  if (!current.ok) {
    return current
  }
  if (current.metadata.commitId !== input.expectedCommitId) {
    return {
      ok: false,
      kind: 'stale',
      message: 'The jj working copy changed; refresh before committing.'
    }
  }
  const args = ['commit', '-m', input.message, ...(filesets.length > 0 ? ['--', ...filesets] : [])]
  try {
    const result = await run({
      args,
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    return mutationResult(result, 'jj commit')
  } catch (error) {
    return uncertainMutation('jj commit', error)
  }
}
