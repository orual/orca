import type { JjDescribeResult } from '../../../shared/jj-types'
import { callRuntimeRpc, getActiveRuntimeTarget, RuntimeRpcCallError } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import type { RuntimeGitContext } from './runtime-git-client-context'

export function requireWorktreeId(context: RuntimeGitContext): string {
  const worktreeId = context.worktreeId?.trim()
  if (!worktreeId) {
    throw new Error('Missing runtime worktree')
  }
  return worktreeId
}

export function selectorFor(context: RuntimeGitContext): string {
  return toRuntimeWorktreeSelector(requireWorktreeId(context))
}

const mutationTails = new Map<string, Promise<void>>()

export function enqueueMutation<TResult>(
  key: string,
  operation: () => Promise<TResult>
): Promise<TResult> {
  const previous = mutationTails.get(key) ?? Promise.resolve()
  const next = previous.then(operation)
  const settled = next.then(
    () => undefined,
    () => undefined
  )
  mutationTails.set(key, settled)
  void settled.then(() => {
    if (mutationTails.get(key) === settled) {
      mutationTails.delete(key)
    }
  })
  return next
}

export function mutationQueueKey(context: RuntimeGitContext): {
  target: ReturnType<typeof getActiveRuntimeTarget>
  worktree: string
  key: string
} {
  const target = getActiveRuntimeTarget(context.settings)
  const worktree = selectorFor(context)
  const targetKey = target.kind === 'local' ? 'local' : `environment:${target.environmentId}`
  return { target, worktree, key: `${targetKey}:${worktree}` }
}

export function uncertainMutationResult(operation: string, error: unknown): JjDescribeResult {
  return {
    ok: false,
    kind: 'uncertain',
    uncertain: true,
    message: `${operation} outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
  }
}

export { callRuntimeRpc, getActiveRuntimeTarget, RuntimeRpcCallError }
