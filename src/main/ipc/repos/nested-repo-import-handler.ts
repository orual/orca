import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import type { ProjectGroupImportResult } from '../../../shared/project-group-types'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../shared/constants'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { awaitWindowsHostGitEnvironmentReady } from '../../git/runner'
import { isGitRepo, getRepoName } from '../../git/repo'
import {
  createNestedProjectGroupResolver,
  resolveNestedRepoSelection
} from '../../project-groups/nested-repo-import'
import { createNestedRepoImportTargetResolver } from '../../project-groups/nested-repo-import-target'
import { getSshGitProvider } from '../../providers/ssh-git-dispatch'
import { getSshJjProvider } from '../../providers/ssh-jj-dispatch'
import { getSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import { findRemoteJjOwnerWorkspaceRoot, probeRemoteJjMarker } from './remote-repo-registration'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  toSshExecutionHostId
} from '../../../shared/execution-host'
import { detectRepoIconAndUpstream } from '../../repo-icon-autodetect'
import {
  findImportedJjRepo,
  getJjImportIdentityKey,
  probeLocalJjRepo
} from './local-repo-registration'
import { prepareLocalWorktreeRootForRepo } from '../../worktree-root-preparation'
import { getActiveMultiplexer } from '../ssh'
import { invalidateAuthorizedRootsCache } from '../registered-worktree-roots-cache'
import { emitRepoAdded } from './repo-added-telemetry'
import { notifyReposChanged } from './repos-changed-notification'
import { ProjectGroupImportNestedArgs, parseProjectGroupIpcArgs } from './repo-ipc-arg-schemas'
import { getCompletedNestedRepoScan, scanNestedReposForIpc } from './nested-repo-scan-ipc'

function sanitizeNestedRepoImportError(context: string, error: unknown): string {
  console.warn(`[project-groups] ${context}`, error)
  return 'Repository could not be imported'
}

export function registerNestedRepoImportHandler(mainWindow: BrowserWindow, store: Store): void {
  ipcMain.handle(
    'projectGroups:importNested',
    async (_event, rawArgs: unknown): Promise<ProjectGroupImportResult> => {
      const args = parseProjectGroupIpcArgs(
        ProjectGroupImportNestedArgs,
        rawArgs,
        'invalid_project_group_import_nested_args'
      )
      const requestedPaths = args.projectPaths
      const completedScan = getCompletedNestedRepoScan(args)
      const scan =
        completedScan ??
        (await scanNestedReposForIpc({
          path: args.parentPath,
          connectionId: args.connectionId,
          options: { timeoutMs: 15_000 }
        }))
      const selection = resolveNestedRepoSelection({ scan, projectPaths: requestedPaths })
      const groupResolver = createNestedProjectGroupResolver({
        parentPath: scan.selectedPath,
        groupName: args.groupName ?? '',
        mode: args.mode,
        connectionId: args.connectionId ?? null,
        repoPaths: selection.selectedPaths,
        createGroup: (input) => store.createProjectGroup(input)
      })
      const results: ProjectGroupImportResult['projects'] = selection.rejectedPaths.map(
        (repoPath) => ({
          path: repoPath,
          status: 'failed',
          error: 'Repository was not found in the nested repo scan result'
        })
      )
      const importedProjectIdsByRepoPath = new Map<string, string>()
      const importedProjectIdsByJjIdentity = new Map<string, string>()
      const importTargetResolver = createNestedRepoImportTargetResolver()

      for (const [projectGroupOrder, repoPath] of selection.selectedPaths.entries()) {
        try {
          let importRepoPath = repoPath
          let repoKind: 'git' | 'jj' = 'git'
          let jjIdentity: string | null | undefined = null
          if (args.connectionId) {
            const gitProvider = getSshGitProvider(args.connectionId)
            const jjProvider = getSshJjProvider(args.connectionId)
            const fsProvider = getSshFilesystemProvider(args.connectionId)
            const candidate = scan.repos.find(
              (entry) =>
                normalizeRuntimePathForComparison(entry.path) ===
                normalizeRuntimePathForComparison(repoPath)
            )
            const marker = fsProvider
              ? await probeRemoteJjMarker(repoPath, fsProvider, gitProvider?.getHostPlatform?.())
              : { kind: 'unavailable' as const, error: 'SSH filesystem is unavailable' }
            if (marker.kind === 'unavailable') {
              results.push({ path: repoPath, status: 'failed', error: marker.error })
              continue
            }
            if (candidate?.kind === 'jj' || marker.kind === 'present') {
              const detection = jjProvider ? await jjProvider.detect(repoPath) : null
              if (!detection?.ok) {
                results.push({
                  path: repoPath,
                  status: 'failed',
                  error: 'Jujutsu repository unavailable'
                })
                continue
              }
              repoKind = 'jj'
              jjIdentity = detection.repositoryIdentity
              const workspaces = jjProvider?.listWorkspaces
                ? await jjProvider.listWorkspaces(repoPath)
                : null
              const ownerRoot =
                workspaces?.ok && fsProvider
                  ? await findRemoteJjOwnerWorkspaceRoot(
                      workspaces.workspaces,
                      fsProvider,
                      gitProvider?.getHostPlatform?.()
                    )
                  : null
              importRepoPath = ownerRoot ?? detection.root
            } else {
              const check = gitProvider ? await gitProvider.isGitRepoAsync(repoPath) : null
              if (!gitProvider || !check?.isRepo) {
                results.push({
                  path: repoPath,
                  status: 'failed',
                  error: 'Not a valid git repository'
                })
                continue
              }
              importRepoPath = await importTargetResolver.resolveSsh(repoPath, gitProvider)
            }
          } else {
            const candidate = scan.repos.find(
              (entry) =>
                normalizeRuntimePathForComparison(entry.path) ===
                normalizeRuntimePathForComparison(repoPath)
            )
            const jjProbe = await probeLocalJjRepo(repoPath, candidate?.kind === 'jj')
            if (jjProbe.kind === 'unavailable') {
              results.push({ path: repoPath, status: 'failed', error: jjProbe.error })
              continue
            }
            if (jjProbe.kind === 'jj') {
              repoKind = 'jj'
              jjIdentity = jjProbe.detection.repositoryIdentity
              importRepoPath = jjProbe.ownerRoot ?? jjProbe.root
            } else {
              await awaitWindowsHostGitEnvironmentReady({ cwd: repoPath })
              if (!isGitRepo(repoPath)) {
                results.push({
                  path: repoPath,
                  status: 'failed',
                  error: 'Not a valid git repository'
                })
                continue
              }
              importRepoPath = await importTargetResolver.resolveLocal(repoPath)
            }
          }
          const normalizedImportRepoPath = normalizeRuntimePathForComparison(importRepoPath)
          const executionHostId = args.connectionId
            ? toSshExecutionHostId(args.connectionId)
            : LOCAL_EXECUTION_HOST_ID
          const jjIdentityKey = getJjImportIdentityKey(jjIdentity, executionHostId)
          const alreadyImportedProjectId =
            importedProjectIdsByRepoPath.get(normalizedImportRepoPath) ??
            (jjIdentityKey ? importedProjectIdsByJjIdentity.get(jjIdentityKey) : undefined)
          if (alreadyImportedProjectId) {
            results.push({
              path: repoPath,
              projectId: alreadyImportedProjectId,
              status: 'already-known'
            })
            continue
          }
          const existingByPath = store
            .getRepos()
            .find(
              (repo) =>
                getRepoExecutionHostId(repo) === executionHostId &&
                normalizeRuntimePathForComparison(repo.path) === normalizedImportRepoPath
            )
          const existing =
            existingByPath ??
            (repoKind === 'jj'
              ? await findImportedJjRepo({
                  repos: store.getRepos(),
                  identity: jjIdentity,
                  executionHostId,
                  detectIdentity: async (repo) => {
                    if (args.connectionId) {
                      const detection = await getSshJjProvider(args.connectionId)?.detect(repo.path)
                      return detection?.ok ? detection.repositoryIdentity : null
                    }
                    const probe = await probeLocalJjRepo(repo.path, true)
                    return probe.kind === 'jj' ? probe.detection.repositoryIdentity : null
                  }
                })
              : undefined)
          const group = groupResolver.getGroupForRepo(repoPath)
          if (existing) {
            if (group) {
              store.moveProjectToGroup(existing.id, group.id, projectGroupOrder)
            }
            importedProjectIdsByRepoPath.set(normalizedImportRepoPath, existing.id)
            if (jjIdentityKey) {
              importedProjectIdsByJjIdentity.set(jjIdentityKey, existing.id)
            }
            results.push({ path: repoPath, projectId: existing.id, status: 'already-known' })
            continue
          }
          const detected =
            repoKind === 'jj'
              ? {}
              : await detectRepoIconAndUpstream({
                  repoPath: importRepoPath,
                  kind: repoKind,
                  executionHostId: args.connectionId
                    ? toSshExecutionHostId(args.connectionId)
                    : LOCAL_EXECUTION_HOST_ID
                })
          const repo: Repo = {
            id: randomUUID(),
            path: importRepoPath,
            displayName: getRepoName(importRepoPath),
            badgeColor: DEFAULT_REPO_BADGE_COLOR,
            ...detected,
            addedAt: Date.now(),
            kind: repoKind,
            ...(args.connectionId ? { connectionId: args.connectionId } : {}),
            ...(repoKind === 'git'
              ? {
                  externalWorktreeVisibilityLegacy: false,
                  projectHostSetupMethod: 'imported-existing-folder' as const
                }
              : {}),
            ...(group
              ? {
                  projectGroupId: group.id,
                  projectGroupOrder
                }
              : {})
          }
          store.addRepo(repo)
          if (repoKind === 'git') {
            await prepareLocalWorktreeRootForRepo(store, repo)
          }
          if (args.connectionId) {
            getActiveMultiplexer(args.connectionId)?.notify('session.registerRoot', {
              rootPath: importRepoPath
            })
          }
          importedProjectIdsByRepoPath.set(normalizedImportRepoPath, repo.id)
          if (jjIdentityKey) {
            importedProjectIdsByJjIdentity.set(jjIdentityKey, repo.id)
          }
          results.push({ path: repoPath, projectId: repo.id, status: 'imported' })
          emitRepoAdded('folder_picker', false, repoKind === 'git')
        } catch (error) {
          results.push({
            path: repoPath,
            status: 'failed',
            error: sanitizeNestedRepoImportError('Failed to import nested repository', error)
          })
        }
      }

      const importedCount = results.filter((entry) => entry.status === 'imported').length
      const alreadyKnownCount = results.filter((entry) => entry.status === 'already-known').length
      const failedCount = results.filter((entry) => entry.status === 'failed').length
      if (importedCount + alreadyKnownCount === 0) {
        for (const group of groupResolver.getCreatedGroups().toReversed()) {
          store.deleteProjectGroup(group.id)
        }
      }
      invalidateAuthorizedRootsCache()
      notifyReposChanged(mainWindow)
      const rootGroup = groupResolver.getRootGroup()
      return {
        ...(rootGroup && importedCount + alreadyKnownCount > 0 ? { group: rootGroup } : {}),
        projects: results,
        importedCount,
        alreadyKnownCount,
        failedCount
      }
    }
  )
}
