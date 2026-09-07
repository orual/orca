import type {
  JjBookmarkMutationInput,
  JjBookmarkMutationResult,
  JjCommitInput,
  JjCommitResult,
  JjDescribeInput,
  JjDescribeResult,
  JjRemoteFetchInput,
  JjRemoteFetchResult,
  JjRemotePushInput,
  JjRemotePushResult,
  JjWorkspaceStaleRecoveryResult
} from '../../../shared/jj-types'
import {
  callRuntimeRpc,
  enqueueMutation,
  mutationQueueKey,
  RuntimeRpcCallError,
  uncertainMutationResult
} from './runtime-jj-client-shared'
import type { RuntimeGitContext } from './runtime-git-client-context'

export function commitRuntimeJj(
  context: RuntimeGitContext,
  input: JjCommitInput,
  options: { signal?: AbortSignal } = {}
): Promise<JjCommitResult> {
  const { target, worktree, key } = mutationQueueKey(context)
  return enqueueMutation(key, async () => {
    try {
      return await callRuntimeRpc<JjCommitResult>(
        target,
        'jj.commit',
        { worktree, ...input },
        { timeoutMs: 30_000, signal: options.signal }
      )
    } catch (error) {
      // A missing method proves an old host rejected before dispatch; other rejection loses the boundary between dispatch and reply.
      if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
        throw error
      }
      return uncertainMutationResult('jj commit', error) as JjCommitResult
    }
  })
}

export function fetchRuntimeJjRemote(
  context: RuntimeGitContext,
  input: JjRemoteFetchInput,
  options: { signal?: AbortSignal } = {}
): Promise<JjRemoteFetchResult> {
  const { target, worktree, key } = mutationQueueKey(context)
  return enqueueMutation(key, async () => {
    try {
      return await callRuntimeRpc<JjRemoteFetchResult>(
        target,
        'jj.fetchRemote',
        { worktree, ...input },
        { timeoutMs: 30_000, signal: options.signal }
      )
    } catch (error) {
      if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
        throw error
      }
      return uncertainMutationResult('jj fetch', error) as JjRemoteFetchResult
    }
  })
}

export function pushRuntimeJjBookmark(
  context: RuntimeGitContext,
  input: JjRemotePushInput,
  options: { signal?: AbortSignal } = {}
): Promise<JjRemotePushResult> {
  const { target, worktree, key } = mutationQueueKey(context)
  return enqueueMutation(key, async () => {
    try {
      return await callRuntimeRpc<JjRemotePushResult>(
        target,
        'jj.pushBookmark',
        { worktree, ...input },
        { timeoutMs: 30_000, signal: options.signal }
      )
    } catch (error) {
      if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
        throw error
      }
      return uncertainMutationResult('jj push', error) as JjRemotePushResult
    }
  })
}

export function describeRuntimeJjCurrentChange(
  context: RuntimeGitContext,
  input: JjDescribeInput,
  options: { signal?: AbortSignal } = {}
): Promise<JjDescribeResult> {
  const { target, worktree, key } = mutationQueueKey(context)
  return enqueueMutation(key, async () => {
    try {
      return await callRuntimeRpc<JjDescribeResult>(
        target,
        'jj.describe',
        { worktree, ...input },
        { timeoutMs: 30_000, signal: options.signal }
      )
    } catch (error) {
      if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
        throw error
      }
      return uncertainMutationResult('jj describe', error)
    }
  })
}

export function createRuntimeJjBookmark(
  context: RuntimeGitContext,
  input: JjBookmarkMutationInput,
  options: { signal?: AbortSignal } = {}
): Promise<JjBookmarkMutationResult> {
  const { target, worktree, key } = mutationQueueKey(context)
  return enqueueMutation(key, async () => {
    try {
      return await callRuntimeRpc<JjBookmarkMutationResult>(
        target,
        'jj.createBookmark',
        { worktree, ...input },
        { timeoutMs: 30_000, signal: options.signal }
      )
    } catch (error) {
      if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
        throw error
      }
      return uncertainMutationResult('jj bookmark create', error)
    }
  })
}

export function moveRuntimeJjBookmark(
  context: RuntimeGitContext,
  input: JjBookmarkMutationInput,
  options: { signal?: AbortSignal } = {}
): Promise<JjBookmarkMutationResult> {
  const { target, worktree, key } = mutationQueueKey(context)
  return enqueueMutation(key, async () => {
    try {
      return await callRuntimeRpc<JjBookmarkMutationResult>(
        target,
        'jj.moveBookmark',
        { worktree, ...input },
        { timeoutMs: 30_000, signal: options.signal }
      )
    } catch (error) {
      if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
        throw error
      }
      return uncertainMutationResult('jj bookmark move', error)
    }
  })
}

export function updateRuntimeJjWorkspaceStale(
  context: RuntimeGitContext,
  options: { signal?: AbortSignal } = {}
): Promise<JjWorkspaceStaleRecoveryResult> {
  const { target, worktree, key } = mutationQueueKey(context)
  return enqueueMutation(key, async () => {
    try {
      return await callRuntimeRpc<JjWorkspaceStaleRecoveryResult>(
        target,
        'jj.updateWorkspaceStale',
        { worktree },
        { timeoutMs: 30_000, signal: options.signal }
      )
    } catch (error) {
      if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
        throw error
      }
      return {
        ok: false,
        kind: 'uncertain',
        uncertain: true,
        message: `jj workspace recovery outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  })
}
