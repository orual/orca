import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { Store } from '../../persistence'
import type { Repo, RepoKind } from '../../../shared/repo-types'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../shared/constants'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { getRepoSshConnectionId, toSshExecutionHostId } from '../../../shared/execution-host'
import { getSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import { getSshGitProvider } from '../../providers/ssh-git-dispatch'
import { getSshJjProvider } from '../../providers/ssh-jj-dispatch'
import { detectRepoIconAndUpstream } from '../../repo-icon-autodetect'
import { findJjOwnerWorkspaceRoot } from '../../jj/jj-operations'
import type { JjWorkspace } from '../../../shared/jj-types'
import { getActiveMultiplexer } from '../../ssh/ssh-target-registry'
import {
  joinRemotePath,
  remoteDirname,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import type { IFilesystemProvider } from '../../providers/types'
import { resolveRemoteHomePath } from './remote-home-path'
import { findImportedJjRepo, getJjImportIdentityKey } from './local-repo-registration'

type RemoteJjMarkerProbe =
  | { kind: 'present'; path: string }
  | { kind: 'absent' }
  | { kind: 'unavailable'; error: string }

const JJ_MARKER_ANCESTOR_LIMIT = 8

function isMissingRemoteMarkerError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 2
}

export async function findRemoteJjOwnerWorkspaceRoot(
  workspaces: readonly JjWorkspace[],
  filesystem: Pick<IFilesystemProvider, 'stat'>,
  host?: RemoteHostPlatform | null
): Promise<string | null> {
  return findJjOwnerWorkspaceRoot(workspaces, async (workspaceRoot) => {
    const markerPath = host
      ? joinRemotePath(host, workspaceRoot, '.jj', 'repo')
      : posix.join(workspaceRoot, '.jj', 'repo')
    try {
      return (await filesystem.stat(markerPath)).type === 'directory'
    } catch {
      return false
    }
  })
}

export async function probeRemoteJjMarker(
  path: string,
  filesystem: Pick<IFilesystemProvider, 'stat'>,
  host?: RemoteHostPlatform | null
): Promise<RemoteJjMarkerProbe> {
  let current = path
  for (let depth = 0; depth <= JJ_MARKER_ANCESTOR_LIMIT; depth += 1) {
    const markerPath = host
      ? joinRemotePath(host, current, '.jj')
      : `${current.replace(/[\\/]+$/, '')}/.jj`
    try {
      const marker = await filesystem.stat(markerPath)
      if (marker.type === 'directory' || marker.type === 'file') {
        return { kind: 'present', path: current }
      }
    } catch (error) {
      if (!isMissingRemoteMarkerError(error)) {
        return {
          kind: 'unavailable',
          error: `Jujutsu repository unavailable while checking ${markerPath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        }
      }
    }
    const parent = host ? remoteDirname(current, host) : posix.dirname(current)
    if (parent === current || parent === '' || (parent === '/' && current === '/')) {
      break
    }
    current = parent
  }
  return { kind: 'absent' }
}

export async function addRemoteRepoFromPath(
  store: Store,
  args: {
    connectionId: string
    remotePath: string
    displayName?: string
    kind?: RepoKind
    setupMethod?: Repo['projectHostSetupMethod']
  }
): Promise<{ repo: Repo; alreadyExisted: boolean } | { error: string }> {
  const gitProvider = getSshGitProvider(args.connectionId)
  const jjProvider = getSshJjProvider(args.connectionId)
  const fsProvider = getSshFilesystemProvider(args.connectionId)
  let repoKind: RepoKind = args.kind ?? 'git'
  if ((repoKind === 'git' && (!gitProvider || !fsProvider)) || (repoKind === 'jj' && !jjProvider)) {
    return { error: `SSH connection "${args.connectionId}" not found or not connected` }
  }

  let resolvedPath = await resolveRemoteHomePath(args.connectionId, args.remotePath)
  if (repoKind === 'git') {
    if (!fsProvider) {
      return { error: `SSH connection "${args.connectionId}" not found or not connected` }
    }
    const marker = await probeRemoteJjMarker(
      resolvedPath,
      fsProvider,
      gitProvider?.getHostPlatform?.()
    )
    if (marker.kind === 'unavailable') {
      return { error: marker.error }
    }
    if (marker.kind === 'present') {
      repoKind = 'jj'
    }
  }
  let jjIdentity: string | null | undefined = null
  if (repoKind === 'jj') {
    if (!jjProvider) {
      return {
        error: 'Jujutsu is unavailable on the SSH host. Reconnect the SSH target and try again.'
      }
    }
    const detection = await jjProvider.detect(resolvedPath)
    if (!detection.ok) {
      return { error: `Jujutsu repository unavailable: ${detection.message}` }
    }
    jjIdentity = detection.repositoryIdentity
    const workspaces = jjProvider.listWorkspaces
      ? await jjProvider.listWorkspaces(resolvedPath)
      : null
    const ownerRoot =
      workspaces?.ok && fsProvider
        ? await findRemoteJjOwnerWorkspaceRoot(
            workspaces.workspaces,
            fsProvider,
            gitProvider?.getHostPlatform?.()
          )
        : null
    resolvedPath = ownerRoot ?? detection.root
  }

  // Resolve the host: a row stamped only `executionHostId: 'ssh:*'` is the same registration, and
  // missing it here registers a duplicate repo for a path the host already owns.
  const existing = store
    .getRepos()
    .find(
      (repo) =>
        getRepoSshConnectionId(repo) === args.connectionId &&
        normalizeRuntimePathForComparison(repo.path) ===
          normalizeRuntimePathForComparison(resolvedPath)
    )
  if (existing) {
    return { repo: existing, alreadyExisted: true }
  }

  if (repoKind === 'git') {
    try {
      const check = await gitProvider!.isGitRepoAsync(resolvedPath)
      if (check.isRepo) {
        if (check.rootPath) {
          resolvedPath = check.rootPath
        }
      } else {
        return { error: `Not a valid git repository: ${args.remotePath}` }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Not a valid git repository')) {
        return { error: err.message }
      }
      return { error: `Not a valid git repository: ${args.remotePath}` }
    }
  }

  const existingAfterRootResolve = store
    .getRepos()
    .find(
      (repo) =>
        getRepoSshConnectionId(repo) === args.connectionId &&
        normalizeRuntimePathForComparison(repo.path) ===
          normalizeRuntimePathForComparison(resolvedPath)
    )
  if (existingAfterRootResolve) {
    return { repo: existingAfterRootResolve, alreadyExisted: true }
  }

  if (repoKind === 'jj') {
    const executionHostId = toSshExecutionHostId(args.connectionId)
    const identityKey = getJjImportIdentityKey(jjIdentity, executionHostId)
    const existingByIdentity = identityKey
      ? await findImportedJjRepo({
          repos: store.getRepos(),
          identity: jjIdentity,
          executionHostId,
          detectIdentity: async (repo) => {
            const detection = await jjProvider!.detect(repo.path)
            return detection.ok ? detection.repositoryIdentity : null
          }
        })
      : undefined
    if (existingByIdentity) {
      return { repo: existingByIdentity, alreadyExisted: true }
    }
  }

  const folderName = getRemoteRepoFolderName(resolvedPath)
  let displayName = args.displayName || folderName
  if (!args.displayName && (args.remotePath === '~' || args.remotePath === '~/')) {
    const sshTarget = store.getSshTarget(args.connectionId)
    if (sshTarget) {
      displayName = sshTarget.label
    }
  }

  const detected =
    repoKind === 'jj'
      ? {}
      : await detectRepoIconAndUpstream({
          repoPath: resolvedPath,
          kind: repoKind,
          executionHostId: toSshExecutionHostId(args.connectionId)
        })
  const repo: Repo = {
    id: randomUUID(),
    path: resolvedPath,
    displayName,
    badgeColor: DEFAULT_REPO_BADGE_COLOR,
    ...detected,
    addedAt: Date.now(),
    kind: repoKind,
    connectionId: args.connectionId,
    // Stamp the unified spelling at creation: this is now the runtime's SSH registration path too,
    // and minting `connectionId`-only rows leaves every host-resolving reader on the legacy field.
    executionHostId: toSshExecutionHostId(args.connectionId),
    ...(repoKind === 'git'
      ? {
          externalWorktreeVisibilityLegacy: false,
          projectHostSetupMethod: args.setupMethod ?? ('imported-existing-folder' as const)
        }
      : {})
  }

  store.addRepo(repo)
  const mux = getActiveMultiplexer(args.connectionId)
  if (mux) {
    mux.notify('session.registerRoot', { rootPath: resolvedPath })
  }

  return { repo, alreadyExisted: false }
}

function getRemoteRepoFolderName(remotePath: string): string {
  const trimmed = remotePath.replace(/[\\/]+$/, '')
  if (!trimmed) {
    return remotePath
  }
  return trimmed.split(/[\\/]/).at(-1) || remotePath
}
