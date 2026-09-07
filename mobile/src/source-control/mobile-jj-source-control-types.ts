import type {
  JjChange,
  JjCommitIntent,
  JjCommitResult,
  JjCurrentChangeMetadata,
  JjDescribeResult,
  JjLocalBookmark,
  JjRemote,
  JjRemoteListResult,
  JjFileDiffResult,
  JjWorkspaceStaleRecoveryResult
} from '../../../src/shared/jj-types'
import type { useForceReconnect, useHostClient } from '../transport/client-context'
import type { ConnectionState } from '../transport/types'
export type MobileJjIdentity = {
  hostId: string
  worktreeId: string
  client: ReturnType<typeof useHostClient>['client']
  clientId: string | null
}

export type MobileJjScreenState =
  | { kind: 'loading' }
  | { kind: 'ready'; changes: JjChange[]; metadata: JjCurrentChangeMetadata }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'stale'; message: string }

export type MobileJjDiffState =
  | { kind: 'idle' }
  | { kind: 'loading'; path: string }
  | { kind: 'ready'; path: string; result: Extract<JjFileDiffResult, { ok: true }> }
  | { kind: 'error'; path: string; message: string }

export type MobileJjSourceControlState = {
  client: ReturnType<typeof useHostClient>['client']
  localBookmarks: JjLocalBookmark[]
  remotes: JjRemote[]
  metadataError: string | null
  localBookmarksError: string | null
  remoteError: string | null
  listLocalBookmarks: () => Promise<import('../../../src/shared/jj-types').JjLocalBookmarksResult>
  listRemotes: () => Promise<JjRemoteListResult>
  describe: (message: string) => Promise<JjDescribeResult | null>
  createBookmark: (
    name: string
  ) => Promise<import('../../../src/shared/jj-types').JjBookmarkMutationResult | null>
  moveBookmark: (
    name: string
  ) => Promise<import('../../../src/shared/jj-types').JjBookmarkMutationResult | null>
  fetchRemote: (
    remote: string
  ) => Promise<import('../../../src/shared/jj-types').JjRemoteFetchResult | null>
  pushBookmark: (
    remote: string,
    bookmark: string
  ) => Promise<import('../../../src/shared/jj-types').JjRemotePushResult | null>
  connState: ConnectionState
  forceReconnect: ReturnType<typeof useForceReconnect>
  screenState: MobileJjScreenState
  diffState: MobileJjDiffState
  busyAction: string | null
  selectedPaths: readonly string[]
  setSelectedPaths: (paths: readonly string[]) => void
  commitMessage: string
  setCommitMessage: (message: string) => void
  refresh: (options?: { reconcile?: boolean }) => Promise<boolean>
  readDiff: (path: string, parentRevision?: string) => Promise<void>
  commit: (intent?: JjCommitIntent) => Promise<JjCommitResult | null>
  updateStale: () => Promise<JjWorkspaceStaleRecoveryResult | null>
  mutationUncertain: boolean
  mutationError: string | null
}

export type MobileJjIdentityRef = { current: MobileJjIdentity }
