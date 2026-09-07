import type {
  JjBookmarkMutationInput,
  JjBookmarkMutationResult,
  JjCommitInput,
  JjCommitResult,
  JjCurrentChangeMetadataResult,
  JjDescribeInput,
  JjDescribeResult,
  JjLocalBookmarksResult,
  JjRemoteFetchInput,
  JjRemoteFetchResult,
  JjRemoteListResult,
  JjRemotePushInput,
  JjRemotePushResult,
  JjDetection,
  JjFileDiffInput,
  JjFileDiffResult,
  JjChangesResult,
  JjWorkspaceAddInput,
  JjWorkspaceAddResult,
  JjWorkspaceListResult,
  JjWorkspaceRemoveInput,
  JjWorkspaceRemoveResult,
  JjWorkspaceStaleRecoveryResult
} from '../../shared/jj-types'
import type {
  SshChannelMultiplexer,
  SshMultiplexerRequestOptions
} from '../ssh/ssh-channel-multiplexer'
import { isJsonRpcMethodNotFoundError } from './ssh-jj-relay-errors'

export type SshJjRequestOptions = Pick<SshMultiplexerRequestOptions, 'signal' | 'timeoutMs'>

export const SSH_JJ_UNSUPPORTED_MESSAGE =
  'SSH jj operations are unavailable on this relay. Reconnect the SSH target to update Orca on the host, then try again.'

export class SshJjProvider {
  constructor(private readonly mux: SshChannelMultiplexer) {}

  detect(repoPath: string, options?: SshJjRequestOptions): Promise<JjDetection> {
    return this.request('jj.detect', { repoPath }, options) as Promise<JjDetection>
  }

  listWorkspaces(repoPath: string, options?: SshJjRequestOptions): Promise<JjWorkspaceListResult> {
    return this.request(
      'jj.listWorkspaces',
      { repoPath },
      options
    ) as Promise<JjWorkspaceListResult>
  }

  addWorkspace(
    repoPath: string,
    input: JjWorkspaceAddInput,
    options?: SshJjRequestOptions
  ): Promise<JjWorkspaceAddResult> {
    return this.request(
      'jj.addWorkspace',
      { repoPath, ...input },
      options
    ) as Promise<JjWorkspaceAddResult>
  }

  removeWorkspace(
    repoPath: string,
    input: JjWorkspaceRemoveInput,
    options?: SshJjRequestOptions
  ): Promise<JjWorkspaceRemoveResult> {
    return this.mutationRequest(
      'jj.removeWorkspace',
      { repoPath, ...input },
      options
    ) as Promise<JjWorkspaceRemoveResult>
  }

  listChanges(repoPath: string, options?: SshJjRequestOptions): Promise<JjChangesResult> {
    return this.request('jj.listChanges', { repoPath }, options) as Promise<JjChangesResult>
  }

  readFileDiff(
    repoPath: string,
    input: JjFileDiffInput,
    options?: SshJjRequestOptions
  ): Promise<JjFileDiffResult> {
    return this.request(
      'jj.readFileDiff',
      { repoPath, ...input },
      options
    ) as Promise<JjFileDiffResult>
  }

  getCurrentChangeMetadata(
    repoPath: string,
    options?: SshJjRequestOptions
  ): Promise<JjCurrentChangeMetadataResult> {
    return this.request(
      'jj.getCurrentChangeMetadata',
      { repoPath },
      options
    ) as Promise<JjCurrentChangeMetadataResult>
  }

  listLocalBookmarks(
    repoPath: string,
    options?: SshJjRequestOptions
  ): Promise<JjLocalBookmarksResult> {
    return this.request(
      'jj.listLocalBookmarks',
      { repoPath },
      options
    ) as Promise<JjLocalBookmarksResult>
  }

  listRemotes(repoPath: string, options?: SshJjRequestOptions): Promise<JjRemoteListResult> {
    return this.request('jj.listRemotes', { repoPath }, options) as Promise<JjRemoteListResult>
  }

  fetchRemote(
    repoPath: string,
    input: JjRemoteFetchInput,
    options?: SshJjRequestOptions
  ): Promise<JjRemoteFetchResult> {
    return this.mutationRequest(
      'jj.fetchRemote',
      { repoPath, ...input },
      options
    ) as Promise<JjRemoteFetchResult>
  }

  pushBookmark(
    repoPath: string,
    input: JjRemotePushInput,
    options?: SshJjRequestOptions
  ): Promise<JjRemotePushResult> {
    return this.mutationRequest(
      'jj.pushBookmark',
      { repoPath, ...input },
      options
    ) as Promise<JjRemotePushResult>
  }

  describe(
    repoPath: string,
    input: JjDescribeInput,
    options?: SshJjRequestOptions
  ): Promise<JjDescribeResult> {
    return this.mutationRequest(
      'jj.describe',
      { repoPath, ...input },
      options
    ) as Promise<JjDescribeResult>
  }

  createBookmark(
    repoPath: string,
    input: JjBookmarkMutationInput,
    options?: SshJjRequestOptions
  ): Promise<JjBookmarkMutationResult> {
    return this.mutationRequest(
      'jj.createBookmark',
      { repoPath, ...input },
      options
    ) as Promise<JjBookmarkMutationResult>
  }

  moveBookmark(
    repoPath: string,
    input: JjBookmarkMutationInput,
    options?: SshJjRequestOptions
  ): Promise<JjBookmarkMutationResult> {
    return this.mutationRequest(
      'jj.moveBookmark',
      { repoPath, ...input },
      options
    ) as Promise<JjBookmarkMutationResult>
  }

  async updateWorkspaceStale(
    repoPath: string,
    options?: SshJjRequestOptions
  ): Promise<JjWorkspaceStaleRecoveryResult> {
    try {
      return (await this.request(
        'jj.updateWorkspaceStale',
        { repoPath },
        options
      )) as JjWorkspaceStaleRecoveryResult
    } catch (error) {
      if (isJsonRpcMethodNotFoundError(error)) {
        throw new Error(SSH_JJ_UNSUPPORTED_MESSAGE)
      }
      return {
        ok: false,
        kind: 'uncertain',
        uncertain: true,
        message: `Remote jj workspace recovery outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  async commit(
    repoPath: string,
    input: JjCommitInput,
    options?: SshJjRequestOptions
  ): Promise<JjCommitResult> {
    try {
      return (await this.request('jj.commit', { repoPath, ...input }, options)) as JjCommitResult
    } catch (error) {
      if (isJsonRpcMethodNotFoundError(error)) {
        throw new Error(SSH_JJ_UNSUPPORTED_MESSAGE)
      }
      return {
        ok: false,
        kind: 'uncertain',
        uncertain: true,
        message: `Remote jj commit outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  private async mutationRequest(
    method: string,
    params: Record<string, unknown>,
    options?: SshJjRequestOptions
  ): Promise<unknown> {
    try {
      return await this.request(method, params, options)
    } catch (error) {
      if (isJsonRpcMethodNotFoundError(error)) {
        throw new Error(SSH_JJ_UNSUPPORTED_MESSAGE)
      }
      return {
        ok: false,
        kind: 'uncertain',
        uncertain: true,
        message: `Remote ${method} outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    options?: SshJjRequestOptions
  ): Promise<unknown> {
    try {
      return await this.mux.request(method, params, options)
    } catch (error) {
      if (isJsonRpcMethodNotFoundError(error)) {
        throw new Error(SSH_JJ_UNSUPPORTED_MESSAGE)
      }
      throw error
    }
  }
}
