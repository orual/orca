import type { Repo } from '../../../../shared/repo-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { RemoveWorktreeResult } from '../../../../shared/worktree/create-types'
import type { JjCleanupPending } from '../../../../shared/worktree/types'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import { isJjRepo } from '../../../../shared/repo-kind'
import {
  assertJjWorkspaceCanBePhysicallyDeleted,
  listJjWorkspacesForRepo,
  jjBackendForRepo
} from '../../../jj/jj-workspace-catalog'
import { getLocalProjectWorktreeGitOptions } from '../../../project-runtime-git-options'
import { resolveWorktreeRemovalRoute } from '../../../worktree-removal-execution-host-route'
import { removeLocalWorktreePath } from '../../../local-worktree-filesystem'
import { invalidateAuthorizedRootsCache } from '../../registered-worktree-roots-cache'
import { notifyWorktreesChanged } from '../../worktree-remote'
import {
  readWorktreeMetaForHost,
  writeWorktreeMetaForHost
} from '../../../persistence/host-qualified-worktree-meta'
import type { RemoveWorktreeArgs } from '../ipc-context-schemas'
import type { WorktreeIpcContext } from '../worktree-ipc-context'
import {
  removeWorktreeMetadataAndTransientState,
  stopPtysForDestructiveWorktreeRemoval
} from './worktree-removal-ownership'

export async function removeJjWorkspace(
  context: WorktreeIpcContext,
  args: RemoveWorktreeArgs,
  repo: Repo,
  repoId: string,
  worktreePath: string,
  removalHostId: ExecutionHostId
): Promise<RemoveWorktreeResult> {
  if (!isJjRepo(repo)) {
    throw new Error('jj removal requested for non-jj repository')
  }
  if (!args.jjRemoval) {
    throw new Error('JJ removal requires an explicit forget or forget-and-delete outcome')
  }
  if (args.jjRemoval === 'cleanup-only') {
    return removePendingJjWorkspace(context, args, repo, repoId, worktreePath, removalHostId)
  }

  const jjOptions = getLocalProjectWorktreeGitOptions(context.store, repo)
  const listing = await listJjWorkspacesForRepo(repo, jjOptions)
  if (!listing.ok || !listing.complete) {
    throw new Error(
      listing.ok ? 'JJ workspace roots are incomplete; refusing removal.' : listing.message
    )
  }
  const requested = listing.workspaces.find(
    (workspace) =>
      workspace.root !== null &&
      normalizeRuntimePathForComparison(workspace.root) ===
        normalizeRuntimePathForComparison(worktreePath)
  )
  if (!requested?.root) {
    throw new Error(`JJ workspace is no longer registered at ${worktreePath}; refusing removal.`)
  }
  const metadata = readWorktreeMetaForHost(
    context.store,
    args.worktreeId,
    removalHostId
  )?.jjWorkspace
  if (!metadata?.rootResolved || metadata.name !== requested.name) {
    throw new Error('JJ workspace identity changed; refresh the workspace list and retry removal.')
  }
  const detection = await jjBackendForRepo(repo, jjOptions).detect()
  if (!detection.ok) {
    throw new Error(detection.message)
  }
  if (!detection.root) {
    throw new Error('JJ repository detection returned no structural owner root.')
  }
  const ownerRoot = detection.root
  const targetRoot = requested.root
  if (args.jjRemoval === 'forget-and-delete') {
    assertJjWorkspaceCanBePhysicallyDeleted(targetRoot, ownerRoot, listing.workspaces)
  }

  const route = resolveWorktreeRemovalRoute(removalHostId)
  const gate = await context.runtime.acquireFileWatcherRemoval(
    worktreePath,
    route.kind === 'ssh' ? route.connectionId : undefined
  )
  let completed = false
  let cleanupPending: JjCleanupPending | undefined
  try {
    await stopPtysForDestructiveWorktreeRemoval(context.runtime, args.worktreeId, {
      ...(route.kind === 'ssh' ? { connectionId: route.connectionId } : {}),
      allowUnverifiedStop: args.allowUnverifiedPtyStop
    })
    const forgotten = await jjBackendForRepo(repo, jjOptions).removeWorkspace({
      name: requested.name,
      targetRoot,
      ownerRoot
    })
    if (!forgotten.ok) {
      throw new Error(forgotten.message)
    }
    if (args.jjRemoval === 'forget-and-delete') {
      try {
        if (route.kind === 'ssh') {
          if (!route.fsProvider) {
            throw new Error(
              'SSH filesystem provider unavailable after JJ forget; directory retained.'
            )
          }
          await route.fsProvider.deletePath(targetRoot, true)
        } else {
          await removeLocalWorktreePath(targetRoot, jjOptions)
        }
      } catch {
        const metadata = readWorktreeMetaForHost(context.store, args.worktreeId, removalHostId)
        cleanupPending = {
          hostId: removalHostId,
          worktreeId: args.worktreeId,
          ...(metadata?.instanceId ? { instanceId: metadata.instanceId } : {}),
          workspaceName: requested.name,
          targetRoot,
          ownerRoot
        }
        writeWorktreeMetaForHost(context.store, args.worktreeId, removalHostId, {
          jjCleanupPending: cleanupPending
        })
      }
    }
    completed = cleanupPending === undefined
  } finally {
    await gate.finish(completed)
  }
  if (cleanupPending) {
    return { jjCleanupPending: cleanupPending }
  }

  context.runtime.clearOptimisticReconcileToken(args.worktreeId)
  removeWorktreeMetadataAndTransientState(
    context.store,
    args.worktreeId,
    removalHostId,
    args.snapshotPruneBatchId
  )
  invalidateAuthorizedRootsCache()
  notifyWorktreesChanged(context.mainWindow, repoId)
  return {}
}

async function removePendingJjWorkspace(
  context: WorktreeIpcContext,
  args: RemoveWorktreeArgs,
  repo: Repo,
  repoId: string,
  worktreePath: string,
  removalHostId: ExecutionHostId
): Promise<RemoveWorktreeResult> {
  const metadata = readWorktreeMetaForHost(context.store, args.worktreeId, removalHostId)
  const pending = metadata?.jjCleanupPending
  if (!pending || pending.hostId !== removalHostId || pending.worktreeId !== args.worktreeId) {
    throw new Error('No host-qualified JJ directory cleanup proof is available; refusing cleanup.')
  }
  if (
    normalizeRuntimePathForComparison(pending.targetRoot) !==
    normalizeRuntimePathForComparison(worktreePath)
  ) {
    throw new Error(
      'JJ cleanup proof target changed; refresh the workspace list and retry cleanup.'
    )
  }
  if (metadata?.instanceId && pending.instanceId && metadata.instanceId !== pending.instanceId) {
    throw new Error('JJ cleanup proof workspace identity changed; refusing cleanup.')
  }
  const jjOptions = getLocalProjectWorktreeGitOptions(context.store, repo)
  const listing = await listJjWorkspacesForRepo(repo, jjOptions)
  if (!listing.ok || !listing.complete) {
    throw new Error(
      listing.ok ? 'JJ workspace roots are incomplete; refusing cleanup.' : listing.message
    )
  }
  const detection = await jjBackendForRepo(repo, jjOptions).detect()
  if (!detection.ok || !detection.root) {
    throw new Error(
      !detection.ok
        ? detection.message
        : 'JJ repository detection returned no structural owner root.'
    )
  }
  if (
    normalizeRuntimePathForComparison(detection.root) !==
    normalizeRuntimePathForComparison(pending.ownerRoot)
  ) {
    throw new Error('JJ cleanup proof repository owner changed; refusing cleanup.')
  }
  if (
    listing.workspaces.some(
      (workspace) =>
        workspace.name === pending.workspaceName ||
        (workspace.root !== null &&
          normalizeRuntimePathForComparison(workspace.root) ===
            normalizeRuntimePathForComparison(pending.targetRoot))
    )
  ) {
    throw new Error('JJ workspace was registered again; refusing cleanup.')
  }
  assertJjWorkspaceCanBePhysicallyDeleted(pending.targetRoot, pending.ownerRoot, listing.workspaces)
  const route = resolveWorktreeRemovalRoute(removalHostId)
  const gate = await context.runtime.acquireFileWatcherRemoval(
    worktreePath,
    route.kind === 'ssh' ? route.connectionId : undefined
  )
  let completed = false
  try {
    await stopPtysForDestructiveWorktreeRemoval(context.runtime, args.worktreeId, {
      ...(route.kind === 'ssh' ? { connectionId: route.connectionId } : {}),
      allowUnverifiedStop: args.allowUnverifiedPtyStop
    })
    if (route.kind === 'ssh') {
      if (!route.fsProvider) {
        throw new Error('SSH filesystem provider unavailable; directory retained.')
      }
      await route.fsProvider.deletePath(pending.targetRoot, true)
    } else {
      await removeLocalWorktreePath(
        pending.targetRoot,
        getLocalProjectWorktreeGitOptions(context.store, repo)
      )
    }
    completed = true
  } finally {
    await gate.finish(completed)
  }
  context.runtime.clearOptimisticReconcileToken(args.worktreeId)
  removeWorktreeMetadataAndTransientState(
    context.store,
    args.worktreeId,
    removalHostId,
    args.snapshotPruneBatchId
  )
  invalidateAuthorizedRootsCache()
  notifyWorktreesChanged(context.mainWindow, repoId)
  return {}
}
