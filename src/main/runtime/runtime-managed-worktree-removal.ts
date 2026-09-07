import type { GitPushTarget } from '../../shared/worktree/types'
import type { RemoveWorktreeResult } from '../../shared/worktree/create-types'
import type { Repo } from '../../shared/repo-types'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { IPtyProvider } from '../providers/types'
import type { RuntimeStore } from './runtime-store-contract'
import type { RuntimeWorktreeRemovalTarget } from './runtime-worktree-selection'
import type { WorktreeRemovalRoute } from '../worktree-removal-execution-host-route'
import {
  getLocalProjectWorktreeGitOptions,
  type LocalProjectWorktreeGitOptions
} from '../project-runtime-git-options'
import { listWorktreesStrict } from '../git/worktree'
import { findRegisteredDeletableWorktree } from '../worktree-removal-safety'
import { resolveWorktreeRemovalMetadata } from '../worktree-removal-repo-owner'
import { removeRuntimeUnregisteredWorktree } from './runtime-unregistered-worktree-removal'
import { assertWorktreeUnlockedForRemoval } from '../../shared/worktree/removal'
import { formatWorktreeRemovalError } from '../ipc/worktree-logic'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { isRuntimeWorktreePathMissing } from './runtime-worktree-filesystem'
import { removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval } from '../local-worktree-removal-recovery'
import { cleanupUnusedWorktreePushTargetRemote } from '../ipc/worktree-remote'
import { removeRuntimeRegisteredRemoteWorktree } from './runtime-registered-remote-worktree-removal'
import { removeRuntimeRegisteredLocalWorktree } from './runtime-registered-local-worktree-removal'
import { deleteRemoteWorktreeHistory } from '../remote-worktree-history-cleanup'
import { invalidateAuthorizedRootsCache } from '../ipc/filesystem-auth'

type RemovalGate = { finish: (removed: boolean) => Promise<void> }

type RemovalCompletion = (
  result?: RemoveWorktreeResult,
  rememberBranch?: boolean,
  fallbackHead?: string,
  pushTarget?: GitPushTarget
) => void

export async function removeRuntimeManagedWorktree(args: {
  repo: Repo
  target: RuntimeWorktreeRemovalTarget
  removalHostId: ExecutionHostId | undefined
  cleanupHostId: string | undefined
  store: RuntimeStore
  route: WorktreeRemovalRoute
  force: boolean
  runHooks: boolean
  allowUnverifiedPtyStop: boolean
  acquireWatcherRemoval: (path: string, connectionId?: string) => Promise<RemovalGate>
  stopPtys: (
    worktreeId: string,
    options: { connectionId?: string; allowUnverifiedStop?: boolean }
  ) => Promise<void>
  getSshProvider?: (connectionId: string) => IPtyProvider | undefined
  closeWatchers: (path: string) => Promise<void>
  finishRemoval: RemovalCompletion
  clearOptimisticReconcileToken: (worktreeId: string) => void
  removeWorktreeMetadataAndHistory: (
    store: RuntimeStore,
    worktreeId: string,
    hostId?: ExecutionHostId
  ) => void
  invalidateResolvedWorktreeCache: () => void
  invalidateWorktreeScanCacheForRepo: (repoId: string) => void
  notifyWorktreesChanged: (repoId: string) => void
  preservedBranchCleanup: {
    remember: (
      worktreeId: string,
      hostId: string | undefined,
      result: RemoveWorktreeResult | undefined,
      fallbackHead: string | undefined,
      pushTarget: GitPushTarget | undefined
    ) => void
    preserveHead: (
      result: RemoveWorktreeResult | undefined,
      fallbackHead: string | undefined
    ) => RemoveWorktreeResult
    delete: (worktreeId: string, hostId?: string) => void
  }
}): Promise<RemoveWorktreeResult & { warning?: string }> {
  const { repo, target, route, store, removalHostId, force, runHooks, allowUnverifiedPtyStop } =
    args
  const localWorktreeGitOptions: LocalProjectWorktreeGitOptions =
    route.kind === 'ssh' ? {} : getLocalProjectWorktreeGitOptions(store as never, repo)
  const hasLocalWorktreeGitOptions = Object.keys(localWorktreeGitOptions).length > 0
  const registeredWorktrees =
    route.kind === 'ssh'
      ? await route.provider.listWorktrees(repo.path)
      : hasLocalWorktreeGitOptions
        ? await listWorktreesStrict(repo.path, localWorktreeGitOptions)
        : await listWorktreesStrict(repo.path)
  const removedMeta = resolveRemovedMeta(store, target, removalHostId)
  const removedPushTarget = removedMeta?.pushTarget ?? target.pushTarget
  const registeredWorktree = findRegisteredDeletableWorktree(
    repo.path,
    target.path,
    registeredWorktrees
  )

  if (!registeredWorktree) {
    return removeRuntimeUnregisteredWorktree({
      repo,
      target,
      registeredWorktrees,
      removedMeta,
      removedPushTarget,
      force,
      allowUnverifiedPtyStop,
      route,
      localOptions: localWorktreeGitOptions,
      store,
      acquireWatcherRemoval: args.acquireWatcherRemoval,
      stopPtys: (worktreeId, connectionId, allowUnverifiedPtyStop) =>
        args.stopPtys(worktreeId, {
          ...(connectionId ? { connectionId } : {}),
          allowUnverifiedStop: allowUnverifiedPtyStop
        }),
      deleteHistory: () =>
        deleteRemoteWorktreeHistory(
          route.kind === 'ssh' ? args.getSshProvider?.(route.connectionId) : undefined,
          target.id
        ),
      finishRemoval: () => finishGenericRemoval(args)
    })
  }

  const canonicalWorktreePath = registeredWorktree.path
  const deleteBranch = removedMeta?.preserveBranchOnDelete !== true
  try {
    assertWorktreeUnlockedForRemoval(registeredWorktree)
  } catch (error) {
    throw new Error(formatWorktreeRemovalError(error, canonicalWorktreePath, force))
  }

  if (
    route.kind === 'local' &&
    force === true &&
    process.platform === 'win32' &&
    (isWindowsAbsolutePathLike(canonicalWorktreePath) || !!localWorktreeGitOptions.wslDistro) &&
    removedMeta &&
    (await isRuntimeWorktreePathMissing(
      route.hostId,
      canonicalWorktreePath,
      localWorktreeGitOptions
    ))
  ) {
    const removalResult = await removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval({
      canonicalWorktreePath,
      repoPath: repo.path,
      localWorktreeGitOptions,
      registeredWorktree,
      deleteBranch
    })
    await cleanupUnusedWorktreePushTargetRemote(
      repo.path,
      target.id,
      removedPushTarget,
      store,
      localWorktreeGitOptions
    )
    args.finishRemoval(removalResult, true, registeredWorktree.head, removedPushTarget)
    return removalResult ?? {}
  }

  if (route.kind === 'ssh') {
    return removeRuntimeRegisteredRemoteWorktree({
      repo,
      target,
      registeredWorktree,
      removedPushTarget,
      store,
      provider: route.provider,
      connectionId: route.connectionId,
      force,
      allowUnverifiedPtyStop,
      deleteBranch,
      acquireWatcherRemoval: (path, connectionId) => args.acquireWatcherRemoval(path, connectionId),
      stopPtys: () =>
        args.stopPtys(target.id, {
          connectionId: route.connectionId,
          allowUnverifiedStop: allowUnverifiedPtyStop
        }),
      deleteHistory: () =>
        deleteRemoteWorktreeHistory(args.getSshProvider?.(route.connectionId), target.id),
      preserveBranchHead: args.preservedBranchCleanup.preserveHead,
      finishRemoval: (result) =>
        args.finishRemoval(result, true, registeredWorktree.head, removedPushTarget)
    })
  }

  return removeRuntimeRegisteredLocalWorktree({
    repo,
    target,
    registeredWorktree,
    removedPushTarget,
    store,
    localOptions: localWorktreeGitOptions,
    hasLocalOptions: hasLocalWorktreeGitOptions,
    force,
    runHooks,
    allowUnverifiedPtyStop,
    deleteBranch,
    acquireWatcherRemoval: (path) => args.acquireWatcherRemoval(path),
    stopPtys: () =>
      args.stopPtys(target.id, {
        allowUnverifiedStop: allowUnverifiedPtyStop
      }),
    closeWatchers: args.closeWatchers,
    preserveBranchHead: args.preservedBranchCleanup.preserveHead,
    finishRemoval: (result, rememberBranch, fallbackHead) =>
      args.finishRemoval(result, rememberBranch, fallbackHead, removedPushTarget)
  })
}

function resolveRemovedMeta(
  store: RuntimeStore,
  target: RuntimeWorktreeRemovalTarget,
  removalHostId: ExecutionHostId | undefined
) {
  return resolveWorktreeRemovalMetadata(
    store,
    target.repoId,
    target.id,
    removalHostId as ExecutionHostId
  )
}

function finishGenericRemoval(args: Parameters<typeof removeRuntimeManagedWorktree>[0]): void {
  const { target, repo, store, removalHostId } = args
  args.clearOptimisticReconcileToken(target.id)
  args.removeWorktreeMetadataAndHistory(store, target.id, removalHostId)
  args.preservedBranchCleanup.delete(target.id, args.cleanupHostId)
  args.invalidateResolvedWorktreeCache()
  args.invalidateWorktreeScanCacheForRepo(target.repoId)
  invalidateAuthorizedRootsCache()
  args.notifyWorktreesChanged(repo.id)
}
