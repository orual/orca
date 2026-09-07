import { mkdir } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { Repo } from '../../shared/repo-types'
import type { CreateWorktreeArgs, CreateWorktreeResult } from '../../shared/worktree/create-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import {
  computeRemoteWorktreePath,
  computeWorktreePath,
  getWorktreePathSettings,
  mergeWorktree,
  sanitizeWorktreeName
} from '../ipc/worktree-logic'
import { getRepoExecutionHostId, getRepoSshConnectionId } from '../../shared/execution-host'
import {
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'
import type { JjFailure, JjWorkspace } from '../../shared/jj-types'
import type { Store } from '../persistence'
import { isJjRepo } from '../../shared/repo-kind'
import {
  readWorktreeMetaForHost,
  writeWorktreeMetaForHost
} from '../persistence/host-qualified-worktree-meta'
import { jjBackendForRepo } from './jj-workspace-catalog'
import { createWslDirectory } from './jj-backend'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { getWorktreeMirrorDistro } from '../project-runtime-git-options'
import { toWslExecutionSpace, toWindowsWslPath } from '../../shared/wsl-paths'
import type { createSetupRunnerScript } from '../worktree-runner-script'
import { prepareJjWorkspaceSetup } from './jj-workspace-setup'

export { prepareJjWorkspaceSetup } from './jj-workspace-setup'

export type JjWorkspaceCreateOperation = {
  /** Path exposed to the rest of Orca (UNC for a WSL-backed repo). */
  destination: string
  name: string
  revision: string
  creationSource?: WorktreeMeta['orcaCreationSource']
  prepareDestinationParent?: () => Promise<void>
  listWorkspaces: () => Promise<JjWorkspace[]>
  addWorkspace: (input: {
    destination: string
    name?: string
    revision?: string
  }) => Promise<{ ok: true; destination: string; name?: string } | JjFailure>
}

export type JjWorkspaceCreateRequest = Pick<
  CreateWorktreeArgs,
  | 'name'
  | 'jjStartRevision'
  | 'displayName'
  | 'displayNameKind'
  | 'manualOrder'
  | 'workspaceStatus'
  | 'linkedWorkItem'
  | 'linkedTaskSourceContext'
  | 'linkedIssue'
  | 'linkedPR'
  | 'linkedLinearIssue'
  | 'linkedLinearIssueWorkspaceId'
  | 'linkedLinearIssueOrganizationUrlKey'
  | 'linkedGitLabIssue'
  | 'linkedGitLabMR'
  | 'linkedBitbucketPR'
  | 'linkedAzureDevOpsPR'
  | 'linkedGiteaPR'
> & {
  comment?: string
  setupDecision?: CreateWorktreeArgs['setupDecision']
  runHooks?: boolean
}

/** Build the host-owned jj operation. The visible path and execution path differ for WSL. */
export function createJjWorkspaceCreateOperation(
  store: Store,
  repo: Repo,
  request: Pick<CreateWorktreeArgs, 'name' | 'jjStartRevision'>,
  creationSource: WorktreeMeta['orcaCreationSource'] = 'runtime'
): JjWorkspaceCreateOperation {
  if (!isJjRepo(repo)) {
    throw new Error(`Cannot create a jj workspace for non-jj repo ${repo.id}`)
  }
  const settings = store.getSettings()
  const wslDistro = getWorktreeMirrorDistro(store, repo)
  const pathSettings = getWorktreePathSettings(repo, settings, wslDistro)
  const name = sanitizeWorktreeName(request.name)
  const routeUsesRemotePath = Boolean(getRepoSshConnectionId(repo))
  const destination = routeUsesRemotePath
    ? computeRemoteWorktreePath(name, repo.path, pathSettings)
    : computeWorktreePath(name, repo.path, pathSettings)
  const executionDestination = wslDistro ? toWslExecutionSpace(destination) : destination
  const backend = jjBackendForRepo(repo, wslDistro ? { wslDistro } : {})
  const pathOps = isWindowsAbsolutePathLike(executionDestination) ? win32 : posix
  const destinationParent = pathOps.dirname(executionDestination)
  const prepareDestinationParent = wslDistro
    ? () => createWslDirectory(wslDistro, destinationParent, toWslExecutionSpace(repo.path))
    : routeUsesRemotePath
      ? async () => {
          const connectionId = getRepoSshConnectionId(repo)
          const provider = connectionId ? getSshFilesystemProvider(connectionId) : undefined
          if (!provider) {
            throw new Error('SSH filesystem provider unavailable')
          }
          await provider.createDir(destinationParent)
        }
      : async () => {
          await mkdir(destinationParent, { recursive: true })
        }
  return {
    destination,
    name,
    revision: request.jjStartRevision?.trim() || '@',
    creationSource,
    prepareDestinationParent,
    listWorkspaces: async () => {
      const result = await backend.listWorkspaces()
      if (!result.ok) {
        throw new Error(result.message)
      }
      return result.workspaces.map((workspace) => ({
        ...workspace,
        root:
          workspace.root && wslDistro ? toWindowsWslPath(workspace.root, wslDistro) : workspace.root
      }))
    },
    addWorkspace: (input) =>
      backend.addWorkspace({
        ...input,
        destination: executionDestination
      })
  }
}

export async function createJjWorktree(
  store: Store,
  repo: Repo,
  request: JjWorkspaceCreateRequest,
  operation: JjWorkspaceCreateOperation
): Promise<CreateWorktreeResult> {
  if (!isJjRepo(repo)) {
    throw new Error(`Cannot create a jj workspace for non-jj repo ${repo.id}`)
  }
  const name = sanitizeWorktreeName(request.name)
  const revision = request.jjStartRevision?.trim() || '@'
  const listed = await operation.listWorkspaces()
  const destination = normalizeRuntimePathForComparison(operation.destination)
  const existing = listed.find(
    (workspace) =>
      workspace.root !== null && normalizeRuntimePathForComparison(workspace.root) === destination
  )
  const root = operation.destination
  const worktreeId = `${repo.id}::${root}`
  const executionHostId = getRepoExecutionHostId(repo)
  const persistedForHost = readWorktreeMetaForHost(store, worktreeId, executionHostId)
  const persistedLegacy = !store.getWorktreeMetaForHost
    ? store.getWorktreeMeta?.(worktreeId)
    : undefined
  const priorMeta = persistedForHost ?? persistedLegacy
  const priorWorkspace = priorMeta?.jjWorkspace
  const isKnownRetry = Boolean(
    existing &&
    existing.name === name &&
    priorWorkspace?.name === existing.name &&
    priorWorkspace.root !== undefined &&
    priorWorkspace.root !== null &&
    normalizeRuntimePathForComparison(priorWorkspace.root) === destination
  )
  if (existing && !isKnownRetry) {
    if (existing.name !== name) {
      throw new Error(
        `jj workspace destination is already used by workspace "${existing.name}"; refusing to adopt it.`
      )
    }
    throw new Error(
      'jj workspace destination already exists without matching Orca metadata; refusing to adopt it.'
    )
  }
  let actualName = existing?.name ?? name
  if (!existing) {
    await operation.prepareDestinationParent?.()
    const added = await operation.addWorkspace({
      destination: operation.destination,
      name,
      revision
    })
    if (!added.ok) {
      throw new Error(added.message)
    }
    actualName = added.name ?? name
  }

  const jjWorkspace = { name: actualName, root, rootResolved: true }
  const now = Date.now()
  const meta: Partial<WorktreeMeta> = {
    ...priorMeta,
    ...(priorMeta?.instanceId ? {} : { instanceId: crypto.randomUUID() }),
    hostId: priorMeta?.hostId ?? executionHostId,
    lastActivityAt: now,
    ...(priorMeta?.createdAt === undefined ? { createdAt: now } : {}),
    ...(priorMeta?.orcaCreatedAt === undefined ? { orcaCreatedAt: now } : {}),
    orcaCreationSource: priorMeta?.orcaCreationSource ?? operation.creationSource ?? 'runtime',
    jjWorkspace,
    displayName: request.displayName ?? priorMeta?.displayName ?? request.name,
    ...(request.displayNameKind !== undefined
      ? { displayNameIsPinned: request.displayNameKind === 'user' }
      : {}),
    ...(request.comment !== undefined ? { comment: request.comment } : {}),
    ...(request.manualOrder !== undefined ? { manualOrder: request.manualOrder } : {}),
    ...(request.workspaceStatus !== undefined ? { workspaceStatus: request.workspaceStatus } : {}),
    ...(request.linkedIssue !== undefined ? { linkedIssue: request.linkedIssue } : {}),
    ...(request.linkedPR !== undefined ? { linkedPR: request.linkedPR } : {}),
    ...(request.linkedLinearIssue !== undefined
      ? { linkedLinearIssue: request.linkedLinearIssue }
      : {}),
    ...(request.linkedLinearIssueWorkspaceId !== undefined
      ? { linkedLinearIssueWorkspaceId: request.linkedLinearIssueWorkspaceId }
      : {}),
    ...(request.linkedLinearIssueOrganizationUrlKey !== undefined
      ? { linkedLinearIssueOrganizationUrlKey: request.linkedLinearIssueOrganizationUrlKey }
      : {}),
    ...(request.linkedGitLabIssue !== undefined
      ? { linkedGitLabIssue: request.linkedGitLabIssue }
      : {}),
    ...(request.linkedGitLabMR !== undefined ? { linkedGitLabMR: request.linkedGitLabMR } : {}),
    ...(request.linkedBitbucketPR !== undefined
      ? { linkedBitbucketPR: request.linkedBitbucketPR }
      : {}),
    ...(request.linkedAzureDevOpsPR !== undefined
      ? { linkedAzureDevOpsPR: request.linkedAzureDevOpsPR }
      : {}),
    ...(request.linkedGiteaPR !== undefined ? { linkedGiteaPR: request.linkedGiteaPR } : {}),
    ...(request.linkedWorkItem !== undefined ? { linkedWorkItem: request.linkedWorkItem } : {}),
    ...(request.linkedTaskSourceContext !== undefined
      ? { linkedTaskSourceContext: request.linkedTaskSourceContext }
      : {})
  }
  const persisted = writeWorktreeMetaForHost(store, worktreeId, executionHostId, meta)
  const git = {
    path: root,
    head: '',
    branch: '',
    isBare: false,
    isMainWorktree: false,
    jjWorkspace
  }
  return { worktree: mergeWorktree(repo.id, git, persisted, repo.displayName) }
}

export async function createJjManagedWorktree(
  store: Store,
  repo: Repo,
  request: JjWorkspaceCreateRequest,
  options: {
    creationSource: WorktreeMeta['orcaCreationSource']
    remote?: boolean
    runtimeTarget?: Parameters<typeof createSetupRunnerScript>[3]
    onCreated?: (result: CreateWorktreeResult) => void
  }
): Promise<CreateWorktreeResult> {
  const created = await createJjWorktree(
    store,
    repo,
    request,
    createJjWorkspaceCreateOperation(store, repo, request, options.creationSource)
  )
  const setup = await prepareJjWorkspaceSetup(repo, created.worktree.path, request, options)
  const result = {
    ...created,
    ...(setup.setup ? { setup: setup.setup } : {}),
    ...(setup.warning ? { warning: setup.warning } : {})
  }
  options.onCreated?.(result)
  return result
}
