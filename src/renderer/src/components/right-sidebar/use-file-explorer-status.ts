import { useMemo } from 'react'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import type { Repo } from '../../../../shared/repo-types'
import { isJjRepo } from '../../../../shared/repo-kind'
import { buildFolderStatusMap, buildStatusMap } from './status-display'
import { useJjExplorerStatus } from './use-jj-explorer-status'

export function useFileExplorerStatus(
  activeRepo: Repo | null,
  activeWorktreeId: string | null,
  worktreePath: string | null,
  gitStatusByWorktree: Record<string, GitStatusEntry[]>
): {
  entries: GitStatusEntry[]
  statusByRelativePath: ReturnType<typeof buildStatusMap>
  folderStatusByRelativePath: ReturnType<typeof buildFolderStatusMap>
  refreshJjStatus: (force?: boolean) => Promise<void>
} {
  const jjStatus = useJjExplorerStatus(activeRepo, activeWorktreeId, worktreePath)
  const entries = useMemo(
    () =>
      isJjRepo(activeRepo ?? { kind: 'git' })
        ? jjStatus.entries
        : activeWorktreeId
          ? (gitStatusByWorktree[activeWorktreeId] ?? [])
          : [],
    [activeRepo, activeWorktreeId, gitStatusByWorktree, jjStatus.entries]
  )
  return {
    entries,
    statusByRelativePath: useMemo(() => buildStatusMap(entries), [entries]),
    folderStatusByRelativePath: useMemo(() => buildFolderStatusMap(entries), [entries]),
    refreshJjStatus: jjStatus.refresh
  }
}
