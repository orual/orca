import { describe, expect, it } from 'vitest'
import { JJ_REPO_KIND_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import { projectJjReposForClient, jjListingOptionsForClient } from './repo-jj-projection'

const legacy = { clientCapabilities: [] }
const capable = { clientCapabilities: [JJ_REPO_KIND_RUNTIME_CAPABILITY] }

const repos = [
  {
    id: 'git-repo',
    path: '/git',
    displayName: 'Git repo',
    badgeColor: '#000000',
    addedAt: 1,
    kind: 'git' as const
  },
  {
    id: 'jj-repo',
    path: '/jj',
    displayName: 'jj repo',
    badgeColor: '#000000',
    addedAt: 2,
    kind: 'jj' as const
  }
]

describe('jj repository publication projection', () => {
  it('hides jj repositories from legacy repo catalogs', () => {
    expect(projectJjReposForClient(repos, legacy)).toEqual([repos[0]])
    expect(projectJjReposForClient(repos, capable)).toEqual(repos)
  })

  it('returns an internal pre-pagination exclusion for legacy callers', () => {
    expect(jjListingOptionsForClient(legacy)).toEqual({ excludeRepoKinds: ['jj'] })
    expect(jjListingOptionsForClient(capable)).toBeUndefined()
  })
})
