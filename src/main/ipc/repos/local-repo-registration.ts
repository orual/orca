import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { dirname, join, win32 } from 'node:path'
import type { Store } from '../../persistence'
import type { JjDetection } from '../../../shared/jj-types'
import type { Repo, RepoKind } from '../../../shared/repo-types'
import { isFolderRepo } from '../../../shared/repo-kind'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../shared/constants'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { parseWslUncPath, toWindowsWslPath } from '../../../shared/wsl-paths'
import { awaitWindowsHostGitEnvironmentReady } from '../../git/runner'
import {
  isGitRepo,
  getGitRepoRoot,
  getLinkedWorktreeMainRepoRoot,
  getRepoName
} from '../../git/repo'
import { createJjBackend } from '../../jj/jj-backend'
import { findJjOwnerWorkspaceRoot } from '../../jj/jj-operations'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../shared/execution-host'
import { detectRepoIconAndUpstream } from '../../repo-icon-autodetect'
import { prepareLocalWorktreeRootForRepo } from '../../worktree-root-preparation'
import { mapWithConcurrency } from '../../../shared/map-with-concurrency'

export type LocalJjRepoProbe =
  | { kind: 'not-jj' }
  | {
      kind: 'jj'
      root: string
      /** The workspace root whose `.jj/repo` marker proves it owns the shared store. */
      ownerRoot: string | null
      detection: Extract<JjDetection, { ok: true }>
    }
  | { kind: 'unavailable'; error: string }

type LocalJjMarkerProbe =
  | { kind: 'present'; path: string }
  | { kind: 'absent' }
  | { kind: 'unavailable'; error: string }

const JJ_MARKER_ANCESTOR_LIMIT = 8

function isMissingMarkerError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function localAncestor(path: string): string {
  const parsedWsl = parseWslUncPath(path)
  if (!parsedWsl) {
    return dirname(path)
  }
  const linuxParent = dirname(parsedWsl.linuxPath)
  return toWindowsWslPath(linuxParent, parsedWsl.distro)
}

/** Scan a bounded owner-local ancestor chain; only ENOENT/ENOTDIR prove absence. */
export async function probeLocalJjMarker(path: string): Promise<LocalJjMarkerProbe> {
  let current = path
  for (let depth = 0; depth <= JJ_MARKER_ANCESTOR_LIMIT; depth += 1) {
    try {
      const marker = await stat(join(current, '.jj'))
      if (marker.isDirectory() || marker.isFile()) {
        return { kind: 'present', path: current }
      }
    } catch (error) {
      if (!isMissingMarkerError(error)) {
        return {
          kind: 'unavailable',
          error: `Jujutsu repository unavailable while checking ${join(current, '.jj')}: ${
            error instanceof Error ? error.message : String(error)
          }`
        }
      }
    }
    const parent = localAncestor(current)
    if (
      parent === current ||
      (parseWslUncPath(current) && win32.normalize(parent) === win32.normalize(current))
    ) {
      break
    }
    current = parent
  }
  return { kind: 'absent' }
}

/** Probe jj on the local owner, never falling through to Git after a .jj marker. */
export async function probeLocalJjRepo(path: string, force = false): Promise<LocalJjRepoProbe> {
  const marker = await probeLocalJjMarker(path)
  if (marker.kind === 'unavailable') {
    return { kind: 'unavailable', error: marker.error }
  }
  if (marker.kind === 'absent' && !force) {
    return { kind: 'not-jj' }
  }

  const wsl = parseWslUncPath(path)
  const backend = createJjBackend(
    wsl ? { kind: 'wsl', cwd: wsl.linuxPath, distro: wsl.distro } : { kind: 'native', cwd: path }
  )
  const detection = await backend.detect()
  if (!detection.ok) {
    return { kind: 'unavailable', error: `Jujutsu repository unavailable: ${detection.message}` }
  }
  const root = wsl ? toWindowsWslPath(detection.root, wsl.distro) : detection.root
  const workspaces = await backend.listWorkspaces()
  const ownerRoot = workspaces.ok
    ? await findJjOwnerWorkspaceRoot(workspaces.workspaces, async (workspaceRoot) => {
        const visibleRoot =
          wsl && !parseWslUncPath(workspaceRoot)
            ? toWindowsWslPath(workspaceRoot, wsl.distro)
            : workspaceRoot
        try {
          return (await stat(join(visibleRoot, '.jj', 'repo'))).isDirectory()
        } catch {
          return false
        }
      })
    : null
  return {
    kind: 'jj',
    root,
    ownerRoot,
    detection
  }
}

export function getJjImportIdentityKey(
  identity: string | null | undefined,
  executionHostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID
): string | null {
  return identity ? `${executionHostId}:${normalizeRuntimePathForComparison(identity)}` : null
}

export async function findImportedJjRepo(args: {
  repos: readonly Repo[]
  identity: string | null | undefined
  executionHostId?: ExecutionHostId
  detectIdentity: (repo: Repo) => Promise<string | null | undefined>
}): Promise<Repo | undefined> {
  if (!args.identity) {
    return undefined
  }
  const normalizedIdentity = normalizeRuntimePathForComparison(args.identity)
  const candidates = args.repos.filter(
    (repo) =>
      repo.kind === 'jj' &&
      getRepoExecutionHostId(repo) === (args.executionHostId ?? LOCAL_EXECUTION_HOST_ID)
  )
  const matches = await mapWithConcurrency(candidates, 4, async (repo) => {
    try {
      const candidateIdentity = await args.detectIdentity(repo)
      return candidateIdentity &&
        normalizeRuntimePathForComparison(candidateIdentity) === normalizedIdentity
        ? repo
        : null
    } catch {
      // An unavailable identity is not evidence that two repositories are the same.
      return null
    }
  })
  return matches.find((repo): repo is Repo => repo !== null)
}

export async function addLocalRepoFromPath(
  store: Store,
  path: string,
  kind: RepoKind = 'git',
  displayName?: string
): Promise<{ repo: Repo; alreadyExisted: boolean } | { error: string }> {
  const jjProbe =
    kind === 'folder' ? { kind: 'not-jj' as const } : await probeLocalJjRepo(path, kind === 'jj')
  if (jjProbe.kind === 'unavailable') {
    return { error: jjProbe.error }
  }
  const repoKind: RepoKind = jjProbe.kind === 'jj' ? 'jj' : kind === 'folder' ? 'folder' : 'git'
  const jjRoot = jjProbe.kind === 'jj' ? jjProbe.root : null
  if (repoKind === 'git') {
    await awaitWindowsHostGitEnvironmentReady({ cwd: path })
  }
  if (repoKind === 'git' && !isGitRepo(path)) {
    return { error: `Not a valid git repository: ${path}` }
  }

  const resolvedPath =
    repoKind === 'jj'
      ? jjProbe.kind === 'jj'
        ? (jjProbe.ownerRoot ?? jjRoot!)
        : jjRoot!
      : repoKind === 'git'
        ? getGitRepoRoot(path)
        : path
  const pathKey = normalizeRuntimePathForComparison(path)
  const existing = store
    .getRepos()
    .find(
      (repo) =>
        getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID &&
        normalizeRuntimePathForComparison(repo.path) === pathKey
    )
  if (existing) {
    return { repo: existing, alreadyExisted: true }
  }

  const resolvedPathKey = normalizeRuntimePathForComparison(resolvedPath)
  if (resolvedPathKey !== pathKey) {
    const existingAfterRootResolve = store
      .getRepos()
      .find(
        (repo) =>
          getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID &&
          normalizeRuntimePathForComparison(repo.path) === resolvedPathKey
      )
    if (existingAfterRootResolve) {
      return { repo: existingAfterRootResolve, alreadyExisted: true }
    }
  }

  if (repoKind === 'jj') {
    const existingByIdentity = await findImportedJjRepo({
      repos: store.getRepos(),
      identity: jjProbe.kind === 'jj' ? jjProbe.detection.repositoryIdentity : null,
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      detectIdentity: async (repo) => {
        const probe = await probeLocalJjRepo(repo.path, true)
        return probe.kind === 'jj' ? probe.detection.repositoryIdentity : null
      }
    })
    if (existingByIdentity) {
      return { repo: existingByIdentity, alreadyExisted: true }
    }
  }

  // Why: a linked worktree reports itself as its own toplevel, so the path checks above can't see that
  // it belongs to an already-tracked repo. Adding it anyway yields a second "ready" host setup on the
  // same project and host — a duplicate run-target row that resolves to a transient worktree path.
  if (repoKind === 'git') {
    const mainRepoRoot = getLinkedWorktreeMainRepoRoot(resolvedPath)
    if (mainRepoRoot) {
      const mainRepoKey = normalizeRuntimePathForComparison(mainRepoRoot)
      // Why !isFolderRepo: only a git-kind main checkout projects onto the same project as its
      // worktree, so matching a folder record would suppress the add without deduping anything.
      const trackedMainRepo = store
        .getRepos()
        .find(
          (repo) =>
            !repo.connectionId &&
            !isFolderRepo(repo) &&
            normalizeRuntimePathForComparison(repo.path) === mainRepoKey
        )
      if (trackedMainRepo) {
        return { repo: trackedMainRepo, alreadyExisted: true }
      }
    }
  }

  const detected =
    repoKind === 'jj'
      ? {}
      : await detectRepoIconAndUpstream({
          repoPath: resolvedPath,
          kind: repoKind,
          executionHostId: LOCAL_EXECUTION_HOST_ID
        })
  const repo: Repo = {
    id: randomUUID(),
    path: resolvedPath,
    displayName: displayName?.trim() || getRepoName(resolvedPath),
    badgeColor: DEFAULT_REPO_BADGE_COLOR,
    ...detected,
    addedAt: Date.now(),
    kind: repoKind,
    ...(repoKind === 'git'
      ? {
          externalWorktreeVisibilityLegacy: false,
          // Why: new Add Project imports are explicit ready host setups; 'legacy-repo' is reserved for older records/projection.
          projectHostSetupMethod: 'imported-existing-folder' as const
        }
      : {})
  }

  store.addRepo(repo)
  if (repoKind === 'git') {
    await prepareLocalWorktreeRootForRepo(store, repo)
  }
  return { repo, alreadyExisted: false }
}
