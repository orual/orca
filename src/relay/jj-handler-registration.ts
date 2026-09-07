import type { RelayDispatcher, RequestContext } from './dispatcher'
import type {
  JjBookmarkMutationInput,
  JjCommitInput,
  JjDescribeInput,
  JjFileDiffInput,
  JjWorkspaceAddInput,
  JjWorkspaceRemoveInput,
  JjRemoteFetchInput,
  JjRemotePushInput
} from '../shared/jj-types'

type JjHandler = {
  detect: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  listWorkspaces: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  addWorkspace: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  removeWorkspace: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  listChanges: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  readFileDiff: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  getCurrentChangeMetadata: (
    params: Record<string, unknown>,
    context: RequestContext
  ) => Promise<unknown>
  listLocalBookmarks: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  listRemotes: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  fetchRemote: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  pushBookmark: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  describe: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  createBookmark: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  moveBookmark: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  commit: (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
  updateWorkspaceStale: (
    params: Record<string, unknown>,
    context: RequestContext
  ) => Promise<unknown>
}

export function registerJjHandlers(dispatcher: RelayDispatcher, handler: JjHandler): void {
  dispatcher.onRequest('jj.detect', (params, context) => handler.detect(params, context))
  dispatcher.onRequest('jj.listWorkspaces', (params, context) =>
    handler.listWorkspaces(params, context)
  )
  dispatcher.onRequest('jj.addWorkspace', (params, context) =>
    handler.addWorkspace(normalizeInputParams(params, isWorkspaceAddInput), context)
  )
  dispatcher.onRequest('jj.removeWorkspace', (params, context) =>
    handler.removeWorkspace(normalizeInputParams(params, isWorkspaceRemoveInput), context)
  )
  dispatcher.onRequest('jj.listChanges', (params, context) => handler.listChanges(params, context))
  dispatcher.onRequest('jj.readFileDiff', (params, context) =>
    handler.readFileDiff(normalizeInputParams(params, isFileDiffInput), context)
  )
  dispatcher.onRequest('jj.getCurrentChangeMetadata', (params, context) =>
    handler.getCurrentChangeMetadata(params, context)
  )
  dispatcher.onRequest('jj.listLocalBookmarks', (params, context) =>
    handler.listLocalBookmarks(params, context)
  )
  dispatcher.onRequest('jj.listRemotes', (params, context) => handler.listRemotes(params, context))
  dispatcher.onRequest('jj.fetchRemote', (params, context) =>
    handler.fetchRemote(normalizeInputParams(params, isRemoteFetchInput), context)
  )
  dispatcher.onRequest('jj.pushBookmark', (params, context) =>
    handler.pushBookmark(normalizeInputParams(params, isRemotePushInput), context)
  )
  dispatcher.onRequest('jj.describe', (params, context) =>
    handler.describe(normalizeInputParams(params, isDescribeInput), context)
  )
  dispatcher.onRequest('jj.createBookmark', (params, context) =>
    handler.createBookmark(normalizeInputParams(params, isBookmarkMutationInput), context)
  )
  dispatcher.onRequest('jj.moveBookmark', (params, context) =>
    handler.moveBookmark(normalizeInputParams(params, isBookmarkMutationInput), context)
  )
  dispatcher.onRequest('jj.commit', (params, context) =>
    handler.commit(normalizeInputParams(params, isCommitInput), context)
  )
  dispatcher.onRequest('jj.updateWorkspaceStale', (params, context) =>
    handler.updateWorkspaceStale(params, context)
  )
}

function normalizeInputParams(
  params: Record<string, unknown>,
  isInput: (value: unknown) => boolean
): Record<string, unknown> {
  const nested = params.input
  if (isInput(nested)) {
    return { ...params, ...(nested as Record<string, unknown>) }
  }
  return params
}

function isWorkspaceAddInput(value: unknown): value is JjWorkspaceAddInput {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && 'destination' in value
  )
}

function isWorkspaceRemoveInput(value: unknown): value is JjWorkspaceRemoveInput {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'name' in value &&
    'targetRoot' in value &&
    'ownerRoot' in value
  )
}

function isFileDiffInput(value: unknown): value is JjFileDiffInput {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'path' in value)
}

function isRemoteFetchInput(value: unknown): value is JjRemoteFetchInput {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'remote' in value)
}

function isRemotePushInput(value: unknown): value is JjRemotePushInput {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'remote' in value &&
    'bookmark' in value
  )
}

function isDescribeInput(value: unknown): value is JjDescribeInput {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'expectedCommitId' in value &&
    'message' in value
  )
}

function isBookmarkMutationInput(value: unknown): value is JjBookmarkMutationInput {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'expectedCommitId' in value &&
    'name' in value
  )
}

function isCommitInput(value: unknown): value is JjCommitInput {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'expectedCommitId' in value &&
    'message' in value &&
    'intent' in value
  )
}
