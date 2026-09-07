import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { isMethodNotFoundError, readFileViaStream } from '../ssh/ssh-filesystem-stream-reader'
import { uploadBuffer } from '../ssh/sftp-upload'
import { lstatViaSftp } from './ssh-filesystem-provider-sftp'
import { downloadFileViaSftp, type SftpFactory } from './ssh-filesystem-download'
import { openSshFileUploadSession, type SshRawTransferOptions } from './ssh-filesystem-file-upload'
import type {
  FileReadLimits,
  FileReadResult,
  FileStat,
  FileUploadSession,
  IFilesystemProvider
} from './types'
import type { DirEntry } from '../../shared/filesystem-entry-types'

export type SshFilesystemOperationDeps = {
  mux: SshChannelMultiplexer
  createSftp?: SftpFactory
  rawTransfer?: SshRawTransferOptions
  onStreamFallback: () => void
}

export function createSshFilesystemOperations(deps: SshFilesystemOperationDeps) {
  const { mux } = deps
  return {
    readDir: async (dirPath: string): Promise<DirEntry[]> =>
      (await mux.request('fs.readDir', { dirPath })) as DirEntry[],
    readFile: async (filePath: string, limits?: FileReadLimits): Promise<FileReadResult> => {
      try {
        return await readFileViaStream(mux, filePath, limits)
      } catch (err) {
        if (!isMethodNotFoundError(err)) {
          throw err
        }
        deps.onStreamFallback()
        return (await mux.request('fs.readFile', { filePath })) as FileReadResult
      }
    },
    downloadFile: async (sourcePath: string, destinationPath: string): Promise<void> => {
      if (deps.rawTransfer?.downloadFile) {
        await deps.rawTransfer.downloadFile(sourcePath, destinationPath)
        return
      }
      await downloadFileViaSftp(deps.createSftp, sourcePath, destinationPath)
    },
    openFileUploadSession: (): Promise<FileUploadSession> =>
      openSshFileUploadSession(deps.createSftp, deps.rawTransfer),
    getTempDir: async (): Promise<string> => {
      try {
        return (await mux.request('fs.tempDir', {})) as string
      } catch (err) {
        if (isMethodNotFoundError(err)) {
          return '/tmp'
        }
        throw err
      }
    },
    writePrivateFile: async (workspaceKey: string, extension: 'sh' | 'cmd', content: string) => {
      try {
        return (await mux.request('fs.writePrivateFile', {
          workspaceKey,
          extension,
          content
        })) as string
      } catch (error) {
        if (isMethodNotFoundError(error)) {
          throw new Error(
            'Private SSH jj setup runner storage is unavailable on this relay. Reconnect the SSH target and retry setup.'
          )
        }
        throw error
      }
    },
    writeFile: async (filePath: string, content: string): Promise<void> => {
      await mux.request('fs.writeFile', { filePath, content })
    },
    writeFileBase64Chunk: async (filePath: string, contentBase64: string, append: boolean) => {
      const contents = Buffer.from(contentBase64, 'base64')
      if (deps.rawTransfer?.writeBuffer) {
        await deps.rawTransfer.writeBuffer(filePath, contents, { append, exclusive: !append })
        return
      }
      if (!deps.createSftp) {
        throw new Error('remote_binary_upload_unavailable')
      }
      const sftp = await deps.createSftp()
      try {
        await uploadBuffer(sftp, contents, filePath, { append, exclusive: !append })
      } finally {
        sftp.end()
      }
    },
    stat: async (filePath: string): Promise<FileStat> =>
      (await mux.request('fs.stat', { filePath })) as FileStat,
    lstat: async (filePath: string): Promise<FileStat> => {
      try {
        return (await mux.request('fs.lstat', { filePath })) as FileStat
      } catch (err) {
        if (!isMethodNotFoundError(err)) {
          throw err
        }
        if (!deps.createSftp) {
          throw new Error('remote_lstat_unavailable')
        }
        const sftp = await deps.createSftp()
        try {
          return await lstatViaSftp(sftp, filePath)
        } finally {
          sftp.end()
        }
      }
    }
  } satisfies Pick<
    IFilesystemProvider,
    | 'readDir'
    | 'readFile'
    | 'downloadFile'
    | 'openFileUploadSession'
    | 'getTempDir'
    | 'writePrivateFile'
    | 'writeFile'
    | 'writeFileBase64Chunk'
    | 'stat'
    | 'lstat'
  >
}
