import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { isMethodNotFoundError } from '../ssh/ssh-filesystem-stream-reader'
import { requestGitStreamable } from '../ssh/ssh-git-response-stream-reader'
import { downloadFolderViaSftp, type SftpFactory } from './ssh-filesystem-download'
import type { SshRawTransferOptions } from './ssh-filesystem-file-upload'
import { createSshFilesystemOperations } from './ssh-filesystem-provider-operations'
import {
  closeSshFilesystemWatch,
  registerSshFilesystemWatch,
  stopSshFilesystemWatchRegistration,
  type WatchRegistration
} from './ssh-filesystem-provider-watch'
import type {
  IFilesystemProvider,
  FileRangeReadResult,
  FileReadLimits,
  FileStat,
  FileReadResult,
  FileUploadSession,
  TerminalArtifactAccessOptions
} from './types'
import type { SearchOptions, SearchResult } from '../../shared/code-search-types'
import type { DirEntry, FsChangeEvent } from '../../shared/filesystem-entry-types'
import { routeSshFilesystemWatchNotification } from './ssh-filesystem-watch-notifications'
import type { WorkspaceSpaceDirectoryScanResult } from '../../shared/workspace-space-types'
import { isWindowsRemoteHost, type RemoteHostPlatform } from '../ssh/ssh-remote-platform'
import {
  probeSshQuickOpenSearchCapability,
  probeSshRangedReadCapability
} from './ssh-filesystem-provider-capabilities'
import { readSshFileRange } from './ssh-filesystem-range-read'
import {
  readSshTerminalArtifact,
  writeSshTerminalArtifact
} from './ssh-filesystem-terminal-artifact'
import { readSshDocPreviewFile } from './ssh-filesystem-doc-preview'
const WORKSPACE_SPACE_SCAN_TIMEOUT_MS = 130_000
export class SshFilesystemProvider implements IFilesystemProvider {
  private connectionId: string
  private mux: SshChannelMultiplexer
  private watchListeners = new Map<string, WatchRegistration>()
  private unsubscribeNotifications: (() => void) | null = null
  private tempDirPromise: Promise<string> | null = null
  private disposed = false
  private loggedStreamFallback = false
  private readonly operations
  readonly downloadFolder?: IFilesystemProvider['downloadFolder']

  constructor(
    connectionId: string,
    mux: SshChannelMultiplexer,
    createSftp?: SftpFactory,
    rawTransfer?: SshRawTransferOptions,
    hostPlatform?: RemoteHostPlatform
  ) {
    this.connectionId = connectionId
    this.mux = mux
    this.operations = createSshFilesystemOperations({
      mux,
      createSftp,
      rawTransfer,
      onStreamFallback: () => {
        if (!this.loggedStreamFallback) {
          this.loggedStreamFallback = true
          console.warn(
            '[ssh-fs] Relay does not implement fs.readFileStream; falling back to fs.readFile (10 MB cap)'
          )
        }
      }
    })

    if (createSftp) {
      // Why: system SSH has raw single-file transfer but no ssh2 SFTP channel;
      // omitting this method makes folder capability truthful at the provider boundary.
      // windowsRemotePaths is provider-owned (from host platform), not a caller option.
      const windowsRemotePaths = hostPlatform ? isWindowsRemoteHost(hostPlatform) : undefined
      this.downloadFolder = (sourcePath, destinationPath, options) =>
        downloadFolderViaSftp(createSftp, sourcePath, destinationPath, {
          ...options,
          windowsRemotePaths
        })
    }

    this.unsubscribeNotifications = mux.onNotification((method, params) =>
      routeSshFilesystemWatchNotification(this.watchListeners, method, params)
    )
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    if (this.unsubscribeNotifications) {
      this.unsubscribeNotifications()
      this.unsubscribeNotifications = null
    }
    for (const registration of this.watchListeners.values()) {
      stopSshFilesystemWatchRegistration(this.mux, registration)
    }
    this.watchListeners.clear()
  }

  getConnectionId(): string {
    return this.connectionId
  }

  readDir(dirPath: string): Promise<DirEntry[]> {
    return this.operations.readDir(dirPath)
  }

  readFile(filePath: string, limits?: FileReadLimits): Promise<FileReadResult> {
    return this.operations.readFile(filePath, limits)
  }

  readDocPreviewFile(
    request: Parameters<NonNullable<IFilesystemProvider['readDocPreviewFile']>>[0]
  ): ReturnType<NonNullable<IFilesystemProvider['readDocPreviewFile']>> {
    return readSshDocPreviewFile(this.mux, request)
  }

  readFileRange(
    filePath: string,
    position: number,
    length: number,
    options?: { signal?: AbortSignal }
  ): Promise<FileRangeReadResult> {
    return readSshFileRange(this.mux, filePath, position, length, options?.signal)
  }

  supportsFileRangeRead(options?: { signal?: AbortSignal }): Promise<boolean> {
    return probeSshRangedReadCapability(this.mux, options?.signal)
  }

  readTerminalArtifact(
    filePath: string,
    options: TerminalArtifactAccessOptions
  ): Promise<FileReadResult> {
    return readSshTerminalArtifact(this.mux, filePath, options)
  }

  writeTerminalArtifact(
    filePath: string,
    content: string,
    options: TerminalArtifactAccessOptions
  ): Promise<FileStat> {
    return writeSshTerminalArtifact(this.mux, filePath, content, options)
  }

  downloadFile(sourcePath: string, destinationPath: string): Promise<void> {
    return this.operations.downloadFile(sourcePath, destinationPath)
  }

  openFileUploadSession(): Promise<FileUploadSession> {
    return this.operations.openFileUploadSession()
  }

  getTempDir(): Promise<string> {
    this.tempDirPromise ??= this.operations.getTempDir().catch((err) => {
      this.tempDirPromise = null
      throw err
    })
    return this.tempDirPromise!
  }

  writePrivateFile(
    workspaceKey: string,
    extension: 'sh' | 'cmd',
    content: string
  ): Promise<string> {
    return this.operations.writePrivateFile(workspaceKey, extension, content)
  }

  writeFile(filePath: string, content: string): Promise<void> {
    return this.operations.writeFile(filePath, content)
  }

  writeFileBase64(filePath: string, contentBase64: string): Promise<void> {
    return this.writeFileBase64Chunk(filePath, contentBase64, false)
  }

  writeFileBase64Chunk(filePath: string, contentBase64: string, append: boolean): Promise<void> {
    return this.operations.writeFileBase64Chunk(filePath, contentBase64, append)
  }

  stat(filePath: string): Promise<FileStat> {
    return this.operations.stat(filePath)
  }

  lstat(filePath: string): Promise<FileStat> {
    return this.operations.lstat(filePath)
  }

  async scanWorkspaceSpace(
    rootPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<WorkspaceSpaceDirectoryScanResult> {
    return (await this.mux.request(
      'fs.workspaceSpaceScan',
      { rootPath },
      { signal: options?.signal, timeoutMs: WORKSPACE_SPACE_SCAN_TIMEOUT_MS }
    )) as WorkspaceSpaceDirectoryScanResult
  }

  async deletePath(targetPath: string, recursive?: boolean): Promise<void> {
    await this.mux.request('fs.deletePath', { targetPath, recursive })
  }

  async createFile(filePath: string): Promise<void> {
    await this.mux.request('fs.createFile', { filePath })
  }

  async createDir(dirPath: string): Promise<void> {
    await this.mux.request('fs.createDir', { dirPath })
  }

  async createDirNoClobber(dirPath: string): Promise<void> {
    await this.mux.request('fs.createDirNoClobber', { dirPath })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.mux.request('fs.rename', { oldPath, newPath })
  }

  async renameNoClobber(oldPath: string, newPath: string): Promise<void> {
    try {
      await this.mux.request('fs.renameNoClobber', { oldPath, newPath })
    } catch (err) {
      if (isMethodNotFoundError(err)) {
        // Why: falling back to raw fs.rename can silently clobber the target on
        // older relays. Fail closed and let reconnect deploy the safe relay.
        throw new Error('Remote safe rename is unavailable. Reconnect the SSH target and retry.')
      }
      throw err
    }
  }

  async copy(source: string, destination: string): Promise<void> {
    await this.mux.request('fs.copy', { source, destination })
  }

  async realpath(filePath: string): Promise<string> {
    return (await this.mux.request('fs.realpath', { filePath })) as string
  }

  async search(opts: SearchOptions): Promise<SearchResult> {
    return (await this.mux.request('fs.search', opts)) as SearchResult
  }

  async listFiles(
    rootPath: string,
    options?: Parameters<IFilesystemProvider['listFiles']>[1]
  ): Promise<string[]> {
    const params: Record<string, unknown> = { rootPath }
    if (options?.excludePaths && options.excludePaths.length > 0) {
      params.excludePaths = options.excludePaths
    }
    if (options?.maxResults !== undefined) {
      params.maxResults = options.maxResults
    }
    if (options?.searchQuery !== undefined) {
      params.searchQuery = options.searchQuery
    }
    // Why #7721: the signal lets a workspace switch send rpc.cancel so the
    // relay aborts the full-tree scan instead of stacking abandoned scans
    // that starve interactive fs.readDir/fs.stat on the shared SSH channel.
    // Why streamable: a monorepo listing serializes past the relay's 1 MiB control lane, and the
    // lane it demotes to is refused under unrelated producer load. Opting in moves it to the bulk
    // lane in chunks; an old relay ignores the flag and answers plainly, which the reader detects
    // by the sentinel marker being absent.
    return (await requestGitStreamable(this.mux, 'fs.listFiles', params, {
      signal: options?.signal
    })) as string[]
  }

  supportsQuickOpenSearch = (options: { signal?: AbortSignal } = {}): Promise<boolean> =>
    probeSshQuickOpenSearchCapability(this.mux, options.signal)
  async watch(
    rootPath: string,
    callback: (events: FsChangeEvent[]) => void,
    options?: { signal?: AbortSignal; onTerminalError?: (error: Error) => void }
  ): Promise<() => void> {
    return registerSshFilesystemWatch({
      mux: this.mux,
      disposed: () => this.disposed,
      registrations: this.watchListeners,
      rootPath,
      callback,
      onTerminalError: options?.onTerminalError,
      signal: options?.signal
    })
  }

  async closeWatch(rootPath: string): Promise<void> {
    await closeSshFilesystemWatch(this.mux, this.watchListeners, rootPath)
  }
}
