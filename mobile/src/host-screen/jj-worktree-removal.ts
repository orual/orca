import { normalizeExecutionHostId, type ExecutionHostId } from '../../../src/shared/execution-host'
import type { JjCleanupPending } from '../../../src/shared/worktree/types'
import { composeWorktreeHostIdentity } from '../../../src/shared/worktree/host-qualified-identity'
import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import type { Worktree } from '../worktree/workspace-list-sections'

export type JjRemovalMode = 'forget' | 'forget-and-delete' | 'cleanup-only'

export type JjRemovalOutcome =
  | { kind: 'removed' }
  | { kind: 'pending'; proof: JjCleanupPending }
  | { kind: 'rejected'; message: string }
  | { kind: 'uncertain'; message: string }

/** Resolve the execution host without guessing from the phone's host route. */
export function resolveJjRemovalHostId(
  worktree: Pick<Worktree, 'hostId' | 'repoId'>,
  repoHostIdByRepoId: ReadonlyMap<string, ExecutionHostId>
): ExecutionHostId | null {
  return (
    normalizeExecutionHostId(worktree.hostId) ?? repoHostIdByRepoId.get(worktree.repoId) ?? null
  )
}

export function getJjRemovalRowIdentity(
  worktree: Pick<Worktree, 'worktreeId' | 'hostId' | 'repoId'>,
  repoHostIdByRepoId: ReadonlyMap<string, ExecutionHostId>
): string | null {
  const hostId = resolveJjRemovalHostId(worktree, repoHostIdByRepoId)
  return hostId ? composeWorktreeHostIdentity(hostId, worktree.worktreeId) : null
}

function isJjCleanupPending(value: unknown): value is JjCleanupPending {
  if (!value || typeof value !== 'object') {
    return false
  }
  const proof = value as Partial<JjCleanupPending>
  return (
    typeof proof.hostId === 'string' &&
    typeof proof.worktreeId === 'string' &&
    typeof proof.workspaceName === 'string' &&
    typeof proof.targetRoot === 'string' &&
    typeof proof.ownerRoot === 'string'
  )
}

function readRemovalResult(
  response: RpcSuccess,
  hostId: ExecutionHostId,
  worktreeId: string
): JjRemovalOutcome {
  const result = response.result
  if (!result || typeof result !== 'object') {
    return { kind: 'removed' }
  }
  const pending = (result as { jjCleanupPending?: unknown }).jjCleanupPending
  if (pending === undefined) {
    return { kind: 'removed' }
  }
  if (!isJjCleanupPending(pending)) {
    return { kind: 'rejected', message: 'The host returned invalid JJ cleanup proof.' }
  }
  if (pending.hostId !== hostId || pending.worktreeId !== worktreeId) {
    return {
      kind: 'rejected',
      message: 'The host returned cleanup proof for a different workspace.'
    }
  }
  return { kind: 'pending', proof: pending }
}

export async function requestJjWorktreeRemoval(args: {
  client: RpcClient
  worktree: Pick<Worktree, 'worktreeId'>
  hostId: ExecutionHostId
  mode: JjRemovalMode
}): Promise<JjRemovalOutcome> {
  try {
    const response = await args.client.sendRequest('worktree.rm', {
      worktree: `id:${args.worktree.worktreeId}`,
      hostId: args.hostId,
      jjRemoval: args.mode
    })
    if (!response.ok) {
      return {
        kind: 'rejected',
        message: response.error.message || 'The host rejected JJ removal.'
      }
    }
    return readRemovalResult(response, args.hostId, args.worktree.worktreeId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return isRpcDeliveryUnknown(error)
      ? { kind: 'uncertain', message }
      : { kind: 'rejected', message }
  }
}

export function mergePendingJjWorktrees(
  worktrees: readonly Worktree[],
  pending: ReadonlyMap<string, { worktree: Worktree; proof: JjCleanupPending }>,
  repoHostIdByRepoId: ReadonlyMap<string, ExecutionHostId>
): Worktree[] {
  if (pending.size === 0) {
    return [...worktrees]
  }
  const merged = [...worktrees]
  const present = new Set(
    worktrees.flatMap((worktree) => {
      const identity = getJjRemovalRowIdentity(worktree, repoHostIdByRepoId)
      return identity ? [identity] : []
    })
  )
  for (const entry of pending.values()) {
    const worktree =
      entry.worktree.hostId === entry.proof.hostId
        ? entry.worktree
        : { ...entry.worktree, hostId: entry.proof.hostId }
    const identity = getJjRemovalRowIdentity(worktree, repoHostIdByRepoId)
    if (identity && !present.has(identity)) {
      merged.push(worktree)
    }
  }
  return merged
}
