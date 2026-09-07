import type {
  JjBackend,
  JjBookmarkMutationResult,
  JjCommitInput,
  JjCommitResult,
  JjExecutor,
  JjWorkspace
} from '../../shared/jj-types'
import {
  detectJj,
  getCurrentChangeMetadata,
  listLocalBookmarks,
  listRemotes,
  listWorkspaces
} from './jj-named-operations'
import { commitJj, describeCurrentChange, mutateBookmark } from './jj-change-mutations'
import { readFileDiff } from './jj-read-operations'
import { fetchRemote, pushBookmark } from './jj-remote-mutations'
import { addWorkspace, removeWorkspace, updateWorkspaceStale } from './jj-workspace-mutations'
import { listJjChanges } from './jj-change-listing'
import { JJ_MINIMUM_VERSION } from './jj-output-parsing'
import type {
  JjCommandOptions,
  JjFileDiffInput,
  JjFileDiffResult,
  JjWorkspaceAddInput,
  JjWorkspaceListOptions,
  JjWorkspaceRemoveInput,
  JjWorkspaceStaleRecoveryResult
} from '../../shared/jj-types'

export { JJ_MINIMUM_VERSION }

/** Finds the structural owner workspace only when its caller can verify the backing marker. */
export async function findJjOwnerWorkspaceRoot(
  workspaces: readonly JjWorkspace[],
  isOwnerRoot: (root: string) => Promise<boolean>
): Promise<string | null> {
  for (const workspace of workspaces) {
    if (!workspace.root) {
      continue
    }
    try {
      if (await isOwnerRoot(workspace.root)) {
        return workspace.root
      }
    } catch {
      // An unreadable marker is not evidence that this workspace owns the store.
    }
  }
  return null
}

export function createJjOperations(
  run: JjExecutor
): Pick<
  JjBackend,
  | 'detect'
  | 'listWorkspaces'
  | 'addWorkspace'
  | 'removeWorkspace'
  | 'listChanges'
  | 'readFileDiff'
  | 'getCurrentChangeMetadata'
  | 'commit'
  | 'listLocalBookmarks'
  | 'listRemotes'
  | 'fetchRemote'
  | 'pushBookmark'
  | 'describe'
  | 'createBookmark'
  | 'moveBookmark'
  | 'updateWorkspaceStale'
> {
  let commitInFlight: Promise<JjCommitResult> | null = null
  let bookmarkMutationInFlight: Promise<JjBookmarkMutationResult> | null = null
  let staleRecoveryInFlight: Promise<JjWorkspaceStaleRecoveryResult> | null = null
  const serializeCommit = (input: JjCommitInput): Promise<JjCommitResult> => {
    const next = (commitInFlight ?? Promise.resolve()).then(() => commitJj(run, input))
    commitInFlight = next.finally(() => {
      if (commitInFlight === next) {
        commitInFlight = null
      }
    })
    return next
  }
  const serializeBookmarkMutation = (
    operation: () => Promise<JjBookmarkMutationResult>
  ): Promise<JjBookmarkMutationResult> => {
    const next = (bookmarkMutationInFlight ?? Promise.resolve()).then(operation)
    bookmarkMutationInFlight = next.finally(() => {
      if (bookmarkMutationInFlight === next) {
        bookmarkMutationInFlight = null
      }
    })
    return next
  }
  const serializeStaleRecovery = (): Promise<JjWorkspaceStaleRecoveryResult> => {
    const next = (staleRecoveryInFlight ?? Promise.resolve()).then(() => updateWorkspaceStale(run))
    staleRecoveryInFlight = next.finally(() => {
      if (staleRecoveryInFlight === next) {
        staleRecoveryInFlight = null
      }
    })
    return next
  }
  return {
    detect: (options?: JjCommandOptions) => detectJj(run, options),
    listWorkspaces: (options?: JjWorkspaceListOptions) => listWorkspaces(run, options),
    addWorkspace: (input: JjWorkspaceAddInput) => addWorkspace(run, input),
    removeWorkspace: (input: JjWorkspaceRemoveInput) => removeWorkspace(run, input),
    listChanges: () => listJjChanges(run),
    readFileDiff: (input: JjFileDiffInput): Promise<JjFileDiffResult> => readFileDiff(run, input),
    getCurrentChangeMetadata: () => getCurrentChangeMetadata(run),
    listLocalBookmarks: () => listLocalBookmarks(run),
    listRemotes: () => listRemotes(run),
    fetchRemote: (input) => fetchRemote(run, input),
    pushBookmark: (input) => pushBookmark(run, input),
    describe: (input) => describeCurrentChange(run, input),
    createBookmark: (input) =>
      serializeBookmarkMutation(() => mutateBookmark(run, 'create', input)),
    moveBookmark: (input) => serializeBookmarkMutation(() => mutateBookmark(run, 'move', input)),
    commit: serializeCommit,
    updateWorkspaceStale: serializeStaleRecovery
  }
}
