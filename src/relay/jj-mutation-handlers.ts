import type { RequestContext } from './dispatcher'
import { backendForRequest, boundResult, type JjBackendFactory } from './jj-handler-context'
import {
  inputValue,
  parseBookmarkMutationInput,
  parseCommitInput,
  parseDescribeInput,
  parseRemoteFetchInput,
  parseRemotePushInput,
  parseWorkspaceAddInput,
  parseWorkspaceRemoveInput
} from './jj-request-validation'

export async function addWorkspace(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  const backend = backendForRequest(params, context, backendFactory)
  return boundResult(await backend.addWorkspace(parseWorkspaceAddInput(inputValue(params))))
}

export async function removeWorkspace(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  const backend = backendForRequest(params, context, backendFactory)
  return boundResult(await backend.removeWorkspace(parseWorkspaceRemoveInput(inputValue(params))))
}

export async function fetchRemote(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  const backend = backendForRequest(params, context, backendFactory)
  return boundResult(await backend.fetchRemote(parseRemoteFetchInput(inputValue(params))))
}

export async function pushBookmark(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  const backend = backendForRequest(params, context, backendFactory)
  return boundResult(await backend.pushBookmark(parseRemotePushInput(inputValue(params))))
}

export async function describe(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  const backend = backendForRequest(params, context, backendFactory)
  return boundResult(await backend.describe(parseDescribeInput(inputValue(params))))
}

export async function createBookmark(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  const backend = backendForRequest(params, context, backendFactory)
  return boundResult(await backend.createBookmark(parseBookmarkMutationInput(inputValue(params))))
}

export async function moveBookmark(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  const backend = backendForRequest(params, context, backendFactory)
  return boundResult(await backend.moveBookmark(parseBookmarkMutationInput(inputValue(params))))
}

export async function commit(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  const backend = backendForRequest(params, context, backendFactory)
  return boundResult(await backend.commit(parseCommitInput(inputValue(params))))
}

export async function updateWorkspaceStale(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  return boundResult(
    await backendForRequest(params, context, backendFactory).updateWorkspaceStale()
  )
}
