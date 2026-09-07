import type { Repo } from '../../shared/repo-types'
import { isJjRepo } from '../../shared/repo-kind'
import {
  getRepoExecutionHostId,
  getRepoSshConnectionId,
  LOCAL_EXECUTION_HOST_ID
} from '../../shared/execution-host'
import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'
import { parseWslUncPath, toWindowsWslPath, toWslExecutionSpace } from '../../shared/wsl-paths'
import { mapWithConcurrency } from '../../shared/map-with-concurrency'
import type { JjBackend, JjExecutionTarget, JjFailure, JjWorkspace } from '../../shared/jj-types'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import type { Store } from '../persistence'
import { createJjBackend } from './jj-backend'
import { getSshJjProvider } from '../providers/ssh-jj-dispatch'
import {
  readWorktreeMetaForHost,
  writeWorktreeMetaForHost
} from '../persistence/host-qualified-worktree-meta'
import { listStoredWorktreeRowsForRepo } from '../runtime/repo-worktree-row-resolution'

export type JjWorkspaceCatalogResult =
  | {
      provider: 'jj'
      ok: true
      complete: boolean
      workspaces: JjWorkspace[]
      resolvedRoots: ReadonlySet<string>
    }
  | ({ provider: 'jj'; ok: false; complete: false; workspaces: JjWorkspace[] } & JjFailure)

export type JjWorkspaceListOptions = {
  wslDistro?: string
  signal?: AbortSignal
}

export async function listJjWorktreesForRepo(
  repo: Repo,
  options: JjWorkspaceListOptions = {}
): Promise<GitWorktreeInfo[]> {
  const result = await listJjWorkspacesForRepo(repo, options)
  if (!result.ok) {
    throw new Error(result.message)
  }
  if (!result.complete) {
    throw new Error('jj workspace roots are incomplete')
  }
  return result.workspaces.flatMap((workspace) =>
    workspace.root
      ? [
          {
            path: workspace.root,
            head: '',
            branch: '',
            isBare: false,
            // jj has no immutable primary-workspace role; names are user-renamable labels.
            isMainWorktree: false,
            jjWorkspace: { name: workspace.name, root: workspace.root, rootResolved: true }
          }
        ]
      : []
  )
}

/** Lists jj through the execution host that owns the repo; never falls through to Git. */
export async function listJjWorkspacesForRepo(
  repo: Repo,
  options: JjWorkspaceListOptions = {}
): Promise<JjWorkspaceCatalogResult> {
  if (!isJjRepo(repo)) {
    throw new Error(`Cannot list jj workspaces for non-jj repo ${repo.id}`)
  }
  try {
    const backendResult = await jjBackendForRepo(repo, options).listWorkspaces(options)
    if (!backendResult.ok) {
      return { ...backendResult, provider: 'jj', complete: false, workspaces: [] }
    }
    const workspaces = backendResult.workspaces.map((workspace) => ({
      ...workspace,
      root: normalizeObservedRoot(repo, workspace.root, options.wslDistro)
    }))
    const resolvedRoots = await verifyWorkspaceRoots(repo, workspaces, options)
    const rootsVerified =
      workspaces.length > 0 &&
      workspaces.every((workspace) => workspace.root !== null && resolvedRoots.has(workspace.root))
    return {
      provider: 'jj',
      ok: true,
      complete: rootsVerified,
      workspaces,
      resolvedRoots
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      provider: 'jj',
      ok: false,
      complete: false,
      kind: 'error',
      message,
      workspaces: []
    }
  }
}

/**
 * Physical deletion is allowed only when the target cannot remove the structural store or a
 * different registered workspace. Forget-only deliberately skips this check: it changes JJ's
 * registration but does not recursively delete a filesystem tree.
 */
export function assertJjWorkspaceCanBePhysicallyDeleted(
  targetRoot: string,
  ownerRoot: string,
  workspaces: readonly JjWorkspace[]
): void {
  if (
    normalizeRuntimePathForComparison(targetRoot) === normalizeRuntimePathForComparison(ownerRoot)
  ) {
    throw new Error('Refusing to delete the structural JJ repository owner workspace.')
  }
  if (isPathInsideOrEqual(targetRoot, ownerRoot)) {
    throw new Error(
      'Refusing to delete a JJ workspace that contains the structural repository store.'
    )
  }
  const nestedWorkspace = workspaces.find(
    (workspace) =>
      workspace.root &&
      normalizeRuntimePathForComparison(workspace.root) !==
        normalizeRuntimePathForComparison(targetRoot) &&
      isPathInsideOrEqual(targetRoot, workspace.root)
  )
  if (nestedWorkspace?.root) {
    throw new Error(
      `Refusing to delete a JJ workspace because it contains another registered workspace: ${nestedWorkspace.root}`
    )
  }
}

/** Converts jj observations to legacy rows without mutating metadata or pruning stored rows. */
export function buildJjWorktreeInfos(
  store: Store,
  repo: Repo,
  result: JjWorkspaceCatalogResult
): GitWorktreeInfo[] {
  const fallback = listStoredWorktreeRowsForRepo(store, repo)
  const byPath = new Map(
    fallback.map((worktree) => [
      normalizeRuntimePathForComparison(worktree.path),
      {
        ...worktree,
        // A successful JJ listing owns role truth; never promote a persisted path-equal row when the default root is unresolved.
        isMainWorktree: result.ok ? false : worktree.isMainWorktree,
        jjWorkspace: worktree.jjWorkspace
          ? { ...worktree.jjWorkspace, rootResolved: false }
          : { name: '', root: worktree.path, rootResolved: false }
      }
    ])
  )
  const resolvedRoots = result.ok ? result.resolvedRoots : undefined
  for (const workspace of result.workspaces) {
    const path = workspace.root
    if (!path) {
      continue
    }
    const key = normalizeRuntimePathForComparison(path)
    byPath.set(key, {
      path,
      head: '',
      branch: '',
      isBare: false,
      // jj has no immutable primary-workspace role; names are user-renamable labels.
      isMainWorktree: false,
      jjWorkspace: {
        name: workspace.name,
        root: path,
        rootResolved: resolvedRoots?.has(path) ?? false
      }
    })
  }
  return [...byPath.values()]
}

/** Persist only a fresh, complete jj observation after the caller's freshness guard passes. */
export function persistJjWorktreeMetadata(
  store: Store,
  repo: Repo,
  result: JjWorkspaceCatalogResult
): void {
  if (!result.ok || !result.complete) {
    return
  }
  const executionHostId = getRepoExecutionHostId(repo)
  for (const workspace of result.workspaces) {
    if (!workspace.root) {
      continue
    }
    const worktreeId = `${repo.id}::${workspace.root}`
    const nextJjWorkspace = { name: workspace.name, root: workspace.root, rootResolved: true }
    const hostMeta = readWorktreeMetaForHost(store, worktreeId, executionHostId)
    const legacyMeta = !store.getWorktreeMetaForHost
      ? store.getWorktreeMeta?.(worktreeId)
      : undefined
    const current = hostMeta?.jjWorkspace ?? legacyMeta?.jjWorkspace
    if (
      current?.name === nextJjWorkspace.name &&
      current.root === nextJjWorkspace.root &&
      current.rootResolved === nextJjWorkspace.rootResolved
    ) {
      continue
    }
    writeWorktreeMetaForHost(store, worktreeId, executionHostId, { jjWorkspace: nextJjWorkspace })
  }
}

function normalizeObservedRoot(repo: Repo, root: string | null, wslDistro?: string): string | null {
  if (!root) {
    return null
  }
  const repoWsl = parseWslUncPath(repo.path)
  return repoWsl && wslDistro && !parseWslUncPath(root) ? toWindowsWslPath(root, wslDistro) : root
}

async function verifyWorkspaceRoots(
  repo: Repo,
  workspaces: JjWorkspace[],
  options: JjWorkspaceListOptions
): Promise<Set<string>> {
  const ownerBackend = jjBackendForRepo(repo, options)
  const ownerDetection = await ownerBackend.detect(options)
  const ownerIdentity = ownerDetection.ok
    ? canonicalRepositoryIdentity(ownerDetection.repositoryIdentity)
    : null
  if (!ownerIdentity) {
    return new Set()
  }
  const targetDistro = options.wslDistro
  const roots = workspaces
    .map((workspace) => workspace.root)
    .filter((root): root is string => root !== null)
  const checks = await mapWithConcurrency<string, string | null>(roots, 4, async (root) => {
    try {
      const sshConnectionId = getRepoSshConnectionId(repo)
      const detection = sshConnectionId
        ? await getSshJjProvider(sshConnectionId)?.detect(root, options)
        : await createJjBackend(
            targetDistro
              ? { kind: 'wsl', cwd: toWslExecutionSpace(root), distro: targetDistro }
              : { kind: 'native', cwd: root }
          ).detect(options)
      if (!detection?.ok) {
        return null
      }
      const candidateIdentity = canonicalRepositoryIdentity(detection.repositoryIdentity)
      if (candidateIdentity !== ownerIdentity) {
        return null
      }
      return root
    } catch {
      // A root that cannot be checked is unresolved, never authoritative.
      return null
    }
  })
  return new Set(checks.filter((root): root is string => root !== null))
}

function canonicalRepositoryIdentity(identity: string | null | undefined): string | null {
  return identity ? normalizeRuntimePathForComparison(identity) : null
}

export function jjBackendForRepo(repo: Repo, options: JjWorkspaceListOptions = {}): JjBackend {
  const hostId = getRepoExecutionHostId(repo)
  const sshConnectionId = getRepoSshConnectionId(repo)
  if (hostId === LOCAL_EXECUTION_HOST_ID) {
    const target: JjExecutionTarget = options.wslDistro
      ? { kind: 'wsl', cwd: toWslExecutionSpace(repo.path), distro: options.wslDistro }
      : { kind: 'native', cwd: repo.path }
    return createJjBackend(target)
  }
  if (sshConnectionId) {
    const provider = getSshJjProvider(sshConnectionId)
    if (!provider) {
      throw new Error(`SSH jj provider unavailable for ${sshConnectionId}`)
    }
    return {
      detect: (commandOptions) => provider.detect(repo.path, { ...options, ...commandOptions }),
      listWorkspaces: (commandOptions) =>
        provider.listWorkspaces(repo.path, { ...options, ...commandOptions }),
      addWorkspace: (input) => provider.addWorkspace(repo.path, input, options),
      removeWorkspace: (input) => provider.removeWorkspace(repo.path, input, options),
      listChanges: () => provider.listChanges(repo.path, options),
      readFileDiff: (input) => provider.readFileDiff(repo.path, input, options),
      getCurrentChangeMetadata: () => provider.getCurrentChangeMetadata(repo.path, options),
      listLocalBookmarks: () => provider.listLocalBookmarks(repo.path, options),
      listRemotes: () => provider.listRemotes(repo.path, options),
      fetchRemote: (input) => provider.fetchRemote(repo.path, input, options),
      pushBookmark: (input) => provider.pushBookmark(repo.path, input, options),
      describe: (input) => provider.describe(repo.path, input, options),
      createBookmark: (input) => provider.createBookmark(repo.path, input, options),
      moveBookmark: (input) => provider.moveBookmark(repo.path, input, options),
      commit: (input) => provider.commit(repo.path, input, options),
      updateWorkspaceStale: () => provider.updateWorkspaceStale(repo.path, options)
    }
  }
  throw new Error(`Jj execution host ${hostId} is unavailable from this process`)
}
