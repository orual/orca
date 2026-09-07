import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import { getDefaultRepoHookSettings } from '../../../shared/constants'
import { hydrateRepo, repoGitUsernameCacheKey } from './repo-hydration'

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/workspace/repo',
    displayName: 'repo',
    badgeColor: '#000',
    addedAt: 1,
    ...overrides
  }
}

describe('hydrateRepo', () => {
  it.each([
    ['git', 'git', 'cached-user'],
    [undefined, 'git', 'cached-user'],
    ['folder', 'folder', ''],
    ['jj', 'jj', '']
  ] as const)('normalizes %s to %s and applies username only for Git', (input, kind, username) => {
    const repo = makeRepo({ kind, gitUsername: 'persisted-user' })
    const cache = new Map([[repoGitUsernameCacheKey(repo), 'cached-user']])

    expect(
      hydrateRepo(input === undefined ? { ...repo, kind: undefined } : repo, cache)
    ).toMatchObject({
      kind,
      gitUsername: username,
      hookSettings: getDefaultRepoHookSettings()
    })
  })

  it('preserves a Jujutsu repo through a persistence-style JSON round trip', () => {
    const original = makeRepo({ kind: 'jj', gitUsername: 'should-not-survive' })
    const restored = JSON.parse(JSON.stringify(original)) as Repo
    const hydrated = hydrateRepo(
      restored,
      new Map([[repoGitUsernameCacheKey(restored), 'cached-user']])
    )

    expect(hydrated.kind).toBe('jj')
    expect(hydrated.gitUsername).toBe('')
    expect(JSON.parse(JSON.stringify({ kind: hydrated.kind }))).toEqual({ kind: 'jj' })
  })

  it('does not consult or apply the Git username cache for Jujutsu', () => {
    const repo = makeRepo({ kind: 'jj' })
    const cache = new Map<string, string>()
    const cacheKey = repoGitUsernameCacheKey(repo)
    cache.set(cacheKey, 'cached-user')

    const hydrated = hydrateRepo(repo, cache)

    expect(hydrated.gitUsername).toBe('')
    expect(hydrated.kind).toBe('jj')
  })
})
