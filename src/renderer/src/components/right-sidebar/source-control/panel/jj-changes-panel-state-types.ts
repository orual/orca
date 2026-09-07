import type { MutableRefObject } from 'react'
import type {
  JjBookmarkMutationInput,
  JjBookmarkMutationResult,
  JjChange,
  JjCommitInput,
  JjCommitResult,
  JjCurrentChangeMetadata,
  JjDescribeInput,
  JjDescribeResult,
  JjFileDiffResult,
  JjLocalBookmark,
  JjRemoteFetchInput,
  JjRemoteFetchResult,
  JjRemoteListResult,
  JjRemotePushInput,
  JjRemotePushResult,
  JjWorkspaceStaleRecoveryResult
} from '../../../../../../shared/jj-types'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'

export type JjChangesPanelState =
  | { status: 'loading'; changes: JjChange[]; error: null }
  | { status: 'ready'; changes: JjChange[]; error: null }
  | { status: 'error'; changes: JjChange[]; error: string; kind: string }

export type RefreshOptions = { force?: boolean }

export type InFlightRefresh = {
  contextKey: string
  generation: number
  controller: AbortController
  promise: Promise<void>
}

export type JjMetadataState = {
  status: 'loading' | 'ready' | 'error'
  metadata: JjCurrentChangeMetadata | null
  contextKey: string | null
  error: string | null
  kind?: string
}

export type InFlightCommit = {
  contextKey: string
  generation: number
  promise: Promise<JjCommitResult>
}

export type InFlightJjMutation = {
  contextKey: string
  generation: number
  promise: Promise<JjDescribeResult | JjBookmarkMutationResult>
}

export type InFlightRemoteMutation = {
  contextKey: string
  generation: number
  promise: Promise<JjRemoteFetchResult | JjRemotePushResult>
}

export type JjChangesPanelContext = RuntimeGitContext & { worktreeId: string }
export type JjChangesPanelGeneration = MutableRefObject<number>
export type JjChangesPanelRefresh = (options?: RefreshOptions) => Promise<void>

export type JjChangesPanelModel = {
  state: JjChangesPanelState
  metadata: JjCurrentChangeMetadata | null
  metadataContextKey: string | null
  metadataStatus: JjMetadataState['status']
  metadataError: string | null
  localBookmarks: JjLocalBookmark[]
  bookmarksStatus: 'loading' | 'ready' | 'error'
  bookmarksError: string | null
  commitError: Exclude<JjCommitResult, { ok: true }> | null
  isCommitting: boolean
  mutationError: Exclude<JjDescribeResult | JjBookmarkMutationResult, { ok: true }> | null
  isMutating: boolean
  isRemoteMutating: boolean
  remoteError: Exclude<JjRemoteFetchResult | JjRemotePushResult, { ok: true }> | null
  staleRecoveryError: Exclude<JjWorkspaceStaleRecoveryResult, { ok: true }> | null
  isRecoveringStaleWorkspace: boolean
  canRecoverStaleWorkspace: boolean
  recoverStaleWorkspace: () => Promise<JjWorkspaceStaleRecoveryResult>
  context: JjChangesPanelContext | null
  contextKey: string
  refresh: JjChangesPanelRefresh
  readDiff: (
    path: string,
    parentRevision?: string,
    options?: { signal?: AbortSignal }
  ) => Promise<JjFileDiffResult>
  commit: (input: JjCommitInput) => Promise<JjCommitResult>
  describe: (input: JjDescribeInput) => Promise<JjDescribeResult>
  createBookmark: (input: JjBookmarkMutationInput) => Promise<JjBookmarkMutationResult>
  moveBookmark: (input: JjBookmarkMutationInput) => Promise<JjBookmarkMutationResult>
  listRemotes: (options?: { signal?: AbortSignal }) => Promise<JjRemoteListResult>
  fetchRemote: (input: JjRemoteFetchInput) => Promise<JjRemoteFetchResult>
  pushBookmark: (input: JjRemotePushInput) => Promise<JjRemotePushResult>
}
