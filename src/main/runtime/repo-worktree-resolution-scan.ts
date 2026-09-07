import type { GitWorktreeInfo } from '../../shared/worktree/types'
import { listWorktreesStrict } from '../git/worktree'
import type { JjWorkspace } from '../../shared/jj-types'
import type { LocalProjectWorktreeGitOptions } from '../project-runtime-git-options'

export type RuntimeWorktreeScanResult = {
  provider?: 'git' | 'jj'
  ok: boolean
  worktrees: GitWorktreeInfo[]
  complete?: boolean
  workspaces?: JjWorkspace[]
}

export async function scanLocalRepoWorktreesForResolution(
  repoPath: string,
  options: LocalProjectWorktreeGitOptions
): Promise<RuntimeWorktreeScanResult> {
  try {
    const worktrees = options.wslDistro
      ? await listWorktreesStrict(repoPath, options)
      : await listWorktreesStrict(repoPath)
    return { ok: true, worktrees }
  } catch {
    return { ok: false, worktrees: [] }
  }
}
