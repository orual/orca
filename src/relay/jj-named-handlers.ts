import { backendForRequest, boundResult, type JjBackendFactory } from './jj-handler-context'
import type { RequestContext } from './dispatcher'

export async function detect(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  return boundResult(await backendForRequest(params, context, backendFactory).detect())
}

export async function listWorkspaces(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  return boundResult(await backendForRequest(params, context, backendFactory).listWorkspaces())
}

export async function listChanges(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  return boundResult(await backendForRequest(params, context, backendFactory).listChanges())
}

export async function getCurrentChangeMetadata(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  return boundResult(
    await backendForRequest(params, context, backendFactory).getCurrentChangeMetadata()
  )
}

export async function listLocalBookmarks(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  return boundResult(await backendForRequest(params, context, backendFactory).listLocalBookmarks())
}

export async function listRemotes(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  return boundResult(await backendForRequest(params, context, backendFactory).listRemotes())
}
