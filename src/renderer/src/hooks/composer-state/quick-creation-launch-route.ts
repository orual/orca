import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  hasExplicitTuiLaunchCustomization,
  resolveAgentLaunchRoute
} from '@/lib/agent-launch-routing'
import { readLocalRuntimeCapabilities } from '@/runtime/local-runtime-capabilities'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import type { ComposerModel } from './composer-model'

type QuickCreationLaunchRouteInput = Pick<
  ComposerModel,
  'selectedRepoExecutionHostId' | 'selectedRepoIsGit' | 'selectedRepoIsRemote' | 'settings'
> & {
  agent: TuiAgent | null
  ephemeralVmRecipe: WorktreeCreationRequest['ephemeralVmRecipe']
  quickDraftPrompt: string | null | undefined
  quickPrompt: string
  startupPlan: WorktreeCreationRequest['startupPlan']
  workspaceRunContext: WorktreeCreationRequest['workspaceRunContext']
}

export function resolveQuickCreationLaunchRoute(
  input: QuickCreationLaunchRouteInput
): WorktreeCreationRequest['agentLaunchRoute'] {
  if (!input.agent) {
    return 'terminal-tui'
  }
  return resolveAgentLaunchRoute({
    agent: input.agent,
    settings: input.settings,
    executionHostId: input.ephemeralVmRecipe
      ? 'runtime:pending-ephemeral-vm'
      : (input.workspaceRunContext?.hostId ?? input.selectedRepoExecutionHostId ?? 'local'),
    platform: CLIENT_PLATFORM,
    hostCapabilities: readLocalRuntimeCapabilities(),
    workspaceKind: input.selectedRepoIsGit ? 'git-worktree' : 'folder',
    promptDelivery: input.quickDraftPrompt ? 'draft' : 'auto-submit',
    launchText: input.quickDraftPrompt ?? input.quickPrompt,
    nativeChatTranscriptIsLocalReadable: !input.selectedRepoIsRemote,
    requiresTuiLaunchCustomization: hasExplicitTuiLaunchCustomization(input.settings, input.agent),
    initialSessionOptions: input.startupPlan?.sessionOptions
  })
}
