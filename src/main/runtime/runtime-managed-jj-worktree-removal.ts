import type { Repo } from '../../shared/repo-types'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { RemoveWorktreeResult } from '../../shared/worktree/create-types'
import type { JjCleanupPending } from '../../shared/worktree/types'
import type { RuntimeStore } from './runtime-store-contract'
import type { RuntimeJjCommands } from './orca-runtime-jj'
import {
  readWorktreeMetaForHost,
  writeWorktreeMetaForHost
} from '../persistence/host-qualified-worktree-meta'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { assertJjWorkspaceCanBePhysicallyDeleted } from '../jj/jj-workspace-catalog'
import { resolveWorktreeRemovalRoute } from '../worktree-removal-execution-host-route'
import { removeLocalWorktreePath } from '../local-worktree-filesystem'
import { invalidateAuthorizedRootsCache } from '../ipc/filesystem-auth'
import { parseExecutionHostId } from '../../shared/execution-host'
import { getLocalProjectWorktreeGitOptions as resolveLocalGitOptions } from '../project-runtime-git-options'

type RemovalGate = { finish(completed: boolean): Promise<void> }

export type RuntimeManagedJjRemovalHost = {
  jjCommands: RuntimeJjCommands
  acquireFileWatcherRemoval(path: string, connectionId?: string): Promise<RemovalGate>
  stopPtysForDestructiveWorktreeRemoval(
    worktreeId: string,
    options: { connectionId?: string; allowUnverifiedStop?: boolean }
  ): Promise<void>
  clearOptimisticReconcileToken(worktreeId: string): void
  removeWorktreeMetadataAndHistory(
    store: RuntimeStore,
    worktreeId: string,
    hostId?: ExecutionHostId
  ): void
  preservedBranchCleanup: { delete(worktreeId: string, hostId?: string): void }
  invalidateResolvedWorktreeCache(): void
  invalidateWorktreeScanCacheForRepo(repoId: string): void
  notifyWorktreesChanged(repoId: string): void
}

type JjRemovalArgs = {
  selector: string
  target: { id: string; repoId: string; path: string }
  repo: Repo
  removalHostId: ExecutionHostId | undefined
  jjRemoval: 'forget' | 'forget-and-delete' | 'cleanup-only'
  allowUnverifiedPtyStop: boolean
  store: RuntimeStore
}

export async function removeManagedJjWorkspace(
  runtime: RuntimeManagedJjRemovalHost,
  args: JjRemovalArgs
): Promise<RemoveWorktreeResult> {
  const { selector, target, repo, removalHostId, jjRemoval, allowUnverifiedPtyStop, store } = args
  if (jjRemoval === 'cleanup-only') {
    return removeRuntimePendingJjWorkspace(runtime, args)
  }
  const listed = await runtime.jjCommands.listRuntimeJjWorkspaces(selector)
  if (!listed.ok) {
    throw new Error(listed.message)
  }
  const requested = listed.workspaces.find(
    (workspace) =>
      workspace.root !== null &&
      normalizeRuntimePathForComparison(workspace.root) ===
        normalizeRuntimePathForComparison(target.path)
  )
  if (!requested?.root) {
    throw new Error(`JJ workspace is no longer registered at ${target.path}; refusing removal.`)
  }
  if (!removalHostId) {
    throw new Error('JJ workspace removal has no execution host; refusing removal.')
  }
  const metadata = readWorktreeMetaForHost(store, target.id, removalHostId)?.jjWorkspace
  if (!metadata?.rootResolved || metadata.name !== requested.name) {
    throw new Error('JJ workspace identity changed; refresh the workspace list and retry removal.')
  }
  const detection = await runtime.jjCommands.detectRuntimeJj(selector)
  if (!detection.ok) {
    throw new Error(detection.message)
  }
  const ownerRoot = detection.root
  const targetRoot = requested.root
  if (jjRemoval === 'forget-and-delete') {
    assertJjWorkspaceCanBePhysicallyDeleted(targetRoot, ownerRoot, listed.workspaces)
  }
  const route = resolveWorktreeRemovalRoute(removalHostId as never)
  const gate = await runtime.acquireFileWatcherRemoval(
    target.path,
    route.kind === 'ssh' ? route.connectionId : undefined
  )
  let completed = false
  let cleanupPending: JjCleanupPending | undefined
  try {
    await runtime.stopPtysForDestructiveWorktreeRemoval(target.id, {
      ...(route.kind === 'ssh' ? { connectionId: route.connectionId } : {}),
      allowUnverifiedStop: allowUnverifiedPtyStop
    })
    const forgotten = await runtime.jjCommands.removeRuntimeJjWorkspace(selector, {
      name: requested.name,
      targetRoot,
      ownerRoot
    })
    if (!forgotten.ok) {
      throw new Error(forgotten.message)
    }
    if (jjRemoval === 'forget-and-delete') {
      try {
        if (route.kind === 'ssh') {
          if (!route.fsProvider) {
            throw new Error(
              'SSH filesystem provider unavailable after JJ forget; directory retained.'
            )
          }
          await route.fsProvider.deletePath(targetRoot, true)
        } else {
          await removeLocalWorktreePath(targetRoot, resolveLocalGitOptions(store as never, repo))
        }
      } catch {
        const metadata = readWorktreeMetaForHost(store, target.id, removalHostId)
        cleanupPending = {
          hostId: removalHostId,
          worktreeId: target.id,
          ...(metadata?.instanceId ? { instanceId: metadata.instanceId } : {}),
          workspaceName: requested.name,
          targetRoot,
          ownerRoot
        }
        writeWorktreeMetaForHost(store, target.id, removalHostId, {
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
  finishJjRemoval(runtime, store, target, repo, removalHostId)
  return {}
}

async function removeRuntimePendingJjWorkspace(
  runtime: RuntimeManagedJjRemovalHost,
  args: JjRemovalArgs
): Promise<RemoveWorktreeResult> {
  const { selector, target, repo, removalHostId, allowUnverifiedPtyStop, store } = args
  if (!removalHostId) {
    throw new Error('JJ cleanup proof has no execution host; refusing cleanup.')
  }
  const metadata = readWorktreeMetaForHost(store, target.id, removalHostId)
  const pending = metadata?.jjCleanupPending
  if (!pending || pending.hostId !== removalHostId || pending.worktreeId !== target.id) {
    throw new Error('No host-qualified JJ directory cleanup proof is available; refusing cleanup.')
  }
  if (
    normalizeRuntimePathForComparison(pending.targetRoot) !==
    normalizeRuntimePathForComparison(target.path)
  ) {
    throw new Error(
      'JJ cleanup proof target changed; refresh the workspace list and retry cleanup.'
    )
  }
  if (metadata?.instanceId && pending.instanceId && metadata.instanceId !== pending.instanceId) {
    throw new Error('JJ cleanup proof workspace identity changed; refusing cleanup.')
  }
  const listed = await runtime.jjCommands.listRuntimeJjWorkspaces(selector)
  if (!listed.ok || !listed.workspaces.every((workspace) => workspace.root !== null)) {
    throw new Error(
      listed.ok ? 'JJ workspace roots are incomplete; refusing cleanup.' : listed.message
    )
  }
  const detection = await runtime.jjCommands.detectRuntimeJj(selector)
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
    listed.workspaces.some(
      (workspace) =>
        workspace.name === pending.workspaceName ||
        (workspace.root !== null &&
          normalizeRuntimePathForComparison(workspace.root) ===
            normalizeRuntimePathForComparison(pending.targetRoot))
    )
  ) {
    throw new Error('JJ workspace was registered again; refusing cleanup.')
  }
  assertJjWorkspaceCanBePhysicallyDeleted(pending.targetRoot, pending.ownerRoot, listed.workspaces)
  const route = resolveWorktreeRemovalRoute(removalHostId)
  const gate = await runtime.acquireFileWatcherRemoval(
    target.path,
    route.kind === 'ssh' ? route.connectionId : undefined
  )
  let completed = false
  try {
    await runtime.stopPtysForDestructiveWorktreeRemoval(target.id, {
      ...(route.kind === 'ssh' ? { connectionId: route.connectionId } : {}),
      allowUnverifiedStop: allowUnverifiedPtyStop
    })
    if (route.kind === 'ssh') {
      if (!route.fsProvider) {
        throw new Error('SSH filesystem provider unavailable; directory retained.')
      }
      await route.fsProvider.deletePath(pending.targetRoot, true)
    } else {
      await removeLocalWorktreePath(
        pending.targetRoot,
        resolveLocalGitOptions(store as never, repo)
      )
    }
    completed = true
  } finally {
    await gate.finish(completed)
  }
  finishJjRemoval(runtime, store, target, repo, removalHostId)
  return {}
}

function finishJjRemoval(
  runtime: RuntimeManagedJjRemovalHost,
  store: RuntimeStore,
  target: { id: string; repoId: string },
  repo: Repo,
  removalHostId: ExecutionHostId | undefined
): void {
  runtime.clearOptimisticReconcileToken(target.id)
  runtime.removeWorktreeMetadataAndHistory(store, target.id, removalHostId)
  runtime.preservedBranchCleanup.delete(target.id, parseExecutionHostId(removalHostId)?.id)
  runtime.invalidateResolvedWorktreeCache()
  runtime.invalidateWorktreeScanCacheForRepo(target.repoId)
  invalidateAuthorizedRootsCache()
  runtime.notifyWorktreesChanged(repo.id)
}
