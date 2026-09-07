import type { ComposerModel } from './composer-model'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { seedNativeChatAppliedSessionOptions } from '@/components/native-chat/native-chat-session-option-cache'
import { ensureAgentStartupInTerminal } from '@/lib/new-workspace'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { queueWorkspaceActivationTerminalFocus } from '@/lib/workspace-activation-terminal-focus'
import { settleFullCreationStructuredLaunch } from './full-creation-structured-launch'
import { finalizeFullCreation } from './full-creation-finalization'
import { buildFullCreationStartup } from './full-creation-startup'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import type { WorktreeStartupPayload } from '@/lib/worktree-startup-payload'
import type { CreateWorktreeResult } from '../../../../shared/worktree/create-types'

export async function completeFullCreation(input: {
  applyWorktreeMeta: ComposerModel['applyWorktreeMeta']
  clearNewWorkspaceDraft: ComposerModel['clearNewWorkspaceDraft']
  issueCommand: WorktreeCreationRequest['issueCommand']
  note: string
  onCreated: ComposerModel['onCreated']
  persistDraft: boolean
  result: CreateWorktreeResult
  setSidebarOpen: ComposerModel['setSidebarOpen']
  startupPlan: AgentStartupPlan | null
  submitStartupPrompt: string
  structuredLaunch: boolean
  tuiAgent: ComposerModel['tuiAgent']
  shouldSeedInitialAgentStatus: boolean
  composerTelemetry: WorktreeStartupPayload['telemetry']
  worktreeId: string
  pendingFirstAgentMessageRename: boolean
}): Promise<void> {
  const {
    applyWorktreeMeta,
    clearNewWorkspaceDraft,
    issueCommand,
    note,
    onCreated,
    persistDraft,
    result,
    setSidebarOpen,
    startupPlan,
    submitStartupPrompt,
    structuredLaunch,
    tuiAgent,
    shouldSeedInitialAgentStatus,
    composerTelemetry,
    worktreeId,
    pendingFirstAgentMessageRename
  } = input
  const trimmedNote = note.trim()
  await applyWorktreeMeta(worktreeId, trimmedNote ? { comment: trimmedNote } : {})

  const backendSpawnedStartup = result.startupTerminal?.spawned === true
  if (startupPlan && !backendSpawnedStartup && !startupPlan.launchToken) {
    startupPlan.launchToken = createBrowserUuid()
  }

  const startup = buildFullCreationStartup({
    startupPlan,
    backendSpawnedStartup,
    agent: tuiAgent,
    shouldSeedInitialAgentStatus,
    prompt: submitStartupPrompt,
    telemetry: composerTelemetry
  })
  const initialActivation = activateAndRevealWorktree(worktreeId, {
    sidebarRevealBehavior: 'auto',
    setup: result.setup,
    defaultTabs: result.defaultTabs,
    issueCommand,
    ...(backendSpawnedStartup ? { backendStartupTerminalSpawned: true } : {}),
    ...(!structuredLaunch && startup ? { startup } : {}),
    ...(structuredLaunch ? { providesInitialSurface: true } : {})
  })
  const { structuredLaunchAccepted, visibilityUnknown, activation } =
    await settleFullCreationStructuredLaunch({
      structuredLaunch,
      agent: tuiAgent,
      worktreeId,
      prompt: startupPlan?.draftPrompt ?? submitStartupPrompt,
      initialActivation,
      onDefinitiveRefusal: async () => {
        if (pendingFirstAgentMessageRename) {
          await applyWorktreeMeta(worktreeId, { pendingFirstAgentMessageRename: true }).catch(
            () => undefined
          )
        }
        return activateAndRevealWorktree(worktreeId, {
          sidebarRevealBehavior: 'auto',
          createNewTerminalForStartup: true,
          ...(startup ? { startup } : {})
        })
      }
    })

  if (visibilityUnknown) {
    setSidebarOpen(true)
    onCreated?.()
    return
  }
  if (!structuredLaunchAccepted && startupPlan) {
    const optionScopeKey =
      (activation !== false ? activation.primaryTabId : null) ?? result.startupTerminal?.tabId
    if (optionScopeKey) {
      seedNativeChatAppliedSessionOptions(optionScopeKey, tuiAgent, startupPlan.sessionOptions)
    }
  }
  if (!structuredLaunchAccepted && startupPlan && !backendSpawnedStartup) {
    void ensureAgentStartupInTerminal({
      worktreeId,
      primaryTabId: activation === false ? null : activation.primaryTabId,
      startup: startupPlan
    })
  }
  finalizeFullCreation({
    setSidebarOpen,
    persistDraft,
    clearNewWorkspaceDraft,
    onCreated,
    structuredLaunchAccepted,
    worktreeId,
    activation,
    queueWorkspaceActivationTerminalFocus
  })
}
