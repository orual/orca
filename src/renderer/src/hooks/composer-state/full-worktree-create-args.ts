import { toFolderWorkspaceLinkedTask } from '@/components/sidebar/folder-workspace-composer-helpers'
import type { ComposerStoreActions } from './composer-store-actions'
import type { PreparedFullSubmit } from './composer-submit-model'
import type { PendingSmartGitHubSubmitResolution } from './source-selection-decisions'
import type { TaskSourceContext } from '../../../../shared/task-source-context'

type CreateWorktreeArgs = Parameters<ComposerStoreActions['createWorktree']>

export type FullWorktreeCreateArgsInput = {
  repoId: string
  prepared: PreparedFullSubmit
  smartGitHubResolution: PendingSmartGitHubSubmitResolution
  effectiveBackendStartup: CreateWorktreeArgs[16]
  tuiAgent: CreateWorktreeArgs[10]
  effectivePresetId: string | null
  linkedGitLabIssue: number | null
  linkedGitLabMR: number | null
  normalizedSparseDirectories: string[]
  parentWorktreeId: string | null
  resolvedInitialWorkspaceStatus: CreateWorktreeArgs[13]
  selectedRepoIsGit: boolean
  selectedRepoIsJj: boolean
  sparseEnabled: boolean
  taskSourceContext: TaskSourceContext | null
  telemetrySource: CreateWorktreeArgs[5]
  structuredLaunch: boolean
  jjStartRevision: string
}

export function buildFullWorktreeCreateArgs(
  input: FullWorktreeCreateArgsInput
): CreateWorktreeArgs {
  const { prepared } = input
  return [
    input.repoId,
    prepared.workspaceName,
    input.selectedRepoIsGit ? prepared.submitBaseBranch : undefined,
    prepared.effectiveSetupDecision,
    input.selectedRepoIsGit && input.sparseEnabled
      ? {
          directories: input.normalizedSparseDirectories,
          ...(input.effectivePresetId ? { presetId: input.effectivePresetId } : {})
        }
      : undefined,
    input.telemetrySource,
    prepared.createDisplayName,
    prepared.submitLinkedIssueNumber ?? undefined,
    prepared.submitLinkedPR ?? undefined,
    input.selectedRepoIsGit ? prepared.submitPushTarget : undefined,
    input.tuiAgent,
    prepared.linkedLinearIssue,
    input.selectedRepoIsGit ? prepared.effectiveBranchNameOverride : undefined,
    input.resolvedInitialWorkspaceStatus,
    input.smartGitHubResolution.kind === 'none' ? (input.linkedGitLabMR ?? undefined) : undefined,
    input.smartGitHubResolution.kind === 'none'
      ? (input.linkedGitLabIssue ?? undefined)
      : undefined,
    input.effectiveBackendStartup,
    input.structuredLaunch ? false : prepared.pendingFirstAgentMessageRename,
    undefined,
    prepared.linkedLinearIssueWorkspaceId,
    prepared.linkedLinearIssueOrganizationUrlKey,
    undefined,
    undefined,
    undefined,
    input.selectedRepoIsGit ? prepared.submitCompareBaseRef : undefined,
    {
      linkedWorkItem: toFolderWorkspaceLinkedTask(prepared.submitLinkedWorkItem),
      linkedTaskSourceContext: input.taskSourceContext,
      nameWasGenerated: prepared.nameWasGenerated,
      ...(prepared.createDisplayName
        ? {
            displayNameKind: prepared.nameIsAutoManaged ? ('generated' as const) : ('user' as const)
          }
        : {}),
      ...(!input.effectiveBackendStartup && prepared.startupPlan?.draftPrompt
        ? { startupDraft: prepared.startupPlan.draftPrompt }
        : {}),
      ...(input.parentWorktreeId ? { parentWorktreeId: input.parentWorktreeId } : {}),
      ...(input.selectedRepoIsJj ? { workspaceKind: 'jj' as const } : {}),
      ...(input.selectedRepoIsJj ? { jjStartRevision: input.jjStartRevision.trim() || '@' } : {})
    }
  ]
}
