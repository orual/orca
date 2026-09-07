import type { GitDiffResult } from './git-diff-compare-types'

export type JjExecutionTarget =
  | { kind: 'native'; cwd?: string; program?: string }
  | { kind: 'wsl'; cwd: string; distro?: string; program?: string }

export type JjProcessResult = {
  code: number | null
  stdout: string | Buffer
  stderr: string | Buffer
  stdoutBuffer?: Buffer
  stderrBuffer?: Buffer
  timedOut: boolean
  cancelled?: boolean
  outputTruncated?: boolean
}

export type JjCommandRequest = {
  args: readonly string[]
  cwd?: string
  /** Requests raw stdout for file contents when the executor can provide it. */
  binary?: boolean
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
}

export type JjCommandOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

export type JjWorkspaceListOptions = JjCommandOptions

export type JjExecutor = (request: JjCommandRequest) => Promise<JjProcessResult>

export type JjFailureKind = 'unavailable' | 'unsupported' | 'stale' | 'cancelled' | 'error'

export type JjUncertainFailure = {
  ok: false
  kind: 'uncertain'
  message: string
  stderr?: string
  uncertain: true
}

export type JjFailure = {
  ok: false
  kind: JjFailureKind
  message: string
  stderr?: string
}

export type JjDetection =
  | (JjFailure & {
      kind: 'unavailable' | 'unsupported' | 'stale' | 'cancelled' | 'error'
    })
  | {
      ok: true
      version: string
      major: number
      minor: number
      patch: number
      root: string
      colocated: boolean
      /** Canonical host-side repository identity from `jj git root`, when available. */
      repositoryIdentity?: string | null
    }

export type JjWorkspace = {
  name: string
  /** Null means jj could not resolve a recorded root (or the workspace predates roots). */
  root: string | null
}

export type JjWorkspaceListResult =
  | {
      ok: true
      workspaces: JjWorkspace[]
    }
  | JjFailure

export type JjWorkspaceAddInput = { destination: string; name?: string; revision?: string }

export type JjWorkspaceRemoveInput = {
  /** Name reported by `jj workspace list`; never infer this from a path basename. */
  name: string
  /** Target workspace root whose working copy must be snapshotted first. */
  targetRoot: string
  /** Structural owner workspace root that contains `.jj/repo`. */
  ownerRoot: string
}

export type JjWorkspaceRemoveResult = { ok: true } | JjFailure | JjUncertainFailure

export type JjWorkspaceAddResult = { ok: true; destination: string; name?: string } | JjFailure

export type JjChangeStatus = 'modified' | 'added' | 'deleted' | 'copied' | 'renamed' | 'conflicted'

export type JjChangeStats = { added: number; removed: number }

export type JjChange = {
  path: string
  originalPath?: string
  status: JjChangeStatus
  /** Omitted for binary, unavailable, bounded, or parent-ambiguous diffs. */
  stats?: JjChangeStats
}

export type JjBookmark = { name: string; readOnly: true }

export type JjLocalBookmark = {
  name: string
  commitId: string | null
}

export type JjDescribeInput = {
  expectedCommitId: string
  message: string
}

export type JjBookmarkMutationInput = {
  expectedCommitId: string
  name: string
}

export type JjLocalBookmarksResult = { ok: true; bookmarks: JjLocalBookmark[] } | JjFailure

export type JjRemote = {
  name: string
  url: string
}

export type JjRemoteListResult = { ok: true; remotes: JjRemote[] } | JjFailure

export type JjRemoteFetchInput = {
  remote: string
}

export type JjRemotePushInput = {
  remote: string
  bookmark: string
}

export type JjRemoteFetchResult = { ok: true } | JjFailure | JjUncertainFailure

export type JjRemotePushResult = { ok: true } | JjFailure | JjUncertainFailure

export type JjDescribeResult = { ok: true } | JjFailure | JjUncertainFailure

export type JjBookmarkMutationResult = { ok: true } | JjFailure | JjUncertainFailure

export type JjCurrentChangeMetadata = {
  commitId: string
  changeId: string
  description: string
  bookmarks: JjBookmark[]
  conflicted: boolean
  workspaceName: string | null
}

export type JjCurrentChangeMetadataResult =
  | { ok: true; metadata: JjCurrentChangeMetadata }
  | JjFailure

export type JjCommitIntent = { kind: 'all' } | { kind: 'selected'; paths: string[] }

export type JjCommitInput = {
  expectedCommitId: string
  message: string
  intent: JjCommitIntent
}

export type JjCommitResult = { ok: true } | JjFailure | JjUncertainFailure

export type JjWorkspaceStaleRecoveryResult = { ok: true } | JjFailure | JjUncertainFailure

export function isJjWorkspaceStaleFailure(result: Pick<JjFailure, 'kind' | 'message'>): boolean {
  return (
    result.kind === 'stale' &&
    /(?:^|\n)(?:Error: )?The working copy is stale \(not updated since operation [^)]+\)\.\s*Hint: Run `jj workspace update-stale` to update it\./.test(
      result.message.trim()
    )
  )
}

export type JjChangesResult =
  | { ok: true; comparison: 'current-change-vs-parents'; changes: JjChange[] }
  | JjFailure

export type JjFileDiffResult =
  | {
      ok: true
      path: string
      change: JjChange | null
      diff: GitDiffResult
      comparison: 'current-change-vs-parents'
      parentDiffs?: JjParentDiff[]
    }
  | JjFailure

export type JjParentDiff = {
  parentRevision: string
  diff: GitDiffResult
}

export type JjFileDiffInput = {
  path: string
  /** Defaults to @ versus parents(@), including merge/conflict semantics. */
  revision?: string
  parentRevision?: string
}

export type JjBackend = {
  detect: (options?: JjCommandOptions) => Promise<JjDetection>
  listWorkspaces: (options?: JjWorkspaceListOptions) => Promise<JjWorkspaceListResult>
  addWorkspace: (input: JjWorkspaceAddInput) => Promise<JjWorkspaceAddResult>
  removeWorkspace: (input: JjWorkspaceRemoveInput) => Promise<JjWorkspaceRemoveResult>
  listChanges: () => Promise<JjChangesResult>
  readFileDiff: (input: JjFileDiffInput) => Promise<JjFileDiffResult>
  getCurrentChangeMetadata: () => Promise<JjCurrentChangeMetadataResult>
  listLocalBookmarks: () => Promise<JjLocalBookmarksResult>
  listRemotes: () => Promise<JjRemoteListResult>
  fetchRemote: (input: JjRemoteFetchInput) => Promise<JjRemoteFetchResult>
  pushBookmark: (input: JjRemotePushInput) => Promise<JjRemotePushResult>
  describe: (input: JjDescribeInput) => Promise<JjDescribeResult>
  createBookmark: (input: JjBookmarkMutationInput) => Promise<JjBookmarkMutationResult>
  moveBookmark: (input: JjBookmarkMutationInput) => Promise<JjBookmarkMutationResult>
  commit: (input: JjCommitInput) => Promise<JjCommitResult>
  updateWorkspaceStale: () => Promise<JjWorkspaceStaleRecoveryResult>
}
