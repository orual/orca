import type { RemoveWorktreeResult } from '../../../../../../shared/worktree/create-types'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { WorktreeSliceGet, WorktreeSliceSet } from '../listing/worktree-slice-types'
import { forgetHugeRepoWarningDismissalsForWorktrees } from '@/lib/source-control-huge-repo-warning-dismissals'
import { showPreservedBranchToast } from '@/components/sidebar/preserved-branch-toast'
import { preservedBranchCleanupKey } from '../../../../../../shared/preserved-branch-cleanup'
import { pruneHostedReviewLinkMutationGenerations } from '../metadata/hosted-review-link-mutation'
import { rememberAuthoritativelyRemovedWorktrees } from '../listing/authoritative-worktree-removal-memory'
import { preservedBranchRuntimeTargetByCleanupKey } from './preserved-branch-cleanup-target'
import { clearSessionCommitDraftForWorktree } from '@/lib/source-control-commit-draft-session'
import { recordRemovedWorktreeSnapshotPrune } from './removed-worktree-snapshot-prune'
import { tearDownRemovedWorktreeRendererState } from './removed-worktree-renderer-teardown'
import type { WorktreeOperationRoute } from '@/lib/worktree-operation-route'
import type { RuntimeClientTarget } from '../../../../runtime/runtime-client-target'
import type { RendererRemoveWorktreeResult } from '../../renderer-remove-worktree-result'

type PreservedBranchWorktree = Parameters<typeof showPreservedBranchToast>[1]
type RemovalOptions = {
  snapshotPruneBatchId?: string
  suppressPreservedBranchToast?: boolean
}

export async function completeRemovedWorktree(args: {
  set: WorktreeSliceSet
  get: WorktreeSliceGet
  worktreeId: string
  hostId: ExecutionHostId | undefined
  requiredExecutionHostId: ExecutionHostId | null | undefined
  removalRoute: WorktreeOperationRoute | null
  target: RuntimeClientTarget
  worktreeBeforeRemoval: PreservedBranchWorktree
  terminalPtyIdsBeforeRemoval: readonly string[]
  removalResult: RemoveWorktreeResult
  snapshotPruneHandledByLocalMain: boolean
  options: RemovalOptions | undefined
}): Promise<RendererRemoveWorktreeResult> {
  const {
    set,
    get,
    worktreeId,
    hostId,
    requiredExecutionHostId,
    removalRoute,
    target,
    worktreeBeforeRemoval,
    terminalPtyIdsBeforeRemoval,
    removalResult,
    snapshotPruneHandledByLocalMain,
    options
  } = args
  if (!snapshotPruneHandledByLocalMain) {
    await recordRemovedWorktreeSnapshotPrune({
      worktreeId,
      hostId,
      snapshotPruneBatchId: options?.snapshotPruneBatchId
    })
  }
  forgetHugeRepoWarningDismissalsForWorktrees([worktreeId])
  if (hostId && hostId.startsWith('ssh:')) {
    rememberAuthoritativelyRemovedWorktrees(hostId, [worktreeId])
  }
  await snapshotWorkspaceName(worktreeId, worktreeBeforeRemoval?.displayName)
  await tearDownRemovedWorktreeRendererState({
    set,
    get,
    worktreeId,
    hostId,
    requiredExecutionHostId: requiredExecutionHostId ?? null,
    terminalPtyIdsBeforeRemoval
  })
  clearSessionCommitDraftForWorktree(worktreeId)
  const preservedBranch = removalResult?.preservedBranch
  const cleanup = preservedBranch
    ? {
        worktreeId,
        branchName: preservedBranch.branchName,
        expectedHead: preservedBranch.head,
        ...(hostId ? { hostId } : {}),
        ...(removalRoute?.runtimeEnvironmentId
          ? { runtimeEnvironmentId: removalRoute.runtimeEnvironmentId }
          : {})
      }
    : null
  if (preservedBranch) {
    preservedBranchRuntimeTargetByCleanupKey.set(preservedBranchCleanupKey(cleanup!), {
      cleanup: cleanup!,
      target
    })
  }
  if (preservedBranch && options?.suppressPreservedBranchToast !== true) {
    showPreservedBranchToast(removalResult, worktreeBeforeRemoval, (branch, expectedHead) => {
      void get().forceDeletePreservedBranch(worktreeId, branch, expectedHead, {
        ...(hostId ? { hostId } : {}),
        ...(removalRoute?.runtimeEnvironmentId
          ? { runtimeEnvironmentId: removalRoute.runtimeEnvironmentId }
          : {})
      })
    })
  }
  pruneHostedReviewLinkMutationGenerations([worktreeId])
  return preservedBranch && cleanup
    ? {
        ok: true as const,
        preservedBranch: {
          ...preservedBranch,
          ...(cleanup.hostId ? { hostId: cleanup.hostId } : {}),
          ...(cleanup.runtimeEnvironmentId
            ? { runtimeEnvironmentId: cleanup.runtimeEnvironmentId }
            : {})
        }
      }
    : { ok: true as const }
}

async function snapshotWorkspaceName(
  worktreeId: string,
  displayName: string | undefined
): Promise<void> {
  const trimmed = displayName?.trim()
  if (!trimmed) {
    return
  }
  try {
    await window.api.automations?.snapshotWorkspaceName?.({
      workspaceId: worktreeId,
      displayName: trimmed
    })
  } catch (error) {
    console.warn('Failed to snapshot automation workspace name:', error)
  }
}
