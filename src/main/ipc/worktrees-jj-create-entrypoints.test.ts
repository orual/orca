import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JjExecutor, JjWorkspace } from '../../shared/jj-types'
import type { CreateWorktreeResult } from '../../shared/worktree/create-types'
import type { Repo } from '../../shared/repo-types'
import { registerSshJjProvider, unregisterSshJjProvider } from '../providers/ssh-jj-dispatch'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { createRemoteJjSetupRunnerScript } from '../jj/jj-workspace-setup'
import {
  addWorktreeMock,
  createSetupRunnerScriptMock,
  getBaseRefDefaultMock,
  getEffectiveHooksMock,
  getSshFilesystemProviderMock,
  getSshGitProviderMock,
  gitExecFileAsyncMock,
  resolveDefaultBaseRefViaExecMock,
  resolveDefaultBaseRefWithLocalGitMock,
  shouldRunSetupForCreateMock
} from './worktrees-test-module-mocks'
import { handlers, mainWindow, setupWorktreeHandlers, store } from './worktrees-test-harness'
import { registerWorktreeHandlers } from './worktrees'

vi.mock('electron', async () =>
  (await import('./worktrees-test-module-mocks')).electronModuleMock()
)
vi.mock('../git/worktree', async () =>
  (await import('./worktrees-test-module-mocks')).gitWorktreeModuleMock()
)
vi.mock('../git/runner', async () =>
  (await import('./worktrees-test-module-mocks')).gitRunnerModuleMock()
)
vi.mock('../git/repo', async () =>
  (await import('./worktrees-test-module-mocks')).gitRepoModuleMock()
)
vi.mock('../git/git-username', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveLocalGitUsername: (await import('./worktrees-test-module-mocks'))
    .resolveLocalGitUsernameMock
}))
vi.mock('../github/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./worktrees-test-module-mocks')).githubClientModuleMock()
}))
vi.mock('../source-control/hosted-review', async () =>
  (await import('./worktrees-test-module-mocks')).hostedReviewModuleMock()
)
vi.mock('../providers/ssh-git-dispatch', async () =>
  (await import('./worktrees-test-module-mocks')).sshGitDispatchModuleMock()
)
vi.mock('../providers/ssh-filesystem-dispatch', async () =>
  (await import('./worktrees-test-module-mocks')).sshFilesystemDispatchModuleMock()
)
vi.mock('./worktree-symlinks', async () =>
  (await import('./worktrees-test-module-mocks')).worktreeSymlinksModuleMock()
)
vi.mock('./ssh', async () => (await import('./worktrees-test-module-mocks')).sshModuleMock())
vi.mock('../ssh/ssh-target-registry', async () =>
  (await import('./worktrees-test-module-mocks')).sshTargetRegistryModuleMock()
)
vi.mock('../hooks', async () => (await import('./worktrees-test-module-mocks')).hooksModuleMock())
vi.mock('../setup-runner-script-text', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).setupRunnerScriptTextModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../worktree-runner-script', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).worktreeRunnerScriptModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../effective-hook-config', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).effectiveHookConfigModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../setup-hook-env-vars', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).setupHookEnvVarsModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('./worktree-logic', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).worktreeLogicModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../terminal-history-deletion', async () =>
  (await import('./worktrees-test-module-mocks')).terminalHistoryDeletionModuleMock()
)
vi.mock('../ports/advertised-url-watcher', async () =>
  (await import('./worktrees-test-module-mocks')).advertisedUrlWatcherModuleMock()
)
vi.mock('../workspace-cleanup-scan-snapshot', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceCleanupScanSnapshotModuleMock()
)
vi.mock('../workspace-space-analysis-snapshot', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceSpaceAnalysisSnapshotModuleMock()
)
vi.mock('../workspace-cleanup-removal-snapshot-prune', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceCleanupRemovalSnapshotPruneModuleMock()
)
vi.mock('../runtime/worktree-teardown', async () =>
  (await import('./worktrees-test-module-mocks')).worktreeTeardownModuleMock()
)
vi.mock('./pty', async () => (await import('./worktrees-test-module-mocks')).ptyModuleMock())

const binary = process.env.JJ_BINARY ?? 'jj'
const tempDirectories: string[] = []

type Metadata = Record<string, Record<string, unknown>>

async function fixtureRun(request: Parameters<JjExecutor>[0]) {
  const { runProcess } = await import('../../shared/child-process/run-process')
  return runProcess({
    program: binary,
    args: request.args,
    cwd: request.cwd,
    signal: request.signal,
    outputEncoding: request.binary ? 'buffer' : 'utf8'
  })
}

async function resolveFixturePosixShell(): Promise<string> {
  const configuredShell = process.env.SHELL || userInfo().shell
  const candidates = [
    configuredShell ? join(dirname(configuredShell), 'sh') : undefined,
    ...(process.env.PATH || '').split(delimiter).map((directory) => join(directory, 'sh'))
  ].filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next host-provided shell location.
    }
  }
  throw new Error('POSIX shell unavailable for the SSH jj runner fixture')
}

async function createJjFixture(): Promise<{ repoPath: string; workspaceRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'orca-jj-create-entrypoint-'))
  tempDirectories.push(root)
  const repoPath = join(root, 'repo')
  const workspaceRoot = join(root, 'workspaces')
  const result = await fixtureRun({ args: ['git', 'init', '--no-colocate', repoPath] })
  if (result.code !== 0) {
    throw new Error(`jj fixture unavailable: ${String(result.stderr)}`)
  }
  return { repoPath, workspaceRoot }
}

function installMetadataStore(metadata: Metadata): void {
  store.getWorktreeMeta.mockImplementation((id, ..._args) => metadata[String(id)])
  store.getWorktreeMetaForHost.mockImplementation((id, ..._args) => metadata[String(id)])
  store.setWorktreeMeta.mockImplementation((id, patch) => {
    const key = String(id)
    metadata[key] = { ...metadata[key], ...(patch as Record<string, unknown>) }
    return metadata[key]
  })
  store.setWorktreeMetaForHost.mockImplementation((id, ...args) => {
    const key = String(id)
    const patch = args[1] as Record<string, unknown>
    metadata[key] = { ...metadata[key], ...patch }
    return metadata[key]
  })
}

function useRepo(repo: Repo): void {
  store.getRepos.mockReturnValue([repo])
  store.getRepo.mockReturnValue(repo)
}

function localJjRepo(repoPath: string): Repo {
  return {
    id: 'jj-repo',
    path: repoPath,
    displayName: 'jj repo',
    badgeColor: '#000',
    addedAt: 0,
    kind: 'jj',
    executionHostId: 'local'
  }
}

function remoteJjRepo(): Repo {
  return {
    id: 'jj-ssh-repo',
    path: '/srv/repo',
    displayName: 'remote jj repo',
    badgeColor: '#000',
    addedAt: 0,
    kind: 'jj',
    connectionId: 'jj-target',
    executionHostId: 'ssh:jj-target'
  }
}

function resetJjProvider(): void {
  unregisterSshJjProvider('jj-target')
}

function registerRemoteJjProvider(
  options: {
    workspaces?: JjWorkspace[]
    addWorkspace?: ReturnType<typeof vi.fn>
  } = {}
): ReturnType<typeof vi.fn> {
  const addWorkspace =
    options.addWorkspace ??
    vi.fn(async (_repoPath: string, input: unknown) => ({
      ok: true as const,
      destination: (input as { destination: string }).destination,
      name: (input as { name?: string }).name
    }))
  registerSshJjProvider('jj-target', {
    detect: vi.fn(async () => ({
      ok: true as const,
      version: '0.44.0',
      root: '/srv/repo',
      colocated: false,
      repositoryIdentity: '/srv/repo'
    })),
    listWorkspaces: vi.fn(async () => ({
      ok: true as const,
      workspaces: options.workspaces ?? []
    })),
    addWorkspace
  } as never)
  return addWorkspace
}

async function remoteSetupProviders(): Promise<{
  ownerRoot: string
  fsProvider: {
    readFile: ReturnType<typeof vi.fn>
    createDir: ReturnType<typeof vi.fn>
    writeFile: ReturnType<typeof vi.fn>
    writePrivateFile: ReturnType<typeof vi.fn>
  }
}> {
  const ownerRoot = await mkdtemp(join(tmpdir(), 'orca-jj-ssh-owner-'))
  tempDirectories.push(ownerRoot)
  const toOwnerPath = (remotePath: string): string => {
    if (remotePath.startsWith('/srv/')) {
      return join(ownerRoot, remotePath.slice('/srv/'.length))
    }
    if (remotePath.startsWith('/home/orca/')) {
      return join(ownerRoot, remotePath.slice('/home/orca/'.length))
    }
    throw new Error(`unexpected fixture host path: ${remotePath}`)
  }
  const fsProvider = {
    readFile: vi.fn(async () => ({
      content: 'scripts:\n  setup: printf setup-ran > setup-ran\n',
      isBinary: false
    })),
    createDir: vi.fn(async (remotePath: string) => {
      await mkdir(toOwnerPath(remotePath), { recursive: true })
    }),
    writeFile: vi.fn(async (remotePath: string, content: string) => {
      await writeFile(toOwnerPath(remotePath), content)
    }),
    writePrivateFile: vi.fn(
      async (workspaceKey: string, extension: 'sh' | 'cmd', content: string) => {
        const remotePath = `/home/orca/.orca/jj/setup/${workspaceKey}/setup-runner.${extension}`
        const localPath = toOwnerPath(remotePath)
        await mkdir(join(ownerRoot, '.orca', 'jj', 'setup', workspaceKey), {
          recursive: true,
          mode: 0o700
        })
        await writeFile(localPath, content, { mode: 0o700 })
        return remotePath
      }
    )
  }
  getSshGitProviderMock.mockReturnValue(undefined)
  getSshFilesystemProviderMock.mockReturnValue(fsProvider)
  return { ownerRoot, fsProvider }
}

beforeEach(() => {
  setupWorktreeHandlers()
  resetJjProvider()
  vi.useRealTimers()
  getBaseRefDefaultMock.mockClear()
  resolveDefaultBaseRefWithLocalGitMock.mockClear()
  resolveDefaultBaseRefViaExecMock.mockClear()
  gitExecFileAsyncMock.mockClear()
  addWorktreeMock.mockClear()
  createSetupRunnerScriptMock.mockClear()
  shouldRunSetupForCreateMock.mockReturnValue(false)
  getEffectiveHooksMock.mockReturnValue(null)
})

afterEach(async () => {
  resetJjProvider()
  vi.useRealTimers()
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('registered jj worktree creation', () => {
  it('creates a real jj workspace through worktrees:create without Git creation flow', async () => {
    const { repoPath, workspaceRoot } = await createJjFixture()
    const repo = localJjRepo(repoPath)
    const metadata: Metadata = {}
    useRepo(repo)
    installMetadataStore(metadata)
    store.getSettings.mockReturnValue({
      branchPrefix: 'none',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      workspaceDir: workspaceRoot
    })
    const runtime = new OrcaRuntimeService(store as never)
    await runtime.listManagedWorktrees(repo.id)
    registerWorktreeHandlers(mainWindow as never, store as never, runtime)

    const result = (await handlers['worktrees:create'](null, {
      repoId: repo.id,
      workspaceKind: 'jj',
      name: 'jj-feature',
      jjStartRevision: '@'
    })) as CreateWorktreeResult

    expect(result).toMatchObject({
      worktree: {
        repoId: repo.id,
        path: join(workspaceRoot, 'jj-feature'),
        jjWorkspace: {
          name: 'jj-feature',
          rootResolved: true
        }
      }
    })
    expect(addWorktreeMock).not.toHaveBeenCalled()
    expect(getBaseRefDefaultMock).not.toHaveBeenCalled()
    expect(resolveDefaultBaseRefWithLocalGitMock).not.toHaveBeenCalled()
    expect(resolveDefaultBaseRefViaExecMock).not.toHaveBeenCalled()
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
    expect(metadata[`${repo.id}::${join(workspaceRoot, 'jj-feature')}`]).toMatchObject({
      jjWorkspace: { name: 'jj-feature', rootResolved: true }
    })

    const worktreeSelector = `id:${result.worktree.id}`
    await expect(
      runtime.getRuntimeJjCurrentChangeMetadata(worktreeSelector)
    ).resolves.toMatchObject({
      ok: true,
      metadata: { workspaceName: 'jj-feature' }
    })
    await expect(runtime.listRuntimeJjChanges(worktreeSelector)).resolves.toMatchObject({
      ok: true,
      comparison: 'current-change-vs-parents'
    })
  })

  it('persists before setup, retains the jj workspace on setup failure, and retries identity safely', async () => {
    const { repoPath, workspaceRoot } = await createJjFixture()
    const repo = localJjRepo(repoPath)
    const metadata: Metadata = {}
    useRepo(repo)
    installMetadataStore(metadata)
    store.getSettings.mockReturnValue({
      branchPrefix: 'none',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      workspaceDir: workspaceRoot
    })
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    getEffectiveHooksMock.mockReturnValue({ scripts: { setup: 'pnpm install' } })
    shouldRunSetupForCreateMock.mockReturnValue(true)
    createSetupRunnerScriptMock.mockImplementation(() => {
      expect(Object.keys(metadata)).toHaveLength(1)
      expect(Object.values(metadata)[0]).toMatchObject({
        jjWorkspace: { name: 'retryable', rootResolved: true }
      })
      throw new Error('setup runner unavailable')
    })

    const first = await handlers['worktrees:create'](null, {
      repoId: repo.id,
      workspaceKind: 'jj',
      name: 'retryable',
      setupDecision: 'run'
    })
    const firstMeta = { ...metadata[Object.keys(metadata)[0]!] }

    expect(first).toMatchObject({
      worktree: { jjWorkspace: { name: 'retryable' } },
      warning: 'jj workspace created, but setup was not prepared: setup runner unavailable'
    })

    vi.setSystemTime(20_000)
    getEffectiveHooksMock.mockReturnValue(null)
    const second = await handlers['worktrees:create'](null, {
      repoId: repo.id,
      workspaceKind: 'jj',
      name: 'retryable'
    })
    const secondMeta = metadata[Object.keys(metadata)[0]!]!

    expect(second).toMatchObject({ worktree: { jjWorkspace: { name: 'retryable' } } })
    expect(firstMeta.instanceId).toBe(secondMeta.instanceId)
    expect(firstMeta.createdAt).toBe(secondMeta.createdAt)
    expect(firstMeta.orcaCreatedAt).toBe(secondMeta.orcaCreatedAt)
    expect(secondMeta.lastActivityAt).toBe(20_000)
    expect(createSetupRunnerScriptMock).toHaveBeenCalledOnce()
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')(
    'uses the existing remote setup runner for SSH jj creation',
    async () => {
      const repo = remoteJjRepo()
      const metadata: Metadata = {}
      useRepo(repo)
      installMetadataStore(metadata)
      store.getSettings.mockReturnValue({
        branchPrefix: 'none',
        nestWorkspaces: false,
        refreshLocalBaseRefOnWorktreeCreate: false,
        workspaceDir: '/workspace'
      })
      const addWorkspace = registerRemoteJjProvider()
      const { ownerRoot, fsProvider } = await remoteSetupProviders()
      const remoteCallOrder: string[] = []
      fsProvider.createDir.mockImplementation(async (remotePath: string) => {
        remoteCallOrder.push('mkdir')
        await mkdir(join(ownerRoot, remotePath.replace(/^\/srv\/?/, '')), { recursive: true })
      })
      addWorkspace.mockImplementation(
        async (_repoPath: string, input: { destination: string; name?: string }) => {
          remoteCallOrder.push('add')
          return { ok: true as const, destination: input.destination, name: input.name }
        }
      )
      getEffectiveHooksMock.mockReturnValue({
        scripts: { setup: 'printf setup-ran > setup-ran' }
      })
      shouldRunSetupForCreateMock.mockReturnValue(true)

      const result = (await handlers['worktrees:create'](null, {
        repoId: repo.id,
        workspaceKind: 'jj',
        name: 'remote-feature',
        setupDecision: 'run'
      })) as { setup?: { runnerScriptPath: string } }

      expect(addWorkspace).toHaveBeenCalledWith(
        repo.path,
        expect.objectContaining({ name: 'remote-feature' }),
        expect.anything()
      )
      expect(remoteCallOrder.slice(0, 2)).toEqual(['mkdir', 'add'])
      expect(fsProvider.createDir).toHaveBeenCalledWith('/srv')
      expect(getSshGitProviderMock).not.toHaveBeenCalled()
      expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
      expect(fsProvider.createDir).not.toHaveBeenCalledWith('/srv/repo-remote-feature/.jj/orca')
      expect(fsProvider.writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('/.jj/'),
        expect.any(String)
      )
      expect(fsProvider.writePrivateFile).toHaveBeenCalledWith(
        expect.stringMatching(/^[a-f0-9]{32}$/),
        'sh',
        expect.any(String)
      )
      const runnerScriptPath = (result.setup as { runnerScriptPath: string }).runnerScriptPath
      expect(runnerScriptPath).toMatch(
        /^\/home\/orca\/\.orca\/jj\/setup\/[a-f0-9]{32}\/setup-runner\.sh$/
      )
      const setupScript = await readFile(
        join(ownerRoot, runnerScriptPath.replace('/home/orca/', '')),
        'utf8'
      )
      expect(setupScript).toContain('printf setup-ran > setup-ran')
      await mkdir(join(ownerRoot, 'repo-remote-feature'), { recursive: true })
      const { runProcess } = await import('../../shared/child-process/run-process')
      const run = (await runProcess({
        program: await resolveFixturePosixShell(),
        args: [join(ownerRoot, runnerScriptPath.replace('/home/orca/', ''))],
        cwd: join(ownerRoot, 'repo-remote-feature')
      })) as { code: number | null }
      expect(run.code).toBe(0)
      await expect(
        readFile(join(ownerRoot, 'repo-remote-feature', 'setup-ran'), 'utf8')
      ).resolves.toBe('setup-ran')
      const rerun = await createRemoteJjSetupRunnerScript(
        repo,
        '/srv/repo-remote-feature',
        'printf rerun-ran > rerun-ran',
        fsProvider as never
      )
      expect(rerun.runnerScriptPath).toBe(runnerScriptPath)
      const other = await createRemoteJjSetupRunnerScript(
        repo,
        '/srv/repo-remote-other',
        'printf other-ran > other-ran',
        fsProvider as never
      )
      expect(other.runnerScriptPath).not.toBe(runnerScriptPath)
      expect(fsProvider.writePrivateFile).toHaveBeenCalledTimes(3)
      expect(fsProvider.writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('/.jj/'),
        expect.any(String)
      )
      expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
      expect(addWorktreeMock).not.toHaveBeenCalled()
    }
  )

  it('fails unavailable SSH jj creation without falling back to local Git', async () => {
    const repo = remoteJjRepo()
    useRepo(repo)
    getSshGitProviderMock.mockReturnValue({})
    registerRemoteJjProvider()

    await expect(
      handlers['worktrees:create'](null, {
        repoId: repo.id,
        workspaceKind: 'jj',
        name: 'unavailable'
      })
    ).rejects.toThrow('SSH filesystem provider unavailable')
    expect(addWorktreeMock).not.toHaveBeenCalled()
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })
})

describe('runtime jj worktree creation', () => {
  it('creates through OrcaRuntimeService.createManagedWorktree without Git base or worktree calls', async () => {
    const { repoPath, workspaceRoot } = await createJjFixture()
    const repo = localJjRepo(repoPath)
    const metadata: Metadata = {}
    useRepo(repo)
    installMetadataStore(metadata)
    store.getSettings.mockReturnValue({
      branchPrefix: 'none',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      workspaceDir: workspaceRoot,
      disabledTuiAgents: []
    })
    const runtime = new OrcaRuntimeService(store as never)

    const result = await runtime.createManagedWorktree({
      repoSelector: repo.id,
      workspaceKind: 'jj',
      name: 'runtime-feature',
      setupDecision: 'skip'
    })

    expect(result).toMatchObject({
      worktree: {
        repoId: repo.id,
        path: join(workspaceRoot, 'runtime-feature'),
        jjWorkspace: { name: 'runtime-feature' }
      }
    })
    expect(addWorktreeMock).not.toHaveBeenCalled()
    expect(getBaseRefDefaultMock).not.toHaveBeenCalled()
    expect(resolveDefaultBaseRefWithLocalGitMock).not.toHaveBeenCalled()
    expect(resolveDefaultBaseRefViaExecMock).not.toHaveBeenCalled()
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()

    const worktreeSelector = `id:${result.worktree.id}`
    await expect(
      runtime.getRuntimeJjCurrentChangeMetadata(worktreeSelector)
    ).resolves.toMatchObject({
      ok: true,
      metadata: { workspaceName: 'runtime-feature' }
    })
    await expect(runtime.listRuntimeJjChanges(worktreeSelector)).resolves.toMatchObject({
      ok: true,
      comparison: 'current-change-vs-parents'
    })
  })

  it('rejects an unavailable SSH jj provider without local fallback at the runtime entrypoint', async () => {
    const repo = remoteJjRepo()
    useRepo(repo)
    store.getSettings.mockReturnValue({
      branchPrefix: 'none',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      workspaceDir: '/workspace',
      disabledTuiAgents: []
    })
    getSshGitProviderMock.mockReturnValue({})
    const runtime = new OrcaRuntimeService(store as never)

    await expect(
      runtime.createManagedWorktree({
        repoSelector: repo.id,
        workspaceKind: 'jj',
        name: 'runtime-unavailable'
      })
    ).rejects.toThrow('SSH jj provider unavailable')
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })
})
