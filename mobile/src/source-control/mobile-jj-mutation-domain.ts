import type {
  JjBookmarkMutationResult,
  JjCommitIntent,
  JjCommitResult,
  JjDescribeResult,
  JjRemoteFetchResult,
  JjRemotePushResult,
  JjWorkspaceStaleRecoveryResult
} from '../../../src/shared/jj-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { commitMobileJj, updateMobileJjWorkspaceStale } from './mobile-jj-client'
import type { MobileJjIdentity, MobileJjScreenState } from './mobile-jj-source-control-types'

export type MobileJjMutationState = {
  identity: MobileJjIdentity
  busyAction: string | null
  uncertain: boolean
  error: string | null
}

export type MobileJjMutationOutcome = {
  ok: boolean
  kind?: string
  message?: string
}

export type MobileJjMutationRuntime = {
  client: RpcClient | null
  connState: ConnectionState
  identity: MobileJjIdentity
  identityRef: { current: MobileJjIdentity }
  mountedRef: { current: boolean }
  operationGenerationRef: { current: number }
  mutationBusyRef: { current: boolean }
  mutationUncertainRef: { current: boolean }
  screenState: MobileJjScreenState
  commitMessage: string
  selectedPaths: readonly string[]
  enqueue: <T>(action: () => Promise<T>) => Promise<T>
  setBusyAction: (action: string | null) => void
  setMutationUncertain: (uncertain: boolean) => void
  setMutationError: (error: string | null) => void
  setCommitMessage: (message: string) => void
  setScreenState: (state: MobileJjScreenState) => void
  refresh: () => Promise<boolean>
}

export function sameMobileJjIdentity(left: MobileJjIdentity, right: MobileJjIdentity): boolean {
  return (
    left.hostId === right.hostId &&
    left.worktreeId === right.worktreeId &&
    left.client === right.client &&
    left.clientId === right.clientId
  )
}

export function isCurrentMobileJjMutation(
  identityRef: { current: MobileJjIdentity },
  identity: MobileJjIdentity,
  generationRef: { current: number },
  generation: number,
  mountedRef: { current: boolean }
): boolean {
  return (
    mountedRef.current &&
    generationRef.current === generation &&
    sameMobileJjIdentity(identityRef.current, identity)
  )
}

export function readMobileJjMutationOutcome(value: unknown): MobileJjMutationOutcome {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: 'jj operation failed' }
  }
  return value as MobileJjMutationOutcome
}

function canStartMutation(runtime: MobileJjMutationRuntime): boolean {
  return (
    !runtime.mutationBusyRef.current &&
    !runtime.mutationUncertainRef.current &&
    runtime.client !== null &&
    runtime.connState === 'connected'
  )
}

function finishMutation(
  runtime: MobileJjMutationRuntime,
  identity: MobileJjIdentity,
  generation: number
): void {
  if (
    !isCurrentMobileJjMutation(
      runtime.identityRef,
      identity,
      runtime.operationGenerationRef,
      generation,
      runtime.mountedRef
    )
  ) {
    return
  }
  runtime.mutationBusyRef.current = false
  runtime.setBusyAction(null)
}

function markFailure(runtime: MobileJjMutationRuntime, result: MobileJjMutationOutcome): void {
  if (result.kind === 'uncertain') {
    runtime.mutationUncertainRef.current = true
    runtime.setMutationUncertain(true)
    runtime.setMutationError(result.message ?? 'Mutation outcome is uncertain')
    return
  }
  runtime.setMutationError(result.message ?? 'jj operation failed')
  if (result.kind === 'stale') {
    runtime.setScreenState({ kind: 'stale', message: result.message ?? 'Workspace is stale' })
  }
}

export async function runMobileJjCommit(
  runtime: MobileJjMutationRuntime,
  intent?: JjCommitIntent
): Promise<JjCommitResult | null> {
  const current = runtime.screenState
  const identity = runtime.identity
  const generation = runtime.operationGenerationRef.current
  if (!canStartMutation(runtime) || current.kind !== 'ready' || !runtime.commitMessage.trim()) {
    return null
  }
  const chosen =
    intent ??
    (runtime.selectedPaths.length > 0
      ? { kind: 'selected' as const, paths: [...runtime.selectedPaths] }
      : { kind: 'all' as const })
  runtime.mutationBusyRef.current = true
  runtime.setBusyAction('commit')
  runtime.setMutationError(null)
  try {
    return await runtime.enqueue(async () => {
      const result = await commitMobileJj(identity.client as RpcClient, identity.worktreeId, {
        expectedCommitId: current.metadata.commitId,
        message: runtime.commitMessage.trim(),
        intent: chosen
      })
      if (
        !isCurrentMobileJjMutation(
          runtime.identityRef,
          identity,
          runtime.operationGenerationRef,
          generation,
          runtime.mountedRef
        )
      ) {
        return result
      }
      if (result.ok) {
        runtime.setCommitMessage('')
        await runtime.refresh()
      } else {
        markFailure(runtime, result)
      }
      return result
    })
  } finally {
    finishMutation(runtime, identity, generation)
  }
}

export async function runMobileJjMutation<
  T extends JjBookmarkMutationResult | JjRemoteFetchResult | JjRemotePushResult | JjDescribeResult
>(
  runtime: MobileJjMutationRuntime,
  action: string,
  operation: (commitId: string) => Promise<T>
): Promise<T | null> {
  const current = runtime.screenState
  const identity = runtime.identity
  const generation = runtime.operationGenerationRef.current
  if (!canStartMutation(runtime) || current.kind !== 'ready') {
    return null
  }
  runtime.mutationBusyRef.current = true
  runtime.setBusyAction(action)
  runtime.setMutationError(null)
  try {
    return await runtime.enqueue(async () => {
      const result = await operation(current.metadata.commitId)
      if (
        !isCurrentMobileJjMutation(
          runtime.identityRef,
          identity,
          runtime.operationGenerationRef,
          generation,
          runtime.mountedRef
        )
      ) {
        return result
      }
      if (result.ok) {
        await runtime.refresh()
      } else {
        markFailure(runtime, result)
      }
      return result
    })
  } finally {
    finishMutation(runtime, identity, generation)
  }
}

export async function runMobileJjStaleRecovery(
  runtime: MobileJjMutationRuntime
): Promise<JjWorkspaceStaleRecoveryResult | null> {
  const identity = runtime.identity
  const generation = runtime.operationGenerationRef.current
  if (!canStartMutation(runtime)) {
    return null
  }
  runtime.mutationBusyRef.current = true
  runtime.setBusyAction('update-stale')
  runtime.setMutationError(null)
  try {
    return await runtime.enqueue(async () => {
      const result = await updateMobileJjWorkspaceStale(
        identity.client as RpcClient,
        identity.worktreeId
      )
      if (
        !isCurrentMobileJjMutation(
          runtime.identityRef,
          identity,
          runtime.operationGenerationRef,
          generation,
          runtime.mountedRef
        )
      ) {
        return result
      }
      if (result.ok) {
        runtime.setMutationError(null)
        await runtime.refresh()
      } else {
        markFailure(runtime, result)
      }
      return result
    })
  } finally {
    finishMutation(runtime, identity, generation)
  }
}
