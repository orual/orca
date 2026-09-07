import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'
import type { CreateWorktreeArgs } from '../../shared/worktree/create-types'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeSetupLaunch } from '../../shared/worktree/launch-types'
import type { SetupAgentStartupPolicy } from '../../shared/orca-yaml-hook-types'
import { getEffectiveHooks } from '../hooks'
import { shouldRunSetupForCreate } from '../effective-hook-config'
import { createSetupRunnerScript } from '../worktree-runner-script'
import { readRemoteEffectiveHooks, writeRemoteSetupRunnerScript } from '../ipc/worktree-remote'
import { getRepoSshConnectionId } from '../../shared/execution-host'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from '../providers/types'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'

export async function createRemoteJjSetupRunnerScript(
  repo: Repo,
  worktreePath: string,
  script: string,
  fsProvider: IFilesystemProvider,
  projectStartupPolicy?: SetupAgentStartupPolicy
): Promise<WorktreeSetupLaunch> {
  const pathOps = isWindowsAbsolutePathLike(worktreePath) ? win32 : posix
  const runnerExtension = isWindowsAbsolutePathLike(worktreePath) ? 'cmd' : 'sh'
  const runnerScriptPath = pathOps.join(
    worktreePath,
    '.jj',
    'orca',
    `setup-runner.${runnerExtension}`
  )
  const workspaceKey = createHash('sha256')
    .update(`${repo.path}\0${worktreePath}`)
    .digest('hex')
    .slice(0, 32)
  return writeRemoteSetupRunnerScript(
    repo,
    worktreePath,
    script,
    runnerScriptPath,
    fsProvider,
    projectStartupPolicy,
    { workspaceKey }
  )
}

export async function prepareJjWorkspaceSetup(
  repo: Repo,
  worktreePath: string,
  request: { setupDecision?: CreateWorktreeArgs['setupDecision']; runHooks?: boolean },
  options: {
    remote?: boolean
    runtimeTarget?: Parameters<typeof createSetupRunnerScript>[3]
    setupRunnerShell?: Parameters<typeof createSetupRunnerScript>[4]
  } = {}
): Promise<{ setup?: WorktreeSetupLaunch; warning?: string }> {
  try {
    const hooks = options.remote
      ? await (async () => {
          const connectionId = getRepoSshConnectionId(repo)
          const fsProvider = connectionId ? getSshFilesystemProvider(connectionId) : undefined
          return fsProvider ? readRemoteEffectiveHooks(repo, fsProvider, worktreePath) : null
        })()
      : getEffectiveHooks(repo, worktreePath)
    if (!hooks?.scripts.setup) {
      return {}
    }
    const shouldRun = shouldRunSetupForCreate(
      repo,
      request.runHooks ? 'run' : request.setupDecision
    )
    if (!shouldRun) {
      return {}
    }
    let setup: WorktreeSetupLaunch | undefined
    if (options.remote) {
      const connectionId = getRepoSshConnectionId(repo)
      const fsProvider = connectionId ? getSshFilesystemProvider(connectionId) : undefined
      if (!fsProvider) {
        throw new Error('SSH filesystem provider unavailable; reconnect the host and retry setup.')
      }
      setup = await createRemoteJjSetupRunnerScript(
        repo,
        worktreePath,
        hooks.scripts.setup,
        fsProvider,
        repo.hookSettings?.setupAgentStartupPolicy
      )
    } else {
      setup = createSetupRunnerScript(
        repo,
        worktreePath,
        hooks.scripts.setup,
        options.runtimeTarget,
        options.setupRunnerShell,
        repo.hookSettings?.setupAgentStartupPolicy
      )
    }
    return setup ? { setup } : {}
  } catch (error) {
    return {
      warning: `jj workspace created, but setup was not prepared: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
