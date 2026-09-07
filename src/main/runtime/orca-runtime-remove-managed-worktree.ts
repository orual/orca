// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithCreateManagedRemoteWorktree } from './orca-runtime-create-managed-remote-worktree'
import { resolveWorktreeRemovalRepoOwner } from '../worktree-removal-repo-owner'
import type { RemoveWorktreeResult } from '../../shared/worktree/create-types'
import type { Repo } from '../../shared/repo-types'
import type { ExecutionHostId } from '../../shared/execution-host'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../shared/execution-host'
import { preservedBranchCleanupScopeKey } from '../../shared/preserved-branch-cleanup'
import { getRuntimeWorktreeRemovalOptionsKey } from './runtime-worktree-selection'
import { withWorktreeSpan } from '../observability/instrumentation'
import { invalidateAuthorizedRootsCache } from '../ipc/filesystem-auth'
import { resolveWorktreeRemovalRoute } from '../worktree-removal-execution-host-route'
import { isFolderRepo, isGitRepoKind, isJjRepo } from '../../shared/repo-kind'
import { removeOrphanOrFolderWorktree } from './orca-runtime-remove-orphan-or-folder-worktree'
import { removeManagedJjWorkspace } from './runtime-managed-jj-worktree-removal'
import { removeRuntimeManagedWorktree } from './runtime-managed-worktree-removal'

export class OrcaRuntimeWithRemoveManagedWorktree extends OrcaRuntimeWithCreateManagedRemoteWorktree {
  async removeManagedWorktree(
    worktreeSelector: string,
    force = false,
    runHooks = false,
    allowUnverifiedPtyStop = false,
    hostId?: string,
    jjRemoval?: 'forget' | 'forget-and-delete' | 'cleanup-only'
  ): Promise<RemoveWorktreeResult & { warning?: string }> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const store = this.store
    const cleanupHostId = parseExecutionHostId(hostId)?.id
    const removalTarget = await this.resolveWorktreeRemovalTarget(worktreeSelector, cleanupHostId)
    const cleanupScopeKey = preservedBranchCleanupScopeKey({
      worktreeId: removalTarget.id,
      hostId: cleanupHostId
    })
    const optionsKey = getRuntimeWorktreeRemovalOptionsKey(
      force,
      runHooks,
      allowUnverifiedPtyStop,
      jjRemoval
    )
    const inFlightRemoval = this.removeManagedWorktreeInFlight.get(
      cleanupScopeKey,
      removalTarget.id,
      optionsKey
    )
    if (inFlightRemoval) {
      return inFlightRemoval
    }
    const removal = (async (): Promise<RemoveWorktreeResult & { warning?: string }> => {
      return withWorktreeSpan({ stage: 'remove', path: removalTarget.path }, async () => {
        const repoOwner = resolveWorktreeRemovalRepoOwner(
          store,
          removalTarget.repoId,
          cleanupHostId
        )
        if (repoOwner.kind === 'ambiguous') {
          throw new Error(
            `Workspace identity is ambiguous across hosts: ${removalTarget.id}. Retry with an explicit host.`
          )
        }
        const repo = repoOwner.kind === 'resolved' ? repoOwner.repo : undefined
        if (repo && !isFolderRepo(repo) && !isGitRepoKind(repo) && !isJjRepo(repo)) {
          throw new Error('unsupported_repo_kind')
        }
        const removalHostId = repo ? (cleanupHostId ?? getRepoExecutionHostId(repo)) : cleanupHostId
        if (repo && isJjRepo(repo)) {
          if (!jjRemoval) {
            throw new Error('JJ removal requires an explicit forget or forget-and-delete outcome')
          }
          return this.removeManagedJjWorkspace({
            selector: worktreeSelector,
            target: removalTarget,
            repo,
            removalHostId,
            jjRemoval,
            force,
            allowUnverifiedPtyStop,
            store
          })
        }
        const orphanOrFolderResult = await removeOrphanOrFolderWorktree({
          runtime: this,
          store,
          removalTarget,
          cleanupHostId,
          removalHostId,
          repo
        })
        if (orphanOrFolderResult) {
          return orphanOrFolderResult
        }
        // One host for the whole removal: list, remove and prune share this route.
        const route = resolveWorktreeRemovalRoute(removalHostId)
        return removeRuntimeManagedWorktree({
          repo,
          target: removalTarget,
          removalHostId,
          cleanupHostId,
          store,
          route,
          force,
          runHooks,
          allowUnverifiedPtyStop,
          acquireWatcherRemoval: this.acquireFileWatcherRemoval,
          stopPtys: (worktreeId, options) =>
            this.stopPtysForDestructiveWorktreeRemoval(worktreeId, options),
          getSshProvider: (connectionId) => this.getSshProviderFn?.(connectionId),
          closeWatchers: (path) => this.closeFileWatchersForRemoval(path),
          clearOptimisticReconcileToken: (worktreeId) =>
            this.clearOptimisticReconcileToken(worktreeId),
          removeWorktreeMetadataAndHistory: (runtimeStore, worktreeId, host) =>
            this.removeWorktreeMetadataAndHistory(runtimeStore, worktreeId, host),
          invalidateResolvedWorktreeCache: () => this.invalidateResolvedWorktreeCache(),
          invalidateWorktreeScanCacheForRepo: (repoId) =>
            this.invalidateWorktreeScanCacheForRepo(repoId),
          notifyWorktreesChanged: (repoId) => this.notifyWorktreesChanged(repoId),
          preservedBranchCleanup: this.preservedBranchCleanup,
          finishRemoval: (result, rememberBranch, fallbackHead, pushTarget) => {
            if (rememberBranch) {
              this.preservedBranchCleanup.remember(
                removalTarget.id,
                cleanupHostId,
                result,
                fallbackHead,
                pushTarget
              )
            } else {
              this.preservedBranchCleanup.delete(removalTarget.id, cleanupHostId)
            }
            this.clearOptimisticReconcileToken(removalTarget.id)
            this.removeWorktreeMetadataAndHistory(store, removalTarget.id, removalHostId)
            this.invalidateResolvedWorktreeCache()
            this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
            invalidateAuthorizedRootsCache()
            this.notifyWorktreesChanged(repo.id)
          }
        })
      })
    })()
    this.removeManagedWorktreeInFlight.track(cleanupScopeKey, optionsKey, removal)
    try {
      const result = await removal
      this.emitWorktreeLifecycle({
        kind: 'removed',
        worktreeId: removalTarget.id,
        path: removalTarget.path
      })
      return result
    } finally {
      this.removeManagedWorktreeInFlight.release(cleanupScopeKey, removal)
    }
  }

  async removeManagedJjWorkspace(args: {
    selector: string
    target: { id: string; repoId: string; path: string }
    repo: Repo
    removalHostId: ExecutionHostId | undefined
    jjRemoval: 'forget' | 'forget-and-delete' | 'cleanup-only'
    force: boolean
    allowUnverifiedPtyStop: boolean
    store: NonNullable<typeof this.store>
  }): Promise<RemoveWorktreeResult> {
    return removeManagedJjWorkspace(this, args)
  }
}
