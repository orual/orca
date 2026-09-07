import type { WorktreeSlice } from '../../worktree-helpers'
import type { WorktreeSliceGet, WorktreeSliceSet } from '../listing/worktree-slice-types'
import type { RemoveWorktreeResult } from '../../../../../../shared/worktree/create-types'
import { getRepoIdFromWorktreeId } from '../../worktree-helpers'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { getActiveRuntimeTarget } from '../../../../runtime/runtime-rpc-client'
import {
  resolveWorktreeOperationRouteResult,
  resolveWorktreeOperationRouteResultForHost,
  settingsForWorktreeOperationRoute
} from '@/lib/worktree-operation-route'
import {
  beginHostQualifiedRemoval,
  completeSameIdHostScopedRemoval,
  findWorktreeOnConfirmedHost,
  prepareHostScopedRemovalCompletion,
  refuseUnprovableRemoteHostRouting
} from './host-qualified-worktree-removal'
import { resolveSameIdSurvivingHostId } from './host-qualified-worktree-row-removal'
import {
  classifyWorktreeForceDeleteReason,
  getLockedWorktreeRemovalReason,
  isLockedWorktreeRemovalError
} from '../../../../../../shared/worktree/removal'
import { composeWorktreeHostIdentity } from '../../../../../../shared/worktree/host-qualified-identity'
import {
  isRuntimeRepoNotFoundError,
  isRuntimeSelectorNotFoundError
} from '../listing/runtime-worktree-rpc-errors'
import { dispatchWorktreeRemoval } from './dispatch-worktree-removal'
import { completeRemovedWorktree } from './complete-remove-worktree'

export function createRemoveWorktree(
  set: WorktreeSliceSet,
  get: WorktreeSliceGet
): WorktreeSlice['removeWorktree'] {
  return async (removalTarget, force, options) => {
    const worktreeId = removalTarget.id
    const forgetLocalOnly = options?.mode === 'forget-local'
    // Why (STA-4343): this is the ONE chokepoint every delete entry point shares,
    // so host qualification is enforced here rather than at any single caller — a
    // guard bolted onto the sidebar would drift from the cleanup dialog's. The
    // caller confirmed ONE host's row; route at that host instead of the active
    // workspace's, which owns the same id elsewhere.
    const requiredExecutionHostId = removalTarget.executionHostId
    const start = beginHostQualifiedRemoval(
      get,
      worktreeId,
      requiredExecutionHostId,
      forgetLocalOnly,
      options?.ignoreWorkspaceCleanupScanSurvivors === true
    )
    if (!start.ok) {
      return { ok: false, error: start.error }
    }
    const {
      removalRoute,
      hostId,
      removalGenerationGuard,
      sameIdSurvivingHostId: catalogSameIdSurvivingHostId
    } = start
    const sameIdSurvivingHostId =
      catalogSameIdSurvivingHostId ?? options?.sameIdSurvivingHostId ?? null
    const deleteStateKey = requiredExecutionHostId
      ? composeWorktreeHostIdentity(requiredExecutionHostId, worktreeId)
      : worktreeId
    set((s) => ({
      deleteStateByWorktreeId: {
        ...s.deleteStateByWorktreeId,
        [deleteStateKey]: {
          isDeleting: true,
          phase: 'deleting',
          ...(requiredExecutionHostId ? { executionHostId: requiredExecutionHostId } : {}),
          error: null,
          canForceDelete: false,
          forceDeleteReason: null
        }
      }
    }))

    try {
      // Why: forget-local touches no remote, so there's no archive hook to run or trust prompt needed.
      const skipArchive = forgetLocalOnly
        ? true
        : (await ensureHooksConfirmed(
            get(),
            getRepoIdFromWorktreeId(worktreeId),
            'archive',
            hostId,
            removalRoute?.runtimeEnvironmentId
          )) === 'skip'

      const worktreeBeforeRemoval = findWorktreeOnConfirmedHost(
        get,
        worktreeId,
        requiredExecutionHostId
      )
      const terminalPtyIdsBeforeRemoval = (get().tabsByWorktree[worktreeId] ?? []).flatMap(
        (tab) => get().ptyIdsByTabId[tab.id] ?? []
      )
      if (!forgetLocalOnly) {
        removalGenerationGuard?.assertCurrent()
      }
      // Why: forget-local clears Orca's records via local IPC regardless of host — the remote is gone or unreachable.
      const target = getActiveRuntimeTarget(
        removalRoute
          ? settingsForWorktreeOperationRoute(get().settings, removalRoute)
          : get().settings
            ? { ...get().settings, activeRuntimeEnvironmentId: null }
            : { activeRuntimeEnvironmentId: null }
      )
      const unprovableRemoteRouting = forgetLocalOnly
        ? null
        : refuseUnprovableRemoteHostRouting(get, worktreeId, target.kind)
      if (unprovableRemoteRouting) {
        throw new Error(unprovableRemoteRouting)
      }
      let removalResult: RemoveWorktreeResult
      let snapshotPruneHandledByLocalMain = forgetLocalOnly || target.kind === 'local'
      try {
        removalResult = await dispatchWorktreeRemoval({
          worktreeId,
          hostId,
          force,
          skipArchive,
          forgetLocalOnly,
          target,
          options,
          assertCurrent: () => removalGenerationGuard?.assertCurrent()
        })
      } catch (error) {
        if (
          !forgetLocalOnly &&
          target.kind !== 'local' &&
          (isRuntimeRepoNotFoundError(error) || isRuntimeSelectorNotFoundError(error))
        ) {
          // Missing means stale mirror; ambiguous or changed ownership must fail closed.
          const currentResolution = requiredExecutionHostId
            ? resolveWorktreeOperationRouteResultForHost(get(), worktreeId, requiredExecutionHostId)
            : resolveWorktreeOperationRouteResult(get(), worktreeId)
          if (currentResolution.kind === 'ambiguous') {
            throw error
          }
          if (currentResolution.kind === 'resolved') {
            removalGenerationGuard?.assertCurrent()
          }
          try {
            removalResult = await window.api.worktrees.forgetLocal({
              worktreeId,
              hostId,
              ...(options?.snapshotPruneBatchId
                ? { snapshotPruneBatchId: options.snapshotPruneBatchId }
                : {})
            })
            snapshotPruneHandledByLocalMain = true
          } catch (fallbackError) {
            // Preserve the remote verdict as fallback failure context.
            throw new Error(
              fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              { cause: error }
            )
          }
        } else {
          throw error
        }
      }

      if (removalResult?.jjCleanupPending) {
        // JJ forget succeeded but directory cleanup did not; retain metadata and renderer state
        // until the user explicitly confirms the proof-bound cleanup-only retry.
        set((s) => ({
          deleteStateByWorktreeId: {
            ...s.deleteStateByWorktreeId,
            [deleteStateKey]: {
              ...s.deleteStateByWorktreeId[deleteStateKey],
              isDeleting: false,
              ...(requiredExecutionHostId ? { executionHostId: requiredExecutionHostId } : {})
            }
          }
        }))
        return { ok: true as const, jjCleanupPending: removalResult.jjCleanupPending }
      }

      // Why (STA-4343): another host still owns this id, so the shared renderer
      // state (tabs, terminals, browsers) belongs to that live workspace — drop
      // only the confirmed host's row instead of tearing all of it down.
      //
      // The ephemeral VM is the exception — see completeSameIdHostScopedRemoval.
      if (requiredExecutionHostId) {
        const currentSameIdSurvivingHostId = resolveSameIdSurvivingHostId(
          get(),
          worktreeId,
          requiredExecutionHostId,
          options?.ignoreWorkspaceCleanupScanSurvivors === true
        )
        const confirmedSurvivingHostId = currentSameIdSurvivingHostId ?? sameIdSurvivingHostId
        if (confirmedSurvivingHostId) {
          const sameIdStillSurvives = prepareHostScopedRemovalCompletion(
            set,
            worktreeId,
            requiredExecutionHostId,
            confirmedSurvivingHostId,
            options?.ignoreWorkspaceCleanupScanSurvivors === true
          )
          if (sameIdStillSurvives) {
            return completeSameIdHostScopedRemoval({
              set,
              get,
              worktreeId,
              requiredExecutionHostId,
              removalResult,
              removalRoute,
              target,
              worktreeBeforeRemoval,
              suppressPreservedBranchToast: options?.suppressPreservedBranchToast === true,
              rowAlreadyDropped: true
            })
          }
        }
      }

      return completeRemovedWorktree({
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
      })
    } catch (err) {
      // Why: git refusing a non-force delete for dirty/untracked files is a handled user decision, not an app error.
      console.warn('Failed to remove worktree:', err)
      const error = err instanceof Error ? err.message : String(err)
      const forceDeleteReason = classifyWorktreeForceDeleteReason(
        error,
        force,
        options?.allowUnverifiedPtyStop === true
      )
      const locked = isLockedWorktreeRemovalError(error)
      set((s) => ({
        deleteStateByWorktreeId: {
          ...s.deleteStateByWorktreeId,
          [deleteStateKey]: {
            isDeleting: false,
            ...(requiredExecutionHostId ? { executionHostId: requiredExecutionHostId } : {}),
            error,
            canForceDelete: forceDeleteReason !== null,
            forceDeleteReason,
            ...(locked ? { lockReason: getLockedWorktreeRemovalReason(error) } : {})
          }
        }
      }))
      return { ok: false as const, error }
    }
  }
}
