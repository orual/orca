import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJjBackend } from './jj-backend'
import { removeJjWorkspace } from '../ipc/worktrees/removal/remove-jj-workspace'
import { repo, store } from './jj-workspace-catalog-test-fixtures'

const removalMocks = vi.hoisted(() => ({
  getLocalProjectWorktreeGitOptions: vi.fn(() => ({})),
  removeLocalWorktreePath: vi.fn(),
  stopPtysForDestructiveWorktreeRemoval: vi.fn(),
  removeWorktreeMetadataAndTransientState: vi.fn(),
  notifyWorktreesChanged: vi.fn(),
  invalidateAuthorizedRootsCache: vi.fn(),
  resolveWorktreeRemovalRoute: vi.fn(() => ({ kind: 'local' as const, hostId: 'local' as const }))
}))

vi.mock('../project-runtime-git-options', () => ({
  getLocalProjectWorktreeGitOptions: removalMocks.getLocalProjectWorktreeGitOptions
}))
vi.mock('../local-worktree-filesystem', () => ({
  removeLocalWorktreePath: removalMocks.removeLocalWorktreePath
}))
vi.mock('../ipc/worktrees/removal/worktree-removal-ownership', () => ({
  stopPtysForDestructiveWorktreeRemoval: removalMocks.stopPtysForDestructiveWorktreeRemoval,
  removeWorktreeMetadataAndTransientState: removalMocks.removeWorktreeMetadataAndTransientState
}))
vi.mock('../worktree-removal-execution-host-route', () => ({
  resolveWorktreeRemovalRoute: removalMocks.resolveWorktreeRemovalRoute
}))
vi.mock('../ipc/registered-worktree-roots-cache', () => ({
  invalidateAuthorizedRootsCache: removalMocks.invalidateAuthorizedRootsCache
}))
vi.mock('../ipc/worktree-remote', () => ({
  notifyWorktreesChanged: removalMocks.notifyWorktreesChanged
}))
vi.mock('./jj-backend', () => ({ createJjBackend: vi.fn() }))

describe('JJ workspace removal orchestration', () => {
  const worktreeId = 'repo-1::/workspace/feature'
  const targetRoot = '/workspace/feature'
  const ownerRoot = '/repo'
  const completeListing = {
    ok: true as const,
    complete: true,
    workspaces: [
      { name: 'default', root: ownerRoot },
      { name: 'feature', root: targetRoot },
      { name: 'sibling', root: '/workspace/sibling' }
    ],
    resolvedRoots: new Set([ownerRoot, targetRoot, '/workspace/sibling'])
  }
  const context = (metadata: Record<string, unknown>, hostRows: Record<string, unknown> = {}) => {
    const qualifiedRows = {
      [`local:${worktreeId}`]: metadata[worktreeId],
      ...hostRows
    }
    const backingStore = store(metadata, qualifiedRows)
    return {
      context: {
        store: backingStore,
        mainWindow: {},
        runtime: {
          acquireFileWatcherRemoval: vi.fn(async () => ({ finish: vi.fn() })),
          clearOptimisticReconcileToken: vi.fn()
        }
      },
      backingStore
    }
  }

  beforeEach(() => {
    removalMocks.removeLocalWorktreePath.mockReset().mockResolvedValue(undefined)
    removalMocks.stopPtysForDestructiveWorktreeRemoval.mockReset().mockResolvedValue(undefined)
    removalMocks.removeWorktreeMetadataAndTransientState.mockReset()
    removalMocks.notifyWorktreesChanged.mockReset()
    removalMocks.invalidateAuthorizedRootsCache.mockReset()
    removalMocks.getLocalProjectWorktreeGitOptions.mockReset().mockReturnValue({})
    removalMocks.resolveWorktreeRemovalRoute
      .mockReset()
      .mockReturnValue({ kind: 'local', hostId: 'local' })
    vi.mocked(createJjBackend).mockReset()
    vi.mocked(createJjBackend).mockReturnValue({
      listWorkspaces: vi
        .fn()
        .mockResolvedValue({ ok: true, workspaces: completeListing.workspaces }),
      detect: vi
        .fn()
        .mockResolvedValue({ ok: true, root: ownerRoot, repositoryIdentity: ownerRoot }),
      removeWorkspace: vi.fn().mockResolvedValue({ ok: true })
    } as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reads metadata for the requested host when the same worktree id exists on two hosts', async () => {
    const localMeta = {
      hostId: 'local',
      jjWorkspace: { name: 'wrong-local', root: targetRoot, rootResolved: true }
    }
    const remoteMeta = {
      hostId: 'ssh:build-box',
      jjWorkspace: { name: 'feature', root: targetRoot, rootResolved: true }
    }
    const { context: removalContext } = context(
      { [worktreeId]: localMeta },
      { [`ssh:build-box:${worktreeId}`]: remoteMeta, [`local:${worktreeId}`]: localMeta }
    )
    const remoteRepo = repo({ executionHostId: 'local' })
    const backendMock = {
      listWorkspaces: vi
        .fn()
        .mockResolvedValue({ ok: true, workspaces: completeListing.workspaces }),
      detect: vi
        .fn()
        .mockResolvedValue({ ok: true, root: ownerRoot, repositoryIdentity: ownerRoot }),
      removeWorkspace: vi.fn().mockResolvedValue({ ok: true })
    }
    vi.mocked(createJjBackend).mockReturnValue(backendMock as never)
    await expect(
      removeJjWorkspace(
        removalContext as never,
        { worktreeId, jjRemoval: 'forget' },
        remoteRepo,
        'repo-1',
        targetRoot,
        'ssh:build-box'
      )
    ).resolves.toEqual({})
    expect(backendMock.removeWorkspace).toHaveBeenCalled()
    expect(removalMocks.removeLocalWorktreePath).not.toHaveBeenCalled()
  })

  it('forwards the desktop WSL distro to listing, detection, and removal', async () => {
    removalMocks.getLocalProjectWorktreeGitOptions.mockReturnValue({ wslDistro: 'Ubuntu-22.04' })
    const backend = {
      listWorkspaces: vi
        .fn()
        .mockResolvedValue({ ok: true, workspaces: completeListing.workspaces }),
      detect: vi
        .fn()
        .mockResolvedValue({ ok: true, root: ownerRoot, repositoryIdentity: ownerRoot }),
      removeWorkspace: vi.fn().mockResolvedValue({ ok: true })
    }
    vi.mocked(createJjBackend).mockReturnValue(backend as never)
    const { context: removalContext } = context({
      [worktreeId]: { jjWorkspace: { name: 'feature', root: targetRoot, rootResolved: true } }
    })
    await removeJjWorkspace(
      removalContext as never,
      { worktreeId, jjRemoval: 'forget' },
      repo(),
      'repo-1',
      targetRoot,
      'local'
    )
    expect(removalMocks.getLocalProjectWorktreeGitOptions).toHaveBeenCalled()
    expect(backend.listWorkspaces).toHaveBeenCalledWith(
      expect.objectContaining({ wslDistro: 'Ubuntu-22.04' })
    )
    expect(backend.detect).toHaveBeenCalledWith(
      expect.objectContaining({ wslDistro: 'Ubuntu-22.04' })
    )
    expect(backend.removeWorkspace).toHaveBeenCalledWith({
      name: 'feature',
      targetRoot,
      ownerRoot
    })
  })

  it('forgets without physical deletion, while forget-and-delete deletes after forget', async () => {
    const backend = {
      listWorkspaces: vi
        .fn()
        .mockResolvedValue({ ok: true, workspaces: completeListing.workspaces }),
      detect: vi
        .fn()
        .mockResolvedValue({ ok: true, root: ownerRoot, repositoryIdentity: ownerRoot }),
      removeWorkspace: vi.fn().mockResolvedValue({ ok: true })
    }
    vi.mocked(createJjBackend).mockReturnValue(backend as never)
    const { context: forgetContext } = context({
      [worktreeId]: { jjWorkspace: { name: 'feature', root: targetRoot, rootResolved: true } }
    })
    await removeJjWorkspace(
      forgetContext as never,
      { worktreeId, jjRemoval: 'forget' },
      repo(),
      'repo-1',
      targetRoot,
      'local'
    )
    expect(removalMocks.removeLocalWorktreePath).not.toHaveBeenCalled()
    const { context: deleteContext } = context({
      [worktreeId]: { jjWorkspace: { name: 'feature', root: targetRoot, rootResolved: true } }
    })
    await removeJjWorkspace(
      deleteContext as never,
      { worktreeId, jjRemoval: 'forget-and-delete' },
      repo(),
      'repo-1',
      targetRoot,
      'local'
    )
    expect(removalMocks.removeLocalWorktreePath).toHaveBeenCalledWith(targetRoot, {})
  })

  it('retains host-qualified cleanup proof when physical deletion fails', async () => {
    removalMocks.removeLocalWorktreePath.mockRejectedValue(new Error('directory busy'))
    const backend = {
      listWorkspaces: vi
        .fn()
        .mockResolvedValue({ ok: true, workspaces: completeListing.workspaces }),
      detect: vi
        .fn()
        .mockResolvedValue({ ok: true, root: ownerRoot, repositoryIdentity: ownerRoot }),
      removeWorkspace: vi.fn().mockResolvedValue({ ok: true })
    }
    vi.mocked(createJjBackend).mockReturnValue(backend as never)
    const { context: removalContext, backingStore } = context({
      [worktreeId]: {
        instanceId: 'instance-1',
        jjWorkspace: { name: 'feature', root: targetRoot, rootResolved: true }
      }
    })
    const result = await removeJjWorkspace(
      removalContext as never,
      { worktreeId, jjRemoval: 'forget-and-delete' },
      repo(),
      'repo-1',
      targetRoot,
      'local'
    )
    expect(result).toMatchObject({
      jjCleanupPending: {
        hostId: 'local',
        worktreeId,
        instanceId: 'instance-1',
        workspaceName: 'feature',
        targetRoot,
        ownerRoot
      }
    })
    expect(backingStore.setWorktreeMetaForHost).toHaveBeenCalledWith(
      worktreeId,
      'local',
      expect.objectContaining({ jjCleanupPending: expect.anything() })
    )
    expect(removalMocks.removeWorktreeMetadataAndTransientState).not.toHaveBeenCalled()
  })

  it('does not delete or purge after forget failure or uncertain outcome', async () => {
    for (const forgotten of [
      { ok: false, kind: 'error', message: 'forget failed' },
      { ok: false, kind: 'uncertain', uncertain: true, message: 'outcome uncertain' }
    ]) {
      const backend = {
        listWorkspaces: vi
          .fn()
          .mockResolvedValue({ ok: true, workspaces: completeListing.workspaces }),
        detect: vi
          .fn()
          .mockResolvedValue({ ok: true, root: ownerRoot, repositoryIdentity: ownerRoot }),
        removeWorkspace: vi.fn().mockResolvedValue(forgotten)
      }
      vi.mocked(createJjBackend).mockReturnValue(backend as never)
      const { context: removalContext } = context({
        [worktreeId]: { jjWorkspace: { name: 'feature', root: targetRoot, rootResolved: true } }
      })
      await expect(
        removeJjWorkspace(
          removalContext as never,
          { worktreeId, jjRemoval: 'forget-and-delete' },
          repo(),
          'repo-1',
          targetRoot,
          'local'
        )
      ).rejects.toThrow()
      expect(removalMocks.removeLocalWorktreePath).not.toHaveBeenCalled()
      expect(removalMocks.removeWorktreeMetadataAndTransientState).not.toHaveBeenCalled()
    }
  })

  it('requires proof and complete revalidation for cleanup-only, without re-forgetting', async () => {
    const backend = {
      listWorkspaces: vi.fn().mockResolvedValue({
        ok: true,
        workspaces: completeListing.workspaces.filter((workspace) => workspace.root !== targetRoot)
      }),
      detect: vi
        .fn()
        .mockResolvedValue({ ok: true, root: ownerRoot, repositoryIdentity: ownerRoot }),
      removeWorkspace: vi.fn()
    }
    vi.mocked(createJjBackend).mockReturnValue(backend as never)
    const pending = {
      hostId: 'local',
      worktreeId,
      instanceId: 'instance-1',
      workspaceName: 'feature',
      targetRoot,
      ownerRoot
    }
    const { context: removalContext } = context({
      [worktreeId]: { instanceId: 'instance-1', jjCleanupPending: pending }
    })
    await removeJjWorkspace(
      removalContext as never,
      { worktreeId, jjRemoval: 'cleanup-only' },
      repo(),
      'repo-1',
      targetRoot,
      'local'
    )
    expect(backend.removeWorkspace).not.toHaveBeenCalled()
    expect(removalMocks.removeLocalWorktreePath).toHaveBeenCalledWith(targetRoot, {})
  })

  it('rejects cleanup-only when proof host, path, instance, owner, or completeness changed', async () => {
    const cases = [
      { label: 'missing proof', metadata: {}, pending: undefined, listing: completeListing },
      {
        label: 'wrong host',
        metadata: {},
        pending: {
          hostId: 'ssh:other',
          worktreeId,
          workspaceName: 'feature',
          targetRoot,
          ownerRoot
        },
        listing: completeListing
      },
      {
        label: 'wrong path',
        metadata: {},
        pending: {
          hostId: 'local',
          worktreeId,
          workspaceName: 'feature',
          targetRoot: '/workspace/other',
          ownerRoot
        },
        listing: completeListing
      },
      {
        label: 'wrong instance',
        metadata: { instanceId: 'new-instance' },
        pending: {
          hostId: 'local',
          worktreeId,
          instanceId: 'old-instance',
          workspaceName: 'feature',
          targetRoot,
          ownerRoot
        },
        listing: completeListing
      },
      {
        label: 'wrong owner',
        metadata: {},
        pending: {
          hostId: 'local',
          worktreeId,
          workspaceName: 'feature',
          targetRoot,
          ownerRoot: '/other-owner'
        },
        listing: completeListing
      },
      {
        label: 'incomplete listing',
        metadata: {},
        pending: { hostId: 'local', worktreeId, workspaceName: 'feature', targetRoot, ownerRoot },
        listing: { ok: true, workspaces: [{ name: 'feature', root: null }] }
      }
    ] as const

    for (const testCase of cases) {
      const backend = {
        listWorkspaces: vi.fn().mockResolvedValue(testCase.listing),
        detect: vi
          .fn()
          .mockResolvedValue({ ok: true, root: ownerRoot, repositoryIdentity: ownerRoot }),
        removeWorkspace: vi.fn()
      }
      vi.mocked(createJjBackend).mockReturnValue(backend as never)
      const metadata = testCase.pending
        ? { ...testCase.metadata, jjCleanupPending: testCase.pending }
        : testCase.metadata
      const { context: removalContext } = context({ [worktreeId]: metadata })
      await expect(
        removeJjWorkspace(
          removalContext as never,
          { worktreeId, jjRemoval: 'cleanup-only' },
          repo(),
          'repo-1',
          targetRoot,
          'local'
        )
      ).rejects.toThrow()
      expect(removalMocks.removeLocalWorktreePath, testCase.label).not.toHaveBeenCalled()
    }
  })

  it('rejects cleanup-only when the target has been re-registered', async () => {
    const backend = {
      listWorkspaces: vi.fn().mockResolvedValue({
        ok: true,
        workspaces: [
          { name: 'replacement', root: targetRoot },
          { name: 'default', root: ownerRoot }
        ]
      }),
      detect: vi
        .fn()
        .mockResolvedValue({ ok: true, root: ownerRoot, repositoryIdentity: ownerRoot }),
      removeWorkspace: vi.fn()
    }
    vi.mocked(createJjBackend).mockReturnValue(backend as never)
    const pending = {
      hostId: 'local',
      worktreeId,
      workspaceName: 'feature',
      targetRoot,
      ownerRoot
    }
    const { context: removalContext } = context({ [worktreeId]: { jjCleanupPending: pending } })
    await expect(
      removeJjWorkspace(
        removalContext as never,
        { worktreeId, jjRemoval: 'cleanup-only' },
        repo(),
        'repo-1',
        targetRoot,
        'local'
      )
    ).rejects.toThrow()
    expect(removalMocks.removeLocalWorktreePath).not.toHaveBeenCalled()
  })
})
