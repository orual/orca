import type {
  JjBookmarkMutationInput,
  JjBookmarkMutationResult,
  JjChangesResult,
  JjCommitInput,
  JjCommitResult,
  JjCurrentChangeMetadataResult,
  JjDescribeInput,
  JjDescribeResult,
  JjDetection,
  JjFileDiffInput,
  JjFileDiffResult,
  JjLocalBookmarksResult,
  JjRemoteFetchInput,
  JjRemoteFetchResult,
  JjRemoteListResult,
  JjRemotePushInput,
  JjRemotePushResult,
  JjWorkspaceAddInput,
  JjWorkspaceAddResult,
  JjWorkspaceListResult,
  JjWorkspaceRemoveInput,
  JjWorkspaceRemoveResult,
  JjWorkspaceStaleRecoveryResult
} from '../../shared/jj-types'
import {
  addRuntimeJjWorkspace,
  commitRuntimeJj,
  createRuntimeJjBookmark,
  describeRuntimeJjCurrentChange,
  fetchRuntimeJjRemote,
  moveRuntimeJjBookmark,
  pushRuntimeJjBookmark,
  removeRuntimeJjWorkspace,
  updateRuntimeJjWorkspaceStale
} from './runtime-jj-mutations'
import {
  detectRuntimeJj,
  getRuntimeJjCurrentChangeMetadata,
  listRuntimeJjChanges,
  listRuntimeJjLocalBookmarks,
  listRuntimeJjRemotes,
  listRuntimeJjWorkspaces
} from './runtime-jj-named-operations'
import { readRuntimeJjFileDiff } from './runtime-jj-read-operations'
import type { RuntimeJjCommandHost, RuntimeJjRequestOptions } from './runtime-jj-operation-context'

export type { RuntimeJjRequestOptions } from './runtime-jj-operation-context'
export { normalizeWorkspaceAddInput } from './runtime-jj-inputs'

export class RuntimeJjCommands {
  readonly detectRuntimeJj: (
    selector: string,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjDetection>
  readonly listRuntimeJjWorkspaces: (
    selector: string,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjWorkspaceListResult>
  readonly addRuntimeJjWorkspace: (
    selector: string,
    input: JjWorkspaceAddInput,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjWorkspaceAddResult>
  readonly removeRuntimeJjWorkspace: (
    selector: string,
    input: JjWorkspaceRemoveInput,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjWorkspaceRemoveResult>
  readonly listRuntimeJjChanges: (
    selector: string,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjChangesResult>
  readonly readRuntimeJjFileDiff: (
    selector: string,
    input: JjFileDiffInput,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjFileDiffResult>
  readonly getRuntimeJjCurrentChangeMetadata: (
    selector: string,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjCurrentChangeMetadataResult>
  readonly listRuntimeJjLocalBookmarks: (
    selector: string,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjLocalBookmarksResult>
  readonly listRuntimeJjRemotes: (
    selector: string,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjRemoteListResult>
  readonly fetchRuntimeJjRemote: (
    selector: string,
    input: JjRemoteFetchInput,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjRemoteFetchResult>
  readonly pushRuntimeJjBookmark: (
    selector: string,
    input: JjRemotePushInput,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjRemotePushResult>
  readonly describeRuntimeJjCurrentChange: (
    selector: string,
    input: JjDescribeInput,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjDescribeResult>
  readonly createRuntimeJjBookmark: (
    selector: string,
    input: JjBookmarkMutationInput,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjBookmarkMutationResult>
  readonly moveRuntimeJjBookmark: (
    selector: string,
    input: JjBookmarkMutationInput,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjBookmarkMutationResult>
  readonly commitRuntimeJj: (
    selector: string,
    input: JjCommitInput,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjCommitResult>
  readonly updateRuntimeJjWorkspaceStale: (
    selector: string,
    options?: RuntimeJjRequestOptions
  ) => Promise<JjWorkspaceStaleRecoveryResult>

  constructor(private readonly host: RuntimeJjCommandHost) {
    this.detectRuntimeJj = (selector, options) => detectRuntimeJj(this.host, selector, options)
    this.listRuntimeJjWorkspaces = (selector, options) =>
      listRuntimeJjWorkspaces(this.host, selector, options)
    this.addRuntimeJjWorkspace = (selector, input, options) =>
      addRuntimeJjWorkspace(this.host, selector, input, options)
    this.removeRuntimeJjWorkspace = (selector, input, options) =>
      removeRuntimeJjWorkspace(this.host, selector, input, options)
    this.listRuntimeJjChanges = (selector, options) =>
      listRuntimeJjChanges(this.host, selector, options)
    this.readRuntimeJjFileDiff = (selector, input, options) =>
      readRuntimeJjFileDiff(this.host, selector, input, options)
    this.getRuntimeJjCurrentChangeMetadata = (selector, options) =>
      getRuntimeJjCurrentChangeMetadata(this.host, selector, options)
    this.listRuntimeJjLocalBookmarks = (selector, options) =>
      listRuntimeJjLocalBookmarks(this.host, selector, options)
    this.listRuntimeJjRemotes = (selector, options) =>
      listRuntimeJjRemotes(this.host, selector, options)
    this.fetchRuntimeJjRemote = (selector, input, options) =>
      fetchRuntimeJjRemote(this.host, selector, input, options)
    this.pushRuntimeJjBookmark = (selector, input, options) =>
      pushRuntimeJjBookmark(this.host, selector, input, options)
    this.describeRuntimeJjCurrentChange = (selector, input, options) =>
      describeRuntimeJjCurrentChange(this.host, selector, input, options)
    this.createRuntimeJjBookmark = (selector, input, options) =>
      createRuntimeJjBookmark(this.host, selector, input, options)
    this.moveRuntimeJjBookmark = (selector, input, options) =>
      moveRuntimeJjBookmark(this.host, selector, input, options)
    this.commitRuntimeJj = (selector, input, options) =>
      commitRuntimeJj(this.host, selector, input, options)
    this.updateRuntimeJjWorkspaceStale = (selector, options) =>
      updateRuntimeJjWorkspaceStale(this.host, selector, options)
  }
}
