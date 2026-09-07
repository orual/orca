import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { RuntimeManagedWorktreeQueries } from './runtime-managed-worktree-queries'
import type { RuntimeStore } from './runtime-store-contract'

const settings = {
  workspaceDir: '/worktrees',
  nestWorkspaces: true,
  refreshLocalBaseRefOnWorktreeCreate: false,
  branchPrefix: 'none',
  branchPrefixCustom: ''
}

function folderRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/workspace/app',
    displayName: 'Local app',
    badgeColor: '#000000',
    addedAt: 1,
    kind: 'folder',
    ...overrides
  }
}

function metadata(overrides: Partial<WorktreeMeta> = {}): WorktreeMeta {
  return {
    displayName: '',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function queries(
  store: RuntimeStore,
  listResolved: () => Promise<ResolvedWorktree[]> = async () => []
): RuntimeManagedWorktreeQueries {
  return new RuntimeManagedWorktreeQueries({
    getStore: () => store,
    listResolved,
    resolveRepo: async () => store.getRepos()[0]!,
    selectRepos: () => store.getRepos(),
    scanRepo: async () => ({ ok: true, worktrees: [] }),
    listKnownHostIds: () => []
  })
}

describe('RuntimeManagedWorktreeQueries.list', () => {
  it('excludes jj rows before host-balanced pagination and count calculation', async () => {
    const gitRepo = folderRepo({ id: 'git-repo', kind: 'git' })
    const jjRepo = folderRepo({ id: 'jj-repo', kind: 'jj' })
    const makeResolved = (repoId: string, id: string, hostId: 'local' | 'ssh:box') =>
      ({
        id,
        repoId,
        path: `/${repoId}/${id}`,
        hostId,
        git: { path: `/${repoId}/${id}` }
      }) as unknown as ResolvedWorktree
    const resolved = [
      makeResolved('jj-repo', 'jj-1', 'ssh:box'),
      makeResolved('git-repo', 'git-1', 'local'),
      makeResolved('git-repo', 'git-2', 'ssh:box')
    ]
    const store = {
      getRepos: () => [gitRepo, jjRepo],
      getRepo: (repoId: string) => [gitRepo, jjRepo].find((repo) => repo.id === repoId),
      getWorktreeMeta: () => undefined,
      getSettings: () => settings
    } as unknown as RuntimeStore
    const result = await queries(store, async () => resolved).list(undefined, 1, true, {
      excludeRepoKinds: ['jj']
    })

    expect(result.worktrees.map((worktree) => worktree.id)).toEqual(['git-1'])
    expect(result.totalCount).toBe(2)
    expect(result.truncated).toBe(true)
    expect(result.hostScope).toEqual({ hostIds: ['local'], omittedHostIds: ['ssh:box'] })
  })
})

describe('RuntimeManagedWorktreeQueries.listDetected', () => {
  it("does not project another host's folder metadata", async () => {
    const local = folderRepo()
    const remote = folderRepo({ connectionId: 'build-box', displayName: 'Remote app' })
    const rootId = `${local.id}::${local.path}`
    const foreignMeta = metadata({ displayName: 'Wrong host', hostId: 'ssh:build-box' })
    const store = {
      getRepos: () => [local, remote],
      getRepo: () => local,
      getAllWorktreeMeta: () => ({ [rootId]: foreignMeta }),
      getWorktreeMeta: () => foreignMeta,
      setWorktreeMeta: vi.fn(),
      getAllWorktreeLineage: () => ({}),
      getSettings: () => settings
    } as unknown as RuntimeStore

    const result = await queries(store).listDetected(local)

    expect(result.worktrees).toHaveLength(1)
    expect(result.worktrees[0]).toMatchObject({
      id: rootId,
      hostId: 'local',
      displayName: 'Local app'
    })
  })

  it('returns a non-authoritative fallback for an excluded jj repository', async () => {
    const repo = folderRepo({ id: 'jj-repo', kind: 'jj' })
    const storedId = `${repo.id}::${repo.path}/feature`
    const metadataById = { [storedId]: metadata({ displayName: 'Feature' }) }
    const store = {
      getRepos: () => [repo],
      getSettings: () => settings,
      getAllWorktreeMeta: () => metadataById,
      getWorktreeMeta: (id: string) => metadataById[id]
    } as unknown as RuntimeStore

    const result = await queries(store).listDetected(repo, true, { excludeRepoKinds: ['jj'] })

    expect(result).toEqual({
      repoId: repo.id,
      authoritative: false,
      source: 'metadata-fallback',
      worktrees: []
    })
    expect(metadataById[storedId]).toBeDefined()
  })

  it('suppresses retired names for an excluded repository kind', async () => {
    const repo = folderRepo({ id: 'jj-repo', kind: 'jj' })
    const store = {
      getRepos: () => [repo],
      getSettings: () => settings,
      getRetiredWorktreeNameRegistry: vi.fn(),
      mergeRetiredWorktreeNames: vi.fn()
    } as unknown as RuntimeStore

    await expect(
      queries(store).listRetiredNames('id:jj-repo', { excludeRepoKinds: ['jj'] })
    ).resolves.toEqual({ retiredNamesByRepo: {}, retiredNameTiersByRepo: {} })
    expect(store.getRetiredWorktreeNameRegistry).not.toHaveBeenCalled()
  })

  it('omits host-owned source defaults for clients that do not support them', async () => {
    const repo = folderRepo({ path: '/source/app' })
    const store = {
      getRepos: () => [repo],
      getRepo: () => repo,
      getAllWorktreeMeta: () => ({}),
      getWorktreeMeta: () => undefined,
      setWorktreeMeta: vi.fn((_id, updates) => metadata(updates)),
      getAllWorktreeLineage: () => ({}),
      getSettings: () => ({
        ...settings,
        worktreeVisibilityDefaults: {
          external: 'show' as const,
          customSources: [{ id: 'host-source', rootPath: '/source' }],
          sourcePreferences: { custom: { 'host-source': 'show' as const } }
        }
      })
    } as unknown as RuntimeStore

    const current = await queries(store).listDetected(repo, true)
    const legacy = await queries(store).listDetected(repo, false)

    expect(current.worktrees[0]).toMatchObject({
      visibilitySource: { kind: 'custom', id: 'host-source' }
    })
    expect(legacy.worktrees[0]).not.toHaveProperty('visibilitySource')
  })
})
