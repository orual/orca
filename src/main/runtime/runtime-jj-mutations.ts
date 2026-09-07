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
  JjWorkspaceAddInput,
  JjWorkspaceAddResult,
  JjWorkspaceRemoveInput,
  JjWorkspaceRemoveResult,
  JjWorkspaceStaleRecoveryResult
} from '../../shared/jj-types'
import { normalizeWorkspaceAddInput } from './runtime-jj-inputs'
import {
  runRuntimeJj,
  type RuntimeJjCommandHost,
  type RuntimeJjRequestOptions
} from './runtime-jj-operation-context'

export function addRuntimeJjWorkspace(
  host: RuntimeJjCommandHost,
  selector: string,
  input: JjWorkspaceAddInput,
  options?: RuntimeJjRequestOptions
): Promise<JjWorkspaceAddResult> {
  return runRuntimeJj(host, selector, options, async (route, target) => {
    const normalizedInput = normalizeWorkspaceAddInput(input, route)
    const result =
      route.kind === 'local'
        ? await route.backend.addWorkspace(normalizedInput)
        : await route.provider.addWorkspace(target.worktree.path, normalizedInput, options)
    return result.ok ? { ...result, destination: input.destination } : result
  })
}

export function removeRuntimeJjWorkspace(
  host: RuntimeJjCommandHost,
  selector: string,
  input: JjWorkspaceRemoveInput,
  options?: RuntimeJjRequestOptions
): Promise<JjWorkspaceRemoveResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.removeWorkspace(input)
      : route.provider.removeWorkspace(target.worktree.path, input, options)
  )
}

export function fetchRuntimeJjRemote(
  host: RuntimeJjCommandHost,
  selector: string,
  input: JjRemoteFetchInput,
  options?: RuntimeJjRequestOptions
): Promise<JjRemoteFetchResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.fetchRemote(input)
      : route.provider.fetchRemote(target.worktree.path, input, options)
  )
}

export function pushRuntimeJjBookmark(
  host: RuntimeJjCommandHost,
  selector: string,
  input: JjRemotePushInput,
  options?: RuntimeJjRequestOptions
): Promise<JjRemotePushResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.pushBookmark(input)
      : route.provider.pushBookmark(target.worktree.path, input, options)
  )
}

export function describeRuntimeJjCurrentChange(
  host: RuntimeJjCommandHost,
  selector: string,
  input: JjDescribeInput,
  options?: RuntimeJjRequestOptions
): Promise<JjDescribeResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.describe(input)
      : route.provider.describe(target.worktree.path, input, options)
  )
}

export function createRuntimeJjBookmark(
  host: RuntimeJjCommandHost,
  selector: string,
  input: JjBookmarkMutationInput,
  options?: RuntimeJjRequestOptions
): Promise<JjBookmarkMutationResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.createBookmark(input)
      : route.provider.createBookmark(target.worktree.path, input, options)
  )
}

export function moveRuntimeJjBookmark(
  host: RuntimeJjCommandHost,
  selector: string,
  input: JjBookmarkMutationInput,
  options?: RuntimeJjRequestOptions
): Promise<JjBookmarkMutationResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.moveBookmark(input)
      : route.provider.moveBookmark(target.worktree.path, input, options)
  )
}

export function commitRuntimeJj(
  host: RuntimeJjCommandHost,
  selector: string,
  input: JjCommitInput,
  options?: RuntimeJjRequestOptions
): Promise<JjCommitResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.commit(input)
      : route.provider.commit(target.worktree.path, input, options)
  )
}

export function updateRuntimeJjWorkspaceStale(
  host: RuntimeJjCommandHost,
  selector: string,
  options?: RuntimeJjRequestOptions
): Promise<JjWorkspaceStaleRecoveryResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.updateWorkspaceStale()
      : route.provider.updateWorkspaceStale(target.worktree.path, options)
  )
}
