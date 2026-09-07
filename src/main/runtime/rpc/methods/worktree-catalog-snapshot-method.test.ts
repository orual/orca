import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { REPO_METHODS } from './repo'
import { WORKTREE_METHODS } from './worktree'
import {
  JJ_REPO_KIND_RUNTIME_CAPABILITY,
  NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES,
  WORKTREE_VISIBILITY_SOURCE_DEFAULTS_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'

function makeRuntime() {
  return {
    getRuntimeId: () => 'test-runtime',
    getWorktreePs: vi.fn().mockResolvedValue({
      worktrees: [],
      totalCount: 0,
      truncated: false
    })
  } as unknown as OrcaRuntimeService
}

describe('worktree.ps catalog snapshots', () => {
  it('preserves the exact legacy response when no snapshot field is sent', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })
    const response = await dispatcher.dispatch({
      id: 'legacy',
      authToken: 'token',
      method: 'worktree.ps',
      params: { limit: 10_000 }
    })

    expect(response).toMatchObject({
      ok: true,
      result: { worktrees: [], totalCount: 0, truncated: false }
    })
    expect((response as { result: unknown }).result).not.toHaveProperty('snapshotId')
  })

  it('returns a full snapshot followed by a tiny unchanged response', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })
    const first = await dispatcher.dispatch({
      id: 'first',
      authToken: 'token',
      method: 'worktree.ps',
      params: { limit: 10_000, afterSnapshotId: null }
    })
    const snapshotId = (first as { result: { snapshotId: string } }).result.snapshotId

    const second = await dispatcher.dispatch({
      id: 'second',
      authToken: 'token',
      method: 'worktree.ps',
      params: { limit: 10_000, afterSnapshotId: snapshotId }
    })

    expect(snapshotId).toEqual(expect.any(String))
    expect(second).toMatchObject({
      ok: true,
      result: { unchanged: true, snapshotId }
    })
    expect(runtime.getWorktreePs).toHaveBeenCalledTimes(2)
  })

  it('hides jj rows from legacy ps clients while preserving filtered counts and pages', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      listRepos: () => [{ id: 'jj-repo', path: '/jj', kind: 'jj' }],
      getWorktreePs: vi.fn().mockResolvedValue({
        worktrees: [
          { worktreeId: 'git-1', repoId: 'git-repo', hostId: 'local' },
          { worktreeId: 'jj-1', repoId: 'jj-repo', hostId: 'ssh:box' },
          { worktreeId: 'git-2', repoId: 'git-repo', hostId: 'ssh:box' }
        ],
        totalCount: 3,
        truncated: false,
        hostScope: { hostIds: ['local', 'ssh:box'], omittedHostIds: [] }
      })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })
    const replies: string[] = []
    await dispatcher.dispatchStreaming(
      { id: 'legacy-jj', authToken: 'token', method: 'worktree.ps', params: { limit: 1 } },
      (reply) => replies.push(reply),
      { clientCapabilities: [] }
    )

    expect(JSON.parse(replies[0]!).result).toMatchObject({
      worktrees: [
        { worktreeId: 'git-1', repoId: 'git-repo' },
        { worktreeId: 'jj-1', repoId: 'jj-repo' },
        { worktreeId: 'git-2', repoId: 'git-repo' }
      ],
      totalCount: 3,
      truncated: false
    })
    expect(runtime.getWorktreePs).toHaveBeenCalledWith(1, false, {
      excludeRepoKinds: ['jj']
    })
  })

  it('passes jj rows through for capable ps clients without changing the runtime limit', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      listRepos: () => [{ id: 'jj-repo', path: '/jj', kind: 'jj' }],
      getWorktreePs: vi.fn().mockResolvedValue({ worktrees: [], totalCount: 0, truncated: false })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })
    const replies: string[] = []
    await dispatcher.dispatchStreaming(
      { id: 'current-jj', authToken: 'token', method: 'worktree.ps', params: { limit: 7 } },
      (reply) => replies.push(reply),
      { clientCapabilities: [JJ_REPO_KIND_RUNTIME_CAPABILITY] }
    )

    expect(runtime.getWorktreePs).toHaveBeenCalledWith(7, false)
    expect(JSON.parse(replies[0]!).result.worktrees).toEqual([])
  })

  it('gates managed and detected jj catalogs for legacy clients', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      listRepos: () => [{ id: 'jj-repo', path: '/jj', kind: 'jj' }],
      listManagedWorktrees: vi.fn().mockResolvedValue({
        worktrees: [
          { id: 'git-1', repoId: 'git-repo', hostId: 'local' },
          { id: 'jj-1', repoId: 'jj-repo', hostId: 'ssh:box' }
        ],
        totalCount: 2,
        truncated: false
      }),
      listDetectedManagedWorktrees: vi.fn().mockResolvedValue({
        repoId: 'jj-repo',
        authoritative: true,
        source: 'git',
        worktrees: [{ path: '/jj/worktree' }]
      })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })
    const listReplies: string[] = []
    const detectedReplies: string[] = []
    await dispatcher.dispatchStreaming(
      {
        id: 'legacy-list',
        authToken: 'token',
        method: 'worktree.list',
        params: { limit: 1 }
      },
      (reply) => listReplies.push(reply),
      { clientCapabilities: [] }
    )
    await dispatcher.dispatchStreaming(
      {
        id: 'legacy-detected',
        authToken: 'token',
        method: 'worktree.detectedList',
        params: { repo: 'id:jj-repo' }
      },
      (reply) => detectedReplies.push(reply),
      { clientCapabilities: [] }
    )

    expect(JSON.parse(listReplies[0]!).result).toMatchObject({
      worktrees: [
        { id: 'git-1', repoId: 'git-repo' },
        { id: 'jj-1', repoId: 'jj-repo' }
      ],
      totalCount: 2,
      truncated: false
    })
    expect(runtime.listManagedWorktrees).toHaveBeenCalledWith(undefined, 1, false, {
      excludeRepoKinds: ['jj']
    })
    expect(JSON.parse(detectedReplies[0]!).result.worktrees).toEqual([{ path: '/jj/worktree' }])
    expect(runtime.listDetectedManagedWorktrees).toHaveBeenCalledWith(
      'id:jj-repo',
      undefined,
      false,
      { excludeRepoKinds: ['jj'] }
    )
  })

  it('projects catalogs for the actual native client definition across jj capability skew', async () => {
    const legacyClientCapabilities = NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES.filter(
      (capability) => capability !== JJ_REPO_KIND_RUNTIME_CAPABILITY
    )
    const repos = [
      { id: 'git-repo', path: '/git', kind: 'git' as const },
      { id: 'jj-repo', path: '/jj', kind: 'jj' as const }
    ]
    const managedWorktrees = {
      worktrees: [
        { id: 'git-1', repoId: 'git-repo' },
        { id: 'jj-1', repoId: 'jj-repo' }
      ],
      totalCount: 2,
      truncated: false
    }
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      listRepos: () => repos,
      listManagedWorktrees: vi
        .fn()
        .mockImplementation((_repo, _limit, _visibility, options) =>
          Promise.resolve(
            options?.excludeRepoKinds?.includes('jj')
              ? { ...managedWorktrees, worktrees: [managedWorktrees.worktrees[0]], totalCount: 1 }
              : managedWorktrees
          )
        ),
      listDetectedManagedWorktrees: vi
        .fn()
        .mockImplementation((_repo, _connection, _visibility, options) =>
          Promise.resolve(
            options?.excludeRepoKinds?.includes('jj')
              ? {
                  repoId: 'jj-repo',
                  authoritative: false,
                  source: 'metadata-fallback',
                  worktrees: []
                }
              : {
                  repoId: 'jj-repo',
                  authoritative: true,
                  source: 'jj',
                  worktrees: [{ id: 'jj-1' }]
                }
          )
        )
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: [...REPO_METHODS, ...WORKTREE_METHODS]
    })

    const legacyRepo = await dispatcher.dispatch(
      { id: 'legacy-repo', authToken: 'token', method: 'repo.list' },
      { clientCapabilities: legacyClientCapabilities }
    )
    const capableRepo = await dispatcher.dispatch(
      { id: 'capable-repo', authToken: 'token', method: 'repo.list' },
      { clientCapabilities: NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES }
    )
    const legacyWorktrees = await dispatcher.dispatch(
      {
        id: 'legacy-worktrees',
        authToken: 'token',
        method: 'worktree.list',
        params: { limit: 10 }
      },
      { clientCapabilities: legacyClientCapabilities }
    )
    const capableWorktrees = await dispatcher.dispatch(
      {
        id: 'capable-worktrees',
        authToken: 'token',
        method: 'worktree.list',
        params: { limit: 10 }
      },
      { clientCapabilities: NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES }
    )
    const legacyDetected = await dispatcher.dispatch(
      {
        id: 'legacy-detected',
        authToken: 'token',
        method: 'worktree.detectedList',
        params: { repo: 'id:jj-repo' }
      },
      { clientCapabilities: legacyClientCapabilities }
    )

    expect(legacyRepo).toMatchObject({ ok: true, result: { repos: [{ id: 'git-repo' }] } })
    expect(capableRepo).toMatchObject({
      ok: true,
      result: { repos: [{ id: 'git-repo' }, { id: 'jj-repo', kind: 'jj' }] }
    })
    expect(legacyWorktrees).toMatchObject({
      ok: true,
      result: { worktrees: [{ id: 'git-1', repoId: 'git-repo' }], totalCount: 1, truncated: false }
    })
    expect(capableWorktrees).toMatchObject({ ok: true, result: managedWorktrees })
    expect(runtime.listManagedWorktrees).toHaveBeenNthCalledWith(1, undefined, 10, true, {
      excludeRepoKinds: ['jj']
    })
    expect(runtime.listManagedWorktrees).toHaveBeenNthCalledWith(2, undefined, 10, true)
    expect(legacyDetected).toMatchObject({
      ok: true,
      result: {
        repoId: 'jj-repo',
        authoritative: false,
        source: 'metadata-fallback',
        worktrees: []
      }
    })
    const capableDetected = await dispatcher.dispatch(
      {
        id: 'capable-detected',
        authToken: 'token',
        method: 'worktree.detectedList',
        params: { repo: 'id:jj-repo' }
      },
      { clientCapabilities: NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES }
    )
    expect(capableDetected).toMatchObject({
      ok: true,
      result: { repoId: 'jj-repo', authoritative: true, source: 'jj', worktrees: [{ id: 'jj-1' }] }
    })
    expect(runtime.listDetectedManagedWorktrees).toHaveBeenNthCalledWith(
      1,
      'id:jj-repo',
      undefined,
      true,
      { excludeRepoKinds: ['jj'] }
    )
    expect(runtime.listDetectedManagedWorktrees).toHaveBeenNthCalledWith(
      2,
      'id:jj-repo',
      undefined,
      true
    )
  })

  it('gates source-default worktree projection by client capability', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })
    await dispatcher.dispatchStreaming(
      {
        id: 'legacy',
        authToken: 'token',
        method: 'worktree.ps',
        params: { limit: 10_000 }
      },
      () => {},
      { clientCapabilities: [] }
    )
    await dispatcher.dispatchStreaming(
      {
        id: 'current',
        authToken: 'token',
        method: 'worktree.ps',
        params: { limit: 10_000 }
      },
      () => {},
      { clientCapabilities: [WORKTREE_VISIBILITY_SOURCE_DEFAULTS_RUNTIME_CAPABILITY] }
    )
    await dispatcher.dispatchStreaming(
      {
        id: 'mobile',
        authToken: 'token',
        method: 'worktree.ps',
        params: { limit: 10_000, supportsWorktreeVisibilitySourceDefaults: true }
      },
      () => {},
      { clientCapabilities: [] }
    )

    expect(runtime.getWorktreePs).toHaveBeenNthCalledWith(1, 10_000, false, {
      excludeRepoKinds: ['jj']
    })
    expect(runtime.getWorktreePs).toHaveBeenNthCalledWith(2, 10_000, true, {
      excludeRepoKinds: ['jj']
    })
    expect(runtime.getWorktreePs).toHaveBeenNthCalledWith(3, 10_000, true, {
      excludeRepoKinds: ['jj']
    })
  })
})
