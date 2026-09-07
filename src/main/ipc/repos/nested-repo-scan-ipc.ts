import type { IpcMainInvokeEvent } from 'electron'
import { isAbsolute, posix } from 'node:path'
import type { z } from 'zod'
import type { NestedRepoScanResult } from '../../../shared/project-group-types'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { scanNestedRepos } from '../../project-groups/nested-repo-discovery'
import { getSshGitProvider } from '../../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import { getActiveMultiplexer } from '../ssh'
import { probeRemoteJjMarker } from './remote-repo-registration'
import type { ProjectGroupScanNestedArgs } from './repo-ipc-arg-schemas'

function isMissingRemoteStatError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 2
}

export const activeNestedRepoScans = new Map<string, AbortController>()
type CompletedNestedRepoScan = {
  scan: NestedRepoScanResult
  parentPath: string
  connectionId: string | null
}
const completedNestedRepoScans = new Map<string, CompletedNestedRepoScan>()
const MAX_COMPLETED_NESTED_SCAN_RESULTS = 50

function validateNestedRepoScanRoot(path: string, connectionId?: string): void {
  if (connectionId) {
    return
  }
  if (!isAbsolute(path)) {
    throw new Error('Repo path must be an absolute path')
  }
}

function rememberCompletedNestedRepoScan(
  scanId: string | undefined,
  context: { parentPath: string; connectionId?: string },
  scan: NestedRepoScanResult
): void {
  if (!scanId) {
    return
  }
  completedNestedRepoScans.set(scanId, {
    scan,
    parentPath: scan.selectedPath,
    connectionId: context.connectionId ?? null
  })
  while (completedNestedRepoScans.size > MAX_COMPLETED_NESTED_SCAN_RESULTS) {
    const oldestScanId = completedNestedRepoScans.keys().next().value
    if (!oldestScanId) {
      break
    }
    completedNestedRepoScans.delete(oldestScanId)
  }
}

export function getCompletedNestedRepoScan(args: {
  scanId?: string
  parentPath: string
  connectionId?: string
}): NestedRepoScanResult | undefined {
  if (!args.scanId) {
    return undefined
  }
  const completed = completedNestedRepoScans.get(args.scanId)
  if (!completed) {
    return undefined
  }
  if (
    completed.connectionId !== (args.connectionId ?? null) ||
    normalizeRuntimePathForComparison(completed.parentPath) !==
      normalizeRuntimePathForComparison(args.parentPath)
  ) {
    return undefined
  }
  return completed.scan
}

async function resolveSshProjectGroupPath(connectionId: string, path: string): Promise<string> {
  if (path === '~' || path === '~/' || path.startsWith('~/')) {
    const mux = getActiveMultiplexer(connectionId)
    if (mux) {
      try {
        const result = (await mux.request('session.resolveHome', { path })) as {
          resolvedPath: string
        }
        return result.resolvedPath
      } catch {
        return path
      }
    }
  }
  return path
}

export async function scanNestedReposForIpc(args: {
  path: string
  connectionId?: string
  options?: unknown
  signal?: AbortSignal
  onProgress?: (scan: NestedRepoScanResult) => void
}): Promise<NestedRepoScanResult> {
  validateNestedRepoScanRoot(args.path, args.connectionId)
  if (!args.connectionId) {
    return scanNestedRepos({
      path: args.path,
      options: args.options,
      signal: args.signal,
      onProgress: args.onProgress
    })
  }
  const gitProvider = getSshGitProvider(args.connectionId)
  const fsProvider = getSshFilesystemProvider(args.connectionId)
  if (!fsProvider) {
    throw new Error('ssh_connection_unavailable')
  }
  const resolvedPath = await resolveSshProjectGroupPath(args.connectionId, args.path)
  return scanNestedRepos({
    path: resolvedPath,
    options: args.options,
    signal: args.signal,
    onProgress: args.onProgress,
    filesystem: {
      readDirectory: async (dirPath) =>
        (await fsProvider.readDir(dirPath)).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
          isSymlink: entry.isSymlink
        })),
      readTextFile: async (filePath) => (await fsProvider.readFile(filePath)).content,
      joinPath: (parentPath, childName) => posix.join(parentPath, childName),
      basename: (path) => posix.basename(path),
      hasJjMarker: async (path) => {
        try {
          const marker = await fsProvider.stat(posix.join(path, '.jj'))
          return marker.type === 'directory' || marker.type === 'file'
        } catch (error) {
          if (isMissingRemoteStatError(error)) {
            return false
          }
          throw error
        }
      },
      hasGitMarker: async (path) => {
        try {
          const marker = await fsProvider.stat(posix.join(path, '.git'))
          if (marker.type === 'directory' || marker.type === 'file') {
            return true
          }
        } catch (error) {
          if (!isMissingRemoteStatError(error)) {
            throw error
          }
          // Continue to cheap bare-repository marker checks below.
        }
        const statIfMissing = async (markerPath: string) => {
          try {
            return await fsProvider.stat(markerPath)
          } catch (error) {
            if (isMissingRemoteStatError(error)) {
              return null
            }
            throw error
          }
        }
        const [head, objects, refs] = await Promise.all([
          statIfMissing(posix.join(path, 'HEAD')),
          statIfMissing(posix.join(path, 'objects')),
          statIfMissing(posix.join(path, 'refs'))
        ])
        return head?.type === 'file' && objects?.type === 'directory' && refs?.type === 'directory'
      },
      isSelectedPathGitRepo: async (path) => {
        if (!gitProvider) {
          return false
        }
        return (await gitProvider.isGitRepoAsync(path)).isRepo
      },
      isSelectedPathJjRepo: async (path) => {
        const result = await probeRemoteJjMarker(path, fsProvider, gitProvider?.getHostPlatform?.())
        if (result.kind === 'unavailable') {
          throw new Error(result.error)
        }
        return result.kind === 'present'
      }
    }
  })
}

export async function runNestedRepoScanForIpc(
  event: IpcMainInvokeEvent,
  args: z.infer<typeof ProjectGroupScanNestedArgs>
): Promise<NestedRepoScanResult> {
  const controller = args.scanId ? new AbortController() : undefined
  if (args.scanId && controller) {
    activeNestedRepoScans.get(args.scanId)?.abort()
    activeNestedRepoScans.set(args.scanId, controller)
  }

  try {
    const scan = await scanNestedReposForIpc({
      ...args,
      signal: controller?.signal,
      onProgress: args.scanId
        ? (scan) => {
            event.sender.send('projectGroups:scanNestedProgress', {
              scanId: args.scanId,
              scan
            })
          }
        : undefined
    })
    rememberCompletedNestedRepoScan(
      args.scanId,
      { parentPath: args.path, connectionId: args.connectionId },
      scan
    )
    return scan
  } finally {
    if (args.scanId && activeNestedRepoScans.get(args.scanId) === controller) {
      activeNestedRepoScans.delete(args.scanId)
    }
  }
}
