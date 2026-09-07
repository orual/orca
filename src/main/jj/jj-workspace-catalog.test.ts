import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { statSync } from 'node:fs'
import { createJjBackend } from './jj-backend'
import { registerSshJjProvider, unregisterSshJjProvider } from '../providers/ssh-jj-dispatch'
import {
  listJjWorkspacesForRepo,
  listJjWorktreesForRepo,
  assertJjWorkspaceCanBePhysicallyDeleted,
  buildJjWorktreeInfos,
  persistJjWorktreeMetadata
} from './jj-workspace-catalog'
import {
  createJjWorkspaceCreateOperation,
  createJjWorktree,
  prepareJjWorkspaceSetup
} from './jj-workspace-creation'
import { getWorktreeMirrorDistro } from '../project-runtime-git-options'
import { repo, store } from './jj-workspace-catalog-test-fixtures'

vi.mock('../hooks', () => ({
  getEffectiveHooks: vi.fn(() => ({ scripts: { setup: 'false' } })),
  runHook: vi.fn(async () => ({ success: false, output: 'setup failed' }))
}))
vi.mock('../effective-hook-config', () => ({
  shouldRunSetupForCreate: vi.fn(() => true)
}))
vi.mock('../project-runtime-git-options', () => ({
  getWorktreeMirrorDistro: vi.fn(() => undefined),
  getLocalProjectWorktreeGitOptions: vi.fn(() => ({}))
}))
vi.mock('./jj-backend', () => ({ createJjBackend: vi.fn() }))
vi.mock('node:fs', () => ({ statSync: vi.fn(() => ({ isDirectory: () => true })) }))

describe('jj workspace catalog', () => {
  it('allows sibling and outside-scan workspaces while protecting owner storage and nested workspaces', () => {
    expect(() =>
      assertJjWorkspaceCanBePhysicallyDeleted('/scan/feature', '/repo', [
        { name: 'owner', root: '/repo' },
        { name: 'feature', root: '/scan/feature' },
        { name: 'sibling', root: '/scan/feature-copy' }
      ])
    ).not.toThrow()

    expect(() =>
      assertJjWorkspaceCanBePhysicallyDeleted('/repo', '/repo', [{ name: 'owner', root: '/repo' }])
    ).toThrow('structural JJ repository owner')
    expect(() =>
      assertJjWorkspaceCanBePhysicallyDeleted('/repo-parent', '/repo-parent/.jj-store', [
        { name: 'owner', root: '/repo-parent/.jj-store' }
      ])
    ).toThrow('structural repository store')
    expect(() =>
      assertJjWorkspaceCanBePhysicallyDeleted('/repo-parent', '/repo', [
        { name: 'owner', root: '/repo' },
        { name: 'child', root: '/repo-parent/child' }
      ])
    ).toThrow('another registered workspace')
  })

  const backend = { listWorkspaces: vi.fn() }

  beforeEach(() => {
    vi.mocked(createJjBackend).mockClear()
    vi.mocked(createJjBackend).mockReturnValue(backend as never)
    backend.listWorkspaces.mockReset()
  })

  afterEach(() => {
    unregisterSshJjProvider('jj-box')
  })

  it('returns complete named roots without Git fallback', async () => {
    backend.listWorkspaces.mockResolvedValue({
      ok: true,
      workspaces: [
        { name: 'default', root: '/repo' },
        { name: 'feature', root: '/repo-feature' }
      ]
    })
    vi.mocked(createJjBackend).mockImplementation(
      (target) =>
        ({
          ...backend,
          detect: vi.fn().mockResolvedValue({
            ok: true,
            root: target.cwd ?? '/repo',
            repositoryIdentity: '/repo/.git'
          })
        }) as never
    )
    await expect(listJjWorkspacesForRepo(repo())).resolves.toMatchObject({
      provider: 'jj',
      ok: true,
      complete: true,
      resolvedRoots: new Set(['/repo', '/repo-feature']),
      workspaces: expect.arrayContaining([{ name: 'default', root: '/repo' }])
    })
  })

  it('does not invent a primary worktree from a renameable JJ workspace name', async () => {
    backend.listWorkspaces.mockResolvedValue({
      ok: true,
      workspaces: [
        { name: 'feature', root: '/repo/' },
        { name: 'default', root: '/owner/' }
      ]
    })
    vi.mocked(createJjBackend).mockImplementation(
      (target) =>
        ({
          ...backend,
          detect: vi.fn().mockResolvedValue({
            ok: true,
            root: target.cwd ?? '/repo',
            repositoryIdentity: '/repo/.git'
          })
        }) as never
    )

    await expect(listJjWorktreesForRepo(repo({ path: '/repo/' }))).resolves.toEqual([
      expect.objectContaining({ path: '/repo/', isMainWorktree: false }),
      expect.objectContaining({ path: '/owner/', isMainWorktree: false })
    ])
  })

  it('does not treat a root-equal replacement jj repository as verified', async () => {
    backend.listWorkspaces.mockResolvedValue({
      ok: true,
      workspaces: [{ name: 'replacement', root: '/repo' }]
    })
    let detectCalls = 0
    vi.mocked(createJjBackend).mockImplementation(
      () =>
        ({
          ...backend,
          detect: vi.fn().mockImplementation(async () => ({
            ok: true,
            root: '/repo',
            repositoryIdentity: detectCalls++ === 0 ? '/repo/.git' : '/other/.git'
          }))
        }) as never
    )

    const result = await listJjWorkspacesForRepo(repo())
    expect(result).toMatchObject({ ok: true, complete: false })
    const rows = buildJjWorktreeInfos(store(), repo(), result)
    expect(rows[0]?.jjWorkspace).toMatchObject({ name: 'replacement', rootResolved: false })
  })

  it('marks null roots incomplete and preserves stored rows', async () => {
    backend.listWorkspaces.mockResolvedValue({
      ok: true,
      workspaces: [
        { name: 'default', root: null },
        { name: 'feature', root: '/repo-feature' }
      ]
    })
    vi.mocked(createJjBackend).mockImplementation(
      (target) =>
        ({
          ...backend,
          detect: vi.fn().mockResolvedValue({
            ok: true,
            root: target.cwd ?? '/repo',
            repositoryIdentity: '/repo/.git'
          })
        }) as never
    )
    const result = await listJjWorkspacesForRepo(repo())
    expect(result).toMatchObject({ ok: true, complete: false })
    const rows = buildJjWorktreeInfos(
      store({ 'repo-1::/old': { displayName: 'old', hostId: 'local' } }),
      repo(),
      result
    )
    expect(rows.map((row) => row.path)).toEqual(['/old', '/repo-feature'])
    expect(rows.find((row) => row.path === '/old')?.jjWorkspace?.rootResolved).toBe(false)
    expect(rows.find((row) => row.path === '/repo-feature')?.jjWorkspace?.rootResolved).toBe(true)
  })

  it('keeps stored rows on jj listing failure', async () => {
    backend.listWorkspaces.mockResolvedValue({
      ok: false,
      kind: 'unavailable',
      message: 'jj missing'
    })
    const result = await listJjWorkspacesForRepo(repo())
    const rows = buildJjWorktreeInfos(
      store({ 'repo-1::/old': { displayName: 'old', hostId: 'local' } }),
      repo(),
      result
    )
    expect(result).toMatchObject({ ok: false, provider: 'jj', complete: false })
    expect(rows).toEqual([expect.objectContaining({ path: '/old' })])
    expect(rows[0]?.jjWorkspace?.rootResolved).toBe(false)
  })

  it('routes SSH jj through the jj provider, not Git, without local filesystem IO', async () => {
    const listWorkspaces = vi.fn().mockResolvedValue({
      ok: true,
      workspaces: [{ name: 'remote', root: '/srv/repo' }]
    })
    const detect = vi.fn().mockResolvedValue({
      ok: true,
      root: '/srv/repo',
      repositoryIdentity: '/srv/repo/.git'
    })
    registerSshJjProvider('jj-box', { listWorkspaces, detect } as never)
    await expect(
      listJjWorkspacesForRepo(repo({ connectionId: 'jj-box', executionHostId: 'ssh:jj-box' }))
    ).resolves.toMatchObject({ complete: true, resolvedRoots: new Set(['/srv/repo']) })
    expect(detect).toHaveBeenCalledWith('/repo', expect.anything())
    expect(detect).toHaveBeenCalledWith('/srv/repo', expect.anything())
    expect(statSync).not.toHaveBeenCalled()
    expect(listWorkspaces).toHaveBeenCalledWith('/repo', expect.anything())
    expect(createJjBackend).not.toHaveBeenCalled()
  })

  it('does not rewrite unchanged metadata on repeated complete polls', () => {
    const setWorktreeMeta = vi.fn()
    const metadataStore = store({
      'repo-1::/repo': {
        jjWorkspace: { name: 'default', root: '/repo', rootResolved: true }
      }
    })
    const result = {
      provider: 'jj' as const,
      ok: true as const,
      complete: true,
      workspaces: [{ name: 'default', root: '/repo' }],
      resolvedRoots: new Set(['/repo'])
    }
    const targetStore = { ...metadataStore, setWorktreeMeta } as never
    persistJjWorktreeMetadata(targetStore, repo(), result)
    expect(setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('passes cancellation to the local backend and does not write metadata while building', async () => {
    backend.listWorkspaces.mockResolvedValue({
      ok: true,
      workspaces: [{ name: 'default', root: '/repo' }]
    })
    vi.mocked(createJjBackend).mockImplementation(
      (target) =>
        ({
          ...backend,
          detect: vi.fn().mockResolvedValue({
            ok: true,
            root: target.cwd ?? '/repo',
            repositoryIdentity: '/repo/.git'
          })
        }) as never
    )
    const controller = new AbortController()
    const result = await listJjWorkspacesForRepo(repo(), { signal: controller.signal })
    expect(backend.listWorkspaces).toHaveBeenCalledWith({ signal: controller.signal })
    const setWorktreeMeta = vi.fn()
    const rows = buildJjWorktreeInfos({ ...store(), setWorktreeMeta } as never, repo(), result)
    expect(rows[0]?.jjWorkspace?.rootResolved).toBe(true)
    expect(setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('creates jj metadata without invoking Git and defaults the revision to @', async () => {
    const metadata: Record<string, unknown> = {}
    const setWorktreeMeta = vi.fn((id: string, updates: Record<string, unknown>) => {
      metadata[id] = { ...(metadata[id] as Record<string, unknown> | undefined), ...updates }
      return metadata[id]
    })
    const operation = {
      destination: '/tmp/orca-workspaces/repo/feature-name',
      name: 'feature-name',
      revision: '@',
      listWorkspaces: vi.fn(async () => []),
      addWorkspace: vi.fn(async () => ({
        ok: true as const,
        destination: '/tmp/orca-workspaces/repo/feature-name'
      }))
    }
    const result = await createJjWorktree(
      { ...store(), setWorktreeMeta } as never,
      repo(),
      { name: 'feature name', displayName: 'Feature' },
      operation
    )
    expect(operation.addWorkspace).toHaveBeenCalledWith({
      destination: operation.destination,
      name: 'feature-name',
      revision: '@'
    })
    expect(result.worktree.jjWorkspace).toEqual({
      name: 'feature-name',
      root: operation.destination,
      rootResolved: true
    })
    expect(setWorktreeMeta).toHaveBeenCalledTimes(1)
  })

  it('refuses to adopt a listed destination without persisted matching identity', async () => {
    const operation = {
      destination: '/tmp/orca-workspaces/repo/retry',
      name: 'retry',
      revision: 'main@',
      listWorkspaces: vi.fn(async () => [{ name: 'retry', root: operation.destination }]),
      addWorkspace: vi.fn()
    }
    await expect(
      createJjWorktree(
        { ...store() } as never,
        repo(),
        { name: 'retry', jjStartRevision: 'main@' },
        operation
      )
    ).rejects.toThrow('without matching Orca metadata')
    expect(operation.addWorkspace).not.toHaveBeenCalled()
  })

  it('reuses a known retry without recreating identity metadata', async () => {
    const operation = {
      destination: '/tmp/orca-workspaces/repo/retry',
      name: 'retry',
      revision: 'main@',
      listWorkspaces: vi.fn(async () => [{ name: 'retry', root: operation.destination }]),
      addWorkspace: vi.fn()
    }
    const setWorktreeMeta = vi.fn(() => ({
      instanceId: 'instance',
      hostId: 'local',
      createdAt: 10,
      jjWorkspace: { name: 'retry', root: operation.destination, rootResolved: true }
    }))
    const persisted = {
      instanceId: 'instance',
      hostId: 'local',
      createdAt: 10,
      jjWorkspace: { name: 'retry', root: operation.destination, rootResolved: true }
    }
    const result = await createJjWorktree(
      {
        ...store(),
        getWorktreeMetaForHost: vi.fn(() => persisted),
        setWorktreeMeta
      } as never,
      repo(),
      { name: 'retry', jjStartRevision: 'main@' },
      operation
    )
    expect(result.worktree.instanceId).toBe('instance')
    expect(result.worktree.createdAt).toBe(10)
    expect(operation.addWorkspace).not.toHaveBeenCalled()
  })

  it('retains the persisted row and returns a clear warning when setup fails', async () => {
    const setWorktreeMeta = vi.fn(() => ({
      instanceId: 'instance',
      hostId: 'local',
      displayName: 'feature',
      comment: '',
      jjWorkspace: { name: 'feature', root: '/tmp/feature', rootResolved: true }
    }))
    const created = await createJjWorktree(
      { ...store(), setWorktreeMeta } as never,
      repo(),
      { name: 'feature' },
      {
        destination: '/tmp/feature',
        name: 'feature',
        revision: '@',
        listWorkspaces: vi.fn(async () => []),
        addWorkspace: vi.fn(async () => ({ ok: true as const, destination: '/tmp/feature' }))
      }
    )
    const setup = await prepareJjWorkspaceSetup(repo(), created.worktree.path, {
      setupDecision: 'run'
    })
    expect(setWorktreeMeta).toHaveBeenCalledTimes(1)
    expect(setup.warning).toContain('jj workspace created, but setup was not prepared:')
  })

  it('passes a WSL execution path while preserving the visible destination', async () => {
    vi.mocked(getWorktreeMirrorDistro).mockReturnValue('Ubuntu')
    const addWorkspace = vi.fn(async () => ({
      ok: true as const,
      destination: '/home/user/orca/workspaces/repo/name with spaces'
    }))
    const wslBackend = {
      listWorkspaces: vi.fn(async () => ({ ok: true as const, workspaces: [] })),
      addWorkspace
    }
    vi.mocked(createJjBackend).mockReturnValue(wslBackend as never)
    const operation = createJjWorkspaceCreateOperation(
      {
        ...store(),
        getSettings: () => ({
          workspaceDir: '/tmp/workspaces',
          nestWorkspaces: false,
          worktreeVisibilityDefaults: {}
        })
      } as never,
      repo({
        path: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
        worktreeBasePath: '/home/user/orca/workspaces'
      }),
      { name: 'name with spaces' },
      'desktop'
    )
    await operation.addWorkspace({ destination: operation.destination, name: operation.name })
    expect(operation.destination).toContain('\\\\wsl.localhost\\Ubuntu')
    expect(addWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ destination: '/home/user/orca/workspaces/name-with-spaces' })
    )
  })
})
