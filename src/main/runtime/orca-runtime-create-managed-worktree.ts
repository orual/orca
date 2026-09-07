// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithGetWorktreeTerminalProvisioningHost } from './orca-runtime-get-worktree-terminal-provisioning-host'
import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'
import type { CreateWorktreeResult } from '../../shared/worktree/create-types'
import { isTuiAgentEnabled } from '../../shared/tui-agent-selection'
import { isFolderRepo, isJjRepo } from '../../shared/repo-kind'
import { resolveWorktreeCreateRoute } from '../worktree-create-execution-host-route'
import { ExecutionHostNotDispatchableError } from '../providers/execution-host-provider-dispatch'
import { createRuntimeFolderWorktree } from './runtime-folder-worktree-create'
import { createRuntimeLocalManagedWorktree } from './runtime-local-worktree-create'
import {
  createRuntimeSetupReceipt,
  createRuntimeStartupTerminal,
  prepareRuntimeLocalWorktreeSetup
} from './runtime-local-worktree-setup'
import { invalidateAuthorizedRootsCache } from '../ipc/filesystem-auth'
import { startRuntimeLocalWorktreeTerminals } from './runtime-local-worktree-terminal-startup'
import { createJjManagedWorktree } from '../jj/jj-workspace-creation'
import { getRepoSshConnectionId } from '../../shared/execution-host'
export class OrcaRuntimeWithCreateManagedWorktree extends OrcaRuntimeWithGetWorktreeTerminalProvisioningHost {
  async createManagedWorktree(
    args: RuntimeManagedWorktreeCreateArgs
  ): Promise<CreateWorktreeResult> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const repo = await this.resolveRepoSelector(args.repoSelector)
    const createSettings = this.store.getSettings()
    const requestedAgent = args.startupAgent ?? args.createdWithAgent
    const requestedAgentEnabled =
      requestedAgent !== undefined
        ? isTuiAgentEnabled(requestedAgent, createSettings.disabledTuiAgents)
        : false
    if ((args.startup || args.startupAgent) && requestedAgent && !requestedAgentEnabled) {
      throw new Error('Selected agent is disabled. Choose an enabled agent before creating.')
    }
    if (
      args.startup &&
      args.startupDraftPaste &&
      !isTuiAgentEnabled(args.startupDraftPaste.agent, createSettings.disabledTuiAgents)
    ) {
      throw new Error('Selected agent is disabled. Choose an enabled agent before creating.')
    }
    const agentStartup =
      !args.startup && args.startupAgent
        ? this.buildStartupForAgent(
            repo,
            args.startupAgent,
            args.startupPrompt,
            args.startupLaunchPreferences
          )
        : null
    const draftStartup =
      !args.startup && !agentStartup && args.startupDraft
        ? await this.buildStartupForDraft(repo, args.startupDraft, requestedAgent)
        : null
    const effectiveStartup = args.startup ?? agentStartup?.startup ?? draftStartup?.startup
    const effectiveStartupFollowup = agentStartup?.followup
    const fallbackAgent = requestedAgentEnabled ? requestedAgent : undefined
    const effectiveCreatedWithAgent = args.startup
      ? args.createdWithAgent
      : (agentStartup?.agent ?? draftStartup?.agent ?? fallbackAgent)
    const effectiveDraftPaste = args.startupDraftPaste ?? draftStartup?.draftPaste
    const createRoute = resolveWorktreeCreateRoute(repo)
    const repoIsJj = isJjRepo(repo)
    if (args.workspaceKind === 'jj' && !repoIsJj) {
      throw new Error(`jj workspace creation requires a jj repository: ${repo.id}`)
    }
    if (repoIsJj) {
      if (createRoute.kind === 'runtime') {
        throw new ExecutionHostNotDispatchableError(createRoute.hostId)
      }
      return createJjManagedWorktree(this.requireStore(), repo, args, {
        creationSource: 'runtime',
        remote: Boolean(getRepoSshConnectionId(repo)),
        runtimeTarget: this.getLocalGitExecutionOptionArgs(repo)[0],
        onCreated: (result) => {
          this.invalidateResolvedWorktreeCache()
          this.invalidateWorktreeScanCacheForRepo(repo.id)
          invalidateAuthorizedRootsCache()
          this.notifyWorktreesChanged(repo.id)
          this.emitWorktreeLifecycle({
            kind: 'created',
            worktreeId: result.worktree.id,
            path: result.worktree.path,
            branch: result.worktree.branch
          })
        }
      })
    }
    const sshConnectionId = createRoute.kind === 'ssh' ? createRoute.connectionId : null
    if (isFolderRepo(repo)) {
      // A folder workspace is a registration, not a filesystem create, so it is host-agnostic —
      // except for the agent trust write, which must land on the host that will run the agent.
      return createRuntimeFolderWorktree({
        request: args,
        repo,
        startup: effectiveStartup,
        startupFollowup: effectiveStartupFollowup,
        createdWithAgent: effectiveCreatedWithAgent,
        draftPaste: effectiveDraftPaste,
        deps: {
          store: this.store,
          ptySpawnAvailable: Boolean(this.ptyController?.spawn),
          createTerminal: (selector, options) => this.createTerminal(selector, options),
          markTrusted: (agent, path) =>
            this.markWorkspaceTrustedForAgent(agent, sshConnectionId, path),
          pasteDraft: (handle, draft) => this.pasteStartupDraftWhenReady(handle, draft),
          sendFollowup: (handle, followup) => this.sendStartupFollowupWhenReady(handle, followup),
          invalidateResolvedWorktrees: () => this.invalidateResolvedWorktreeCache(),
          notifyWorktreesChanged: (repoId) => this.notifyWorktreesChanged(repoId),
          emitCreated: (event) => this.emitWorktreeLifecycle(event),
          activate: (repoId, worktreeId, setup, startup) =>
            this.notifyActivateWorktree(
              repoId,
              worktreeId,
              setup,
              startup,
              undefined,
              args.navigation
            )
        }
      })
    }
    const lineageInput =
      args.lineage || args.comment ? { ...args.lineage, comment: args.comment } : undefined
    const lineageResolution = await this.resolveLineageForWorktreeCreate(lineageInput)
    if (createRoute.kind === 'runtime') {
      throw new ExecutionHostNotDispatchableError(createRoute.hostId)
    }
    if (createRoute.kind === 'ssh') {
      // The route carries the resolved connection for the remote-create pipeline.
      const result = await this.createManagedRemoteWorktree(createRoute.repo, {
        ...args,
        activate: args.activate,
        ...(effectiveStartup ? { startup: effectiveStartup } : {}),
        ...(effectiveStartupFollowup ? { startupFollowup: effectiveStartupFollowup } : {}),
        ...(effectiveCreatedWithAgent ? { createdWithAgent: effectiveCreatedWithAgent } : {}),
        ...(effectiveDraftPaste ? { startupDraftPaste: effectiveDraftPaste } : {})
      })
      const recordedLineage = this.recordCreatedWorktreeLineage(result.worktree, lineageResolution)
      this.emitWorktreeLifecycle({
        kind: 'created',
        worktreeId: result.worktree.id,
        path: result.worktree.path,
        branch: result.worktree.branch
      })
      return {
        ...result,
        worktree: {
          ...result.worktree,
          parentWorktreeId: recordedLineage.lineage?.parentWorktreeId ?? null,
          childWorktreeIds: result.worktree.childWorktreeIds ?? [],
          lineage: recordedLineage.lineage,
          workspaceLineage: recordedLineage.workspaceLineage
        },
        ...(lineageInput
          ? {
              lineage: recordedLineage.lineage,
              workspaceLineage: recordedLineage.workspaceLineage,
              warnings: recordedLineage.warnings
            }
          : {})
      }
    }
    const { worktree, worktreePath, includeCopyWarning, created, addResult, metadataResult } =
      await createRuntimeLocalManagedWorktree({
        request: args,
        repo,
        store: this.requireStore(),
        createdWithAgent: effectiveCreatedWithAgent,
        hostedReviewExecutionContext: this.getHostedReviewExecutionOptions(repo),
        resolveRemoteTrackingBase: (path, base, ...options) =>
          this.resolveRemoteTrackingBase(path, base, ...options),
        hasRemoteTrackingRef: (path, base, ...options) =>
          this.hasRemoteTrackingRef(path, base, ...options),
        refreshRemoteTrackingBase: (path, base, ...options) =>
          this.getOrStartRemoteTrackingBaseRefresh(path, base, ...options),
        fetchRemote: (path, remote, ...options) =>
          this.fetchRemoteWithCache(path, remote, ...options),
        onWorktreeMetadataPersisted: (persistedWorktree) =>
          this.recordCreatedWorktreeLineage(persistedWorktree, lineageResolution)
      })
    const settings = createSettings
    const { lineage, workspaceLineage, warnings: lineageWarnings } = metadataResult
    let {
      setup,
      defaultTabs,
      warning,
      effectiveDecision,
      hookFound,
      shouldRunSetup,
      didStartInProcessSetupHook
    } = await prepareRuntimeLocalWorktreeSetup({
      request: args,
      repo,
      worktreePath,
      settings,
      runtimeTarget: this.getLocalGitExecutionOptionArgs(repo)[0],
      shouldUseSetupRunner:
        this.authoritativeWindowId !== null ||
        Boolean(effectiveStartup) ||
        Boolean(this.ptyController?.spawn),
      warning: includeCopyWarning
    })
    this.invalidateResolvedWorktreeCache()
    this.invalidateWorktreeScanCacheForRepo(repo.id)
    // Filesystem auth separately caches registered roots used by Git IPC.
    invalidateAuthorizedRootsCache()
    this.notifyWorktreesChanged(repo.id)
    const {
      warning: terminalWarning,
      returnedSetup,
      didSpawnSetup,
      didSpawnStartup,
      setupTerminalHandle,
      startupTerminalHandle,
      startupTerminalTabId,
      startupTerminalPaneKey,
      startupTerminalPtyId
    } = await startRuntimeLocalWorktreeTerminals({
      request: args,
      repo,
      worktree,
      setup,
      defaultTabs,
      startup: effectiveStartup,
      startupFollowup: effectiveStartupFollowup,
      createdWithAgent: effectiveCreatedWithAgent,
      draftPaste: effectiveDraftPaste,
      warning,
      ports: {
        canSpawn: Boolean(this.ptyController?.spawn),
        markTrusted: (agent, path) => this.markLocalWorkspaceTrustedForAgent(agent, path),
        createTerminal: (selector, options) => this.createTerminal(selector, options),
        pasteDraft: (handle, draft) => this.pasteStartupDraftWhenReady(handle, draft),
        sendFollowup: (handle, followup) => this.sendStartupFollowupWhenReady(handle, followup),
        provision: (options) => this.provisionManagedWorktreeTerminals(options),
        activate: (repoId, worktreeId, activationSetup, startup, activationDefaultTabs) =>
          this.notifyActivateWorktree(
            repoId,
            worktreeId,
            activationSetup,
            startup,
            activationDefaultTabs,
            args.navigation
          )
      }
    })
    warning = terminalWarning
    this.emitWorktreeLifecycle({
      kind: 'created',
      worktreeId: worktree.id,
      path: worktree.path,
      branch: worktree.branch
    })
    const startupTerminal = createRuntimeStartupTerminal({
      didSpawnStartup,
      startupTerminalHandle,
      startupTerminalTabId,
      startupTerminalPaneKey,
      startupTerminalPtyId
    })
    return {
      worktree: {
        ...worktree,
        parentWorktreeId: lineage?.parentWorktreeId ?? null,
        childWorktreeIds: [],
        lineage,
        workspaceLineage,
        git: created
      },
      ...(lineageInput ? { lineage, workspaceLineage, warnings: lineageWarnings } : {}),
      ...(returnedSetup ? { setup: returnedSetup } : {}),
      ...(args.awaitTerminalProvisioning
        ? {
            setupReceipt: createRuntimeSetupReceipt({
              effectiveDecision,
              hookFound,
              setup,
              shouldRunSetup,
              didSpawnSetup,
              didStartInProcessSetupHook,
              setupTerminalHandle
            })
          }
        : {}),
      ...(defaultTabs ? { defaultTabs } : {}),
      ...(warning ? { warning } : {}),
      ...(addResult.localBaseRefRefresh
        ? { localBaseRefRefresh: addResult.localBaseRefRefresh }
        : {}),
      ...(addResult.localBaseRefUpdateSuggestion
        ? { localBaseRefUpdateSuggestion: addResult.localBaseRefUpdateSuggestion }
        : {}),
      ...(startupTerminal ? { startupTerminal } : {})
    }
  }
}
