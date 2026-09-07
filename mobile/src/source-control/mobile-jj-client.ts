import type {
  JjBookmarkMutationInput,
  JjBookmarkMutationResult,
  JjChangesResult,
  JjCommitInput,
  JjCommitResult,
  JjCurrentChangeMetadataResult,
  JjDescribeInput,
  JjDescribeResult,
  JjFileDiffInput,
  JjFileDiffResult,
  JjLocalBookmarksResult,
  JjRemoteFetchInput,
  JjRemoteFetchResult,
  JjRemoteListResult,
  JjRemotePushInput,
  JjRemotePushResult,
  JjWorkspaceStaleRecoveryResult
} from '../../../src/shared/jj-types'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'

export type JjRpcClient = Pick<RpcClient, 'sendRequest'>

export type JjRpcError = Error & { code?: string }

export function jjSelector(worktreeId: string): string {
  return `id:${worktreeId}`
}

function resultOf<T>(response: RpcSuccess | RpcFailure): T {
  if (!response.ok) {
    const error = new Error(response.error.message) as JjRpcError
    error.code = response.error.code
    throw error
  }
  return response.result as T
}

export async function listMobileJjChanges(
  client: JjRpcClient,
  worktreeId: string,
  signal?: AbortSignal
): Promise<JjChangesResult> {
  const response = await client.sendRequest(
    'jj.listChanges',
    { worktree: jjSelector(worktreeId) },
    { timeoutMs: 15_000, failWhenDisconnected: true }
  )
  if (signal?.aborted) {
    throw new Error('request_aborted')
  }
  return resultOf<JjChangesResult>(response)
}

async function readMobileJj(
  client: JjRpcClient,
  method: string,
  worktreeId: string,
  input: Record<string, unknown> = {},
  timeoutMs = 15_000
): Promise<unknown> {
  const response = await client.sendRequest(
    method,
    { worktree: jjSelector(worktreeId), ...input },
    { timeoutMs, failWhenDisconnected: true }
  )
  return resultOf(response)
}

export function listMobileJjLocalBookmarks(
  client: JjRpcClient,
  worktreeId: string
): Promise<JjLocalBookmarksResult> {
  return readMobileJj(
    client,
    'jj.listLocalBookmarks',
    worktreeId
  ) as Promise<JjLocalBookmarksResult>
}

export function listMobileJjRemotes(
  client: JjRpcClient,
  worktreeId: string
): Promise<JjRemoteListResult> {
  return readMobileJj(client, 'jj.listRemotes', worktreeId) as Promise<JjRemoteListResult>
}

async function uncertainMutation<T>(action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (isJjMethodUnavailable(error)) {
      throw error
    }
    return uncertainResult<T>(
      `${action} outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function describeMobileJj(
  client: JjRpcClient,
  worktreeId: string,
  input: JjDescribeInput
): Promise<JjDescribeResult> {
  return uncertainMutation(
    'jj describe',
    () =>
      readMobileJj(client, 'jj.describe', worktreeId, input, 30_000) as Promise<JjDescribeResult>
  )
}

export function createMobileJjBookmark(
  client: JjRpcClient,
  worktreeId: string,
  input: JjBookmarkMutationInput
): Promise<JjBookmarkMutationResult> {
  return uncertainMutation(
    'jj bookmark create',
    () =>
      readMobileJj(
        client,
        'jj.createBookmark',
        worktreeId,
        input,
        30_000
      ) as Promise<JjBookmarkMutationResult>
  )
}

export function moveMobileJjBookmark(
  client: JjRpcClient,
  worktreeId: string,
  input: JjBookmarkMutationInput
): Promise<JjBookmarkMutationResult> {
  return uncertainMutation(
    'jj bookmark move',
    () =>
      readMobileJj(
        client,
        'jj.moveBookmark',
        worktreeId,
        input,
        30_000
      ) as Promise<JjBookmarkMutationResult>
  )
}

export function fetchMobileJjRemote(
  client: JjRpcClient,
  worktreeId: string,
  input: JjRemoteFetchInput
): Promise<JjRemoteFetchResult> {
  return uncertainMutation(
    'jj fetch',
    () =>
      readMobileJj(
        client,
        'jj.fetchRemote',
        worktreeId,
        input,
        30_000
      ) as Promise<JjRemoteFetchResult>
  )
}

export function pushMobileJjBookmark(
  client: JjRpcClient,
  worktreeId: string,
  input: JjRemotePushInput
): Promise<JjRemotePushResult> {
  return uncertainMutation(
    'jj push',
    () =>
      readMobileJj(
        client,
        'jj.pushBookmark',
        worktreeId,
        input,
        30_000
      ) as Promise<JjRemotePushResult>
  )
}

export async function getMobileJjMetadata(
  client: JjRpcClient,
  worktreeId: string
): Promise<JjCurrentChangeMetadataResult> {
  const response = await client.sendRequest('jj.getCurrentChangeMetadata', {
    worktree: jjSelector(worktreeId)
  })
  return resultOf<JjCurrentChangeMetadataResult>(response)
}

export async function readMobileJjFileDiff(
  client: JjRpcClient,
  worktreeId: string,
  input: JjFileDiffInput,
  signal?: AbortSignal
): Promise<JjFileDiffResult> {
  const response = await client.sendRequest(
    'jj.readFileDiff',
    { worktree: jjSelector(worktreeId), ...input },
    { timeoutMs: 30_000, failWhenDisconnected: true }
  )
  if (signal?.aborted) {
    throw new Error('request_aborted')
  }
  return resultOf<JjFileDiffResult>(response)
}

export function isJjMethodUnavailable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'method_not_found'
  )
}

function uncertainResult<T>(message: string): T {
  return {
    ok: false,
    kind: 'uncertain',
    uncertain: true,
    message
  } as unknown as T
}

export async function commitMobileJj(
  client: JjRpcClient,
  worktreeId: string,
  input: JjCommitInput
): Promise<JjCommitResult> {
  try {
    const response = await client.sendRequest(
      'jj.commit',
      { worktree: jjSelector(worktreeId), ...input },
      { timeoutMs: 30_000, failWhenDisconnected: true }
    )
    return resultOf<JjCommitResult>(response)
  } catch (error) {
    if (isJjMethodUnavailable(error)) {
      throw error
    }
    return uncertainResult<JjCommitResult>(
      `jj commit outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export async function updateMobileJjWorkspaceStale(
  client: JjRpcClient,
  worktreeId: string
): Promise<JjWorkspaceStaleRecoveryResult> {
  try {
    const response = await client.sendRequest(
      'jj.updateWorkspaceStale',
      { worktree: jjSelector(worktreeId) },
      { timeoutMs: 30_000, failWhenDisconnected: true }
    )
    return resultOf<JjWorkspaceStaleRecoveryResult>(response)
  } catch (error) {
    if (isJjMethodUnavailable(error)) {
      throw error
    }
    return uncertainResult<JjWorkspaceStaleRecoveryResult>(
      `jj workspace recovery outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function readJjWorktreeKind(value: unknown): 'jj' | 'git' {
  if (!value || typeof value !== 'object') {
    return 'git'
  }
  const worktree = (value as { worktree?: unknown }).worktree
  if (!worktree || typeof worktree !== 'object') {
    return 'git'
  }
  const row = worktree as { workspaceKind?: unknown; jjWorkspace?: unknown }
  return row.workspaceKind === 'jj' || row.jjWorkspace !== undefined ? 'jj' : 'git'
}
