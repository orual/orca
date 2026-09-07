import type { RequestContext } from './dispatcher'
import { backendForRequest, boundResult, type JjBackendFactory } from './jj-handler-context'
import { inputValue, parseFileDiffInput } from './jj-request-validation'

export async function readFileDiff(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): Promise<unknown> {
  const backend = backendForRequest(params, context, backendFactory)
  return boundResult(await backend.readFileDiff(parseFileDiffInput(inputValue(params))))
}

export type ReadJjHandler = (
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
) => Promise<unknown>
