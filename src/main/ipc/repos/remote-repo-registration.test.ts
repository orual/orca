// Registration is now the runtime's SSH path too (`projectHostSetup.setupExistingFolder --host
// ssh:*`), so what it stamps decides what every downstream host resolver can read. It minted
// `connectionId`-only rows, leaving the unified spelling permanently empty, and deduped by raw
// `connectionId`, which cannot see a row stamped `executionHostId: 'ssh:*'`.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'

const getSshGitProviderMock = vi.hoisted(() => vi.fn())
const getSshFilesystemProviderMock = vi.hoisted(() => vi.fn())
const getSshJjProviderMock = vi.hoisted(() => vi.fn())
vi.mock('../../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: getSshGitProviderMock
}))
vi.mock('../../providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: getSshFilesystemProviderMock
}))
vi.mock('../../providers/ssh-jj-dispatch', () => ({
  getSshJjProvider: getSshJjProviderMock
}))

vi.mock('../../repo-icon-autodetect', () => ({
  detectRepoIconAndUpstream: vi.fn(async () => ({}))
}))

vi.mock('../../ssh/ssh-target-registry', () => ({
  getActiveMultiplexer: vi.fn(() => null)
}))

vi.mock('./remote-home-path', () => ({
  resolveRemoteHomePath: vi.fn(async (_connectionId: string, path: string) => path)
}))

import { addRemoteRepoFromPath } from './remote-repo-registration'

function makeStore(repos: Repo[]) {
  return {
    getRepos: () => repos,
    getSshTarget: () => undefined,
    addRepo: (repo: Repo) => {
      repos.push(repo)
    }
  }
}

describe('addRemoteRepoFromPath', () => {
  beforeEach(() => {
    getSshGitProviderMock.mockReset()
    getSshFilesystemProviderMock.mockReset()
    getSshJjProviderMock.mockReset()
    getSshGitProviderMock.mockReturnValue({
      isGitRepoAsync: vi.fn(async () => ({ isRepo: true, rootPath: '/srv/app' }))
    })
    getSshFilesystemProviderMock.mockReturnValue({
      stat: vi.fn(async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      })
    })
    getSshJjProviderMock.mockReturnValue(undefined)
  })

  it('stamps the unified execution-host spelling alongside the legacy connection id', async () => {
    const repos: Repo[] = []
    const result = await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'm4air',
      remotePath: '/srv/app'
    })

    expect('error' in result).toBe(false)
    const repo = (result as { repo: Repo }).repo
    expect(repo.connectionId).toBe('m4air')
    expect(repo.executionHostId).toBe('ssh:m4air')
  })

  it('dedupes against a row that names the host in the unified spelling only', async () => {
    const existing = {
      id: 'existing',
      path: '/srv/app',
      displayName: 'app',
      badgeColor: '#000',
      addedAt: 0,
      executionHostId: 'ssh:m4air'
    } as Repo
    const repos: Repo[] = [existing]

    const result = await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'm4air',
      remotePath: '/srv/app'
    })

    expect(result).toEqual({ repo: existing, alreadyExisted: true })
    expect(repos).toHaveLength(1)
  })

  it('does not dedupe onto a row on a different SSH host at the same path', async () => {
    // Two hosts can both hold /srv/app. Matching on path alone registers one host's repo as the
    // other's — the mirror image of the id-only lookup this change removes.
    const repos: Repo[] = [
      {
        id: 'openclaw-row',
        path: '/srv/app',
        displayName: 'app',
        badgeColor: '#000',
        addedAt: 0,
        connectionId: 'openclaw'
      } as Repo
    ]

    const result = await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'm4air',
      remotePath: '/srv/app'
    })

    expect((result as { alreadyExisted: boolean }).alreadyExisted).toBe(false)
    expect((result as { repo: Repo }).repo.executionHostId).toBe('ssh:m4air')
    expect(repos).toHaveLength(2)
  })

  it('does not dedupe onto a local row that carries a stale connection id', async () => {
    // The pullfrog case: a row declaring itself local must not answer as an SSH host.
    const repos: Repo[] = [
      {
        id: 'local-row',
        path: '/srv/app',
        displayName: 'app',
        badgeColor: '#000',
        addedAt: 0,
        executionHostId: 'local',
        connectionId: 'develop'
      } as Repo
    ]

    const result = await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'develop',
      remotePath: '/srv/app'
    })

    expect((result as { alreadyExisted: boolean }).alreadyExisted).toBe(false)
    expect(repos).toHaveLength(2)
  })

  it('collapses remote jj imports with the same backing identity across paths and reimports', async () => {
    const repos: Repo[] = []
    const detect = vi.fn(async (path: string) => ({
      ok: true as const,
      version: '0.44.0',
      major: 0,
      minor: 44,
      patch: 0,
      root: path,
      colocated: false,
      repositoryIdentity: '/srv/backing/project/.git'
    }))
    getSshJjProviderMock.mockReturnValue({ detect })

    const first = await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'm4air',
      remotePath: '/srv/worktrees/first',
      kind: 'jj'
    })
    const second = await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'm4air',
      remotePath: '/srv/worktrees/second',
      kind: 'jj'
    })

    expect(first).toMatchObject({ alreadyExisted: false, repo: { kind: 'jj' } })
    expect(second).toEqual({ repo: (first as { repo: Repo }).repo, alreadyExisted: true })
    expect(repos).toHaveLength(1)
    expect(detect).toHaveBeenCalledWith('/srv/worktrees/first')
    expect(detect).toHaveBeenCalledWith('/srv/worktrees/second')
  })

  it('keeps distinct remote jj identities separate', async () => {
    const repos: Repo[] = []
    getSshJjProviderMock.mockReturnValue({
      detect: vi.fn(async (path: string) => ({
        ok: true as const,
        version: '0.44.0',
        major: 0,
        minor: 44,
        patch: 0,
        root: path,
        colocated: false,
        repositoryIdentity: path.endsWith('first')
          ? '/srv/backing/first/.git'
          : '/srv/backing/second/.git'
      }))
    })

    await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'm4air',
      remotePath: '/srv/worktrees/first',
      kind: 'jj'
    })
    await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'm4air',
      remotePath: '/srv/worktrees/second',
      kind: 'jj'
    })

    expect(repos).toHaveLength(2)
  })

  it('uses a renamed jj owner root proved by its directory marker, not workspace name', async () => {
    const repos: Repo[] = []
    const detect = vi.fn(async (path: string) => ({
      ok: true as const,
      version: '0.44.0',
      major: 0,
      minor: 44,
      patch: 0,
      root: path,
      colocated: false,
      repositoryIdentity: '/srv/backing/project/.git'
    }))
    getSshJjProviderMock.mockReturnValue({
      detect,
      listWorkspaces: vi.fn(async () => ({
        ok: true as const,
        workspaces: [
          { name: 'linked-first', root: '/srv/worktrees/first' },
          { name: 'renamed-owner', root: '/srv/owner' }
        ]
      }))
    })
    getSshFilesystemProviderMock.mockReturnValue({
      stat: vi.fn(async (path: string) => {
        if (path === '/srv/owner/.jj/repo') {
          return { type: 'directory', size: 0, mtime: 0 }
        }
        throw Object.assign(new Error('linked marker'), { code: 'ENOENT' })
      })
    })

    const result = await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'm4air',
      remotePath: '/srv/worktrees/first',
      kind: 'jj'
    })

    expect(result).toMatchObject({
      alreadyExisted: false,
      repo: { path: '/srv/owner', kind: 'jj' }
    })
    expect(detect).toHaveBeenCalledWith('/srv/worktrees/first')
  })

  it('does not merge a remote jj identity from another SSH host or local storage', async () => {
    const otherHost = {
      id: 'other-host',
      path: '/srv/old',
      displayName: 'old',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'jj',
      executionHostId: 'ssh:other'
    } as Repo
    const local = {
      id: 'local',
      path: '/srv/local',
      displayName: 'local',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'jj',
      executionHostId: 'local'
    } as Repo
    const repos: Repo[] = [otherHost, local]
    const detect = vi.fn(async (path: string) => ({
      ok: true as const,
      version: '0.44.0',
      major: 0,
      minor: 44,
      patch: 0,
      root: path,
      colocated: false,
      repositoryIdentity: '/srv/backing/shared/.git'
    }))
    getSshJjProviderMock.mockReturnValue({ detect })

    const result = await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'm4air',
      remotePath: '/srv/worktrees/new',
      kind: 'jj'
    })

    expect(result).toMatchObject({ alreadyExisted: false, repo: { executionHostId: 'ssh:m4air' } })
    expect(repos).toHaveLength(3)
    expect(detect).toHaveBeenCalledTimes(1)
  })

  it('does not merge when an existing remote jj identity is unavailable', async () => {
    const existing = {
      id: 'existing',
      path: '/srv/old',
      displayName: 'old',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'jj',
      executionHostId: 'ssh:m4air'
    } as Repo
    const repos: Repo[] = [existing]
    getSshJjProviderMock.mockReturnValue({
      detect: vi.fn(async (path: string) =>
        path === '/srv/worktrees/new'
          ? {
              ok: true as const,
              version: '0.44.0',
              major: 0,
              minor: 44,
              patch: 0,
              root: path,
              colocated: false,
              repositoryIdentity: '/srv/backing/shared/.git'
            }
          : { ok: false as const, kind: 'unavailable' as const, message: 'connection lost' }
      )
    })

    const result = await addRemoteRepoFromPath(makeStore(repos) as never, {
      connectionId: 'm4air',
      remotePath: '/srv/worktrees/new',
      kind: 'jj'
    })

    expect(result).toMatchObject({ alreadyExisted: false })
    expect(repos).toHaveLength(2)
  })
})
