import type { ComposerModel } from './composer-model'

export type FullCreationExecutionInput = Pick<
  ComposerModel,
  | 'applyWorktreeMeta'
  | 'clearNewWorkspaceDraft'
  | 'createWorktree'
  | 'effectivePresetId'
  | 'isSubmissionCancelled'
  | 'linkedGitLabIssue'
  | 'linkedGitLabMR'
  | 'normalizedSparseDirectories'
  | 'note'
  | 'onCreated'
  | 'parentWorktreeId'
  | 'persistDraft'
  | 'persistSetupAgentStartupPolicy'
  | 'prepareFullSubmit'
  | 'resolvedInitialWorkspaceStatus'
  | 'selectedRepoExecutionHostId'
  | 'selectedRepoIsGit'
  | 'selectedRepoIsJj'
  | 'jjStartRevision'
  | 'selectedRepoIsRemote'
  | 'setSidebarOpen'
  | 'settings'
  | 'sparseEnabled'
  | 'taskSourceContext'
  | 'telemetrySource'
  | 'tuiAgent'
>

import { useCallback } from 'react'
import type { PendingSmartGitHubSubmitResolution } from './source-selection-decisions'
import { translate } from '@/i18n/i18n'
import { settleComposerSubmit } from '@/lib/composer-submit-cancellation'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import {
  hasExplicitTuiLaunchCustomization,
  resolveAgentLaunchRoute
} from '@/lib/agent-launch-routing'
import { readLocalRuntimeCapabilities } from '@/runtime/local-runtime-capabilities'
import { buildFullCreationIssueCommand } from './full-creation-issue-command'
import { createFullWorktree } from './full-worktree-create'
import { completeFullCreation } from './full-creation-completion'

export function useFullCreationExecution(input: FullCreationExecutionInput) {
  const {
    applyWorktreeMeta,
    clearNewWorkspaceDraft,
    createWorktree,
    effectivePresetId,
    isSubmissionCancelled,
    linkedGitLabIssue,
    linkedGitLabMR,
    normalizedSparseDirectories,
    note,
    onCreated,
    parentWorktreeId,
    persistDraft,
    persistSetupAgentStartupPolicy,
    prepareFullSubmit,
    resolvedInitialWorkspaceStatus,
    selectedRepoExecutionHostId,
    selectedRepoIsGit,
    selectedRepoIsJj,
    jjStartRevision,
    selectedRepoIsRemote,
    setSidebarOpen,
    settings,
    sparseEnabled,
    taskSourceContext,
    telemetrySource,
    tuiAgent
  } = input

  const executeFullCreation = useCallback(
    async (
      smartGitHubResolution: PendingSmartGitHubSubmitResolution,
      repoId: string
    ): Promise<void> => {
      const prepared = await prepareFullSubmit(smartGitHubResolution)

      if (!prepared) {
        return
      }

      const {
        submitLinkedWorkItem,
        submitLinkedIssueNumber,
        submitStartupPrompt,
        submitShouldRunIssueAutomation,
        issueCommandTrustDecision,
        confirmedIssueCommandTemplate,
        pendingFirstAgentMessageRename,
        startupPlan,
        shouldSeedInitialAgentStatus,
        composerTelemetry,
        backendStartup
      } = prepared

      const startupPolicySettlement = await settleComposerSubmit(
        persistSetupAgentStartupPolicy(),
        isSubmissionCancelled
      )

      if (startupPolicySettlement.status === 'cancelled') {
        return
      }

      if (!startupPolicySettlement.value) {
        throw new Error(
          translate(
            'auto.hooks.useComposerState.setupAgentStartupPolicySaveFailed',
            'Failed to save setup startup behavior.'
          )
        )
      }

      if (isSubmissionCancelled()) {
        return
      }

      const agentLaunchRoute = resolveAgentLaunchRoute({
        agent: tuiAgent,
        settings,
        executionHostId: selectedRepoExecutionHostId ?? 'local',
        platform: CLIENT_PLATFORM,
        hostCapabilities: readLocalRuntimeCapabilities(),
        workspaceKind: selectedRepoIsGit ? 'git-worktree' : 'folder',
        promptDelivery: startupPlan?.draftPrompt ? 'draft' : 'auto-submit',
        launchText: startupPlan?.draftPrompt ?? submitStartupPrompt,
        nativeChatTranscriptIsLocalReadable: !selectedRepoIsRemote,
        requiresTuiLaunchCustomization: hasExplicitTuiLaunchCustomization(settings, tuiAgent),
        initialSessionOptions: startupPlan?.sessionOptions
      })
      const structuredLaunch = agentLaunchRoute === 'structured-native-chat'
      const effectiveBackendStartup = structuredLaunch ? undefined : backendStartup

      const result = await createFullWorktree(createWorktree, {
        repoId,
        prepared,
        smartGitHubResolution,
        effectiveBackendStartup,
        structuredLaunch,
        tuiAgent,
        effectivePresetId,
        linkedGitLabIssue,
        linkedGitLabMR,
        normalizedSparseDirectories,
        parentWorktreeId,
        resolvedInitialWorkspaceStatus,
        selectedRepoIsGit,
        selectedRepoIsJj,
        sparseEnabled,
        taskSourceContext,
        telemetrySource,
        jjStartRevision
      })

      const issueCommand = buildFullCreationIssueCommand({
        shouldRun: submitShouldRunIssueAutomation && issueCommandTrustDecision === 'run',
        template: confirmedIssueCommandTemplate,
        issueNumber: submitLinkedIssueNumber,
        artifactUrl: submitLinkedWorkItem?.url
      })
      await completeFullCreation({
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
        worktreeId: result.worktree.id,
        pendingFirstAgentMessageRename
      })
    },
    [
      applyWorktreeMeta,
      clearNewWorkspaceDraft,
      createWorktree,
      effectivePresetId,
      isSubmissionCancelled,
      linkedGitLabIssue,
      linkedGitLabMR,
      normalizedSparseDirectories,
      note,
      onCreated,
      parentWorktreeId,
      persistDraft,
      persistSetupAgentStartupPolicy,
      prepareFullSubmit,
      resolvedInitialWorkspaceStatus,
      selectedRepoExecutionHostId,
      selectedRepoIsGit,
      selectedRepoIsJj,
      jjStartRevision,
      selectedRepoIsRemote,
      setSidebarOpen,
      settings,
      sparseEnabled,
      taskSourceContext,
      telemetrySource,
      tuiAgent
    ]
  )

  return { executeFullCreation }
}
