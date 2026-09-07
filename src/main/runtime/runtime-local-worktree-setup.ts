import type { CreateWorktreeResult } from '../../shared/worktree/create-types'
import type { Repo } from '../../shared/repo-types'
import { getEffectiveHooks, loadHooks, runHook } from '../hooks'
import { createSetupRunnerScript, resolveSetupRunnerShell } from '../worktree-runner-script'
import { getDefaultTabsLaunch, shouldRunSetupForCreate } from '../effective-hook-config'
import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'
import type { RuntimeStore } from './runtime-store-contract'

export async function prepareRuntimeLocalWorktreeSetup(args: {
  request: RuntimeManagedWorktreeCreateArgs
  repo: Repo
  worktreePath: string
  settings: ReturnType<RuntimeStore['getSettings']>
  runtimeTarget: { wslDistro?: string } | undefined
  shouldUseSetupRunner: boolean
  warning?: string
}): Promise<{
  setup?: CreateWorktreeResult['setup']
  defaultTabs?: CreateWorktreeResult['defaultTabs']
  warning?: string
  effectiveDecision: 'run' | 'skip' | 'inherit'
  hookFound: boolean
  shouldRunSetup: boolean
  didStartInProcessSetupHook: boolean
}> {
  const { request, repo, worktreePath, settings } = args
  let warning = args.warning
  let setup: CreateWorktreeResult['setup']
  const yamlHooks = loadHooks(worktreePath)
  const hooks = getEffectiveHooks(repo, worktreePath)
  const effectiveDecision = request.runHooks ? 'run' : (request.setupDecision ?? 'inherit')
  let defaultTabs: CreateWorktreeResult['defaultTabs']
  try {
    defaultTabs = getDefaultTabsLaunch(yamlHooks, repo, effectiveDecision)
  } catch (error) {
    console.warn(`[hooks] default tab commands skipped for ${worktreePath}:`, error)
    defaultTabs = yamlHooks?.defaultTabs
      ? { tabs: yamlHooks.defaultTabs, runCommands: false }
      : undefined
  }
  const shouldRunSetup = Boolean(
    hooks?.scripts.setup && shouldRunSetupForCreate(repo, effectiveDecision)
  )
  let didStartInProcessSetupHook = false
  if (shouldRunSetup && hooks?.scripts.setup) {
    if (args.shouldUseSetupRunner) {
      try {
        setup = createSetupRunnerScript(
          repo,
          worktreePath,
          hooks.scripts.setup,
          args.runtimeTarget,
          resolveSetupRunnerShell(settings),
          yamlHooks?.setupAgentStartupPolicy
        )
      } catch (error) {
        console.error(`[hooks] Failed to prepare setup runner for ${worktreePath}:`, error)
      }
    } else {
      didStartInProcessSetupHook = true
      void runHook('setup', worktreePath, repo, worktreePath, args.runtimeTarget).then((result) => {
        if (!result.success) {
          console.error(`[hooks] setup hook failed for ${worktreePath}:`, result.output)
        }
      })
    }
  } else if (hooks?.scripts.setup && effectiveDecision !== 'skip') {
    const skipped = `orca.yaml setup hook skipped for ${worktreePath}; pass --setup run to run it.`
    warning = warning ? `${warning} Also ${skipped}` : skipped
    console.warn(`[hooks] ${skipped}`)
  }
  return {
    ...(setup ? { setup } : {}),
    ...(defaultTabs ? { defaultTabs } : {}),
    ...(warning ? { warning } : {}),
    effectiveDecision,
    hookFound: Boolean(hooks?.scripts.setup),
    shouldRunSetup,
    didStartInProcessSetupHook
  }
}

export function createRuntimeStartupTerminal(args: {
  didSpawnStartup: boolean
  startupTerminalHandle: string | null
  startupTerminalTabId: string | null
  startupTerminalPaneKey: string | null
  startupTerminalPtyId: string | null
}): CreateWorktreeResult['startupTerminal'] | undefined {
  if (!args.didSpawnStartup || !args.startupTerminalHandle) {
    return undefined
  }
  return {
    spawned: true,
    handle: args.startupTerminalHandle,
    ...(args.startupTerminalTabId ? { tabId: args.startupTerminalTabId } : {}),
    ...(args.startupTerminalPaneKey ? { paneKey: args.startupTerminalPaneKey } : {}),
    ...(args.startupTerminalPtyId ? { ptyId: args.startupTerminalPtyId } : {}),
    surface: 'background'
  }
}

export function createRuntimeSetupReceipt(args: {
  effectiveDecision: 'run' | 'skip' | 'inherit'
  hookFound: boolean
  setup?: CreateWorktreeResult['setup']
  shouldRunSetup: boolean
  didSpawnSetup: boolean
  didStartInProcessSetupHook: boolean
  setupTerminalHandle: string | null
}): NonNullable<CreateWorktreeResult['setupReceipt']> {
  const {
    effectiveDecision,
    hookFound,
    setup,
    shouldRunSetup,
    didSpawnSetup,
    didStartInProcessSetupHook,
    setupTerminalHandle
  } = args
  return {
    requested: effectiveDecision,
    hookFound,
    startupPolicy: setup?.waitForAgentStartup ? 'wait-for-setup' : 'start-immediately',
    state: !hookFound
      ? 'not_configured'
      : effectiveDecision === 'skip' || !shouldRunSetup
        ? 'skipped'
        : // Why: the in-process hook is already executing, so reporting
          // spawn_failed would strand callers that retry on it.
          didSpawnSetup || didStartInProcessSetupHook
          ? 'running'
          : 'spawn_failed',
    ...(setupTerminalHandle ? { terminalHandle: setupTerminalHandle } : {})
  }
}
