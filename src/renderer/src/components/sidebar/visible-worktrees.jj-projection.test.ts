import { describe, expect, it } from 'vitest'
import type { DetectedWorktreeListResult, Worktree } from '../../../../shared/worktree/types'
import type { Repo } from '../../../../shared/repo-types'
import { projectSidebarWorktrees } from './visible-worktrees'

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'repo-jj::/repo/default',
    repoId: 'repo-jj',
    hostId: 'local',
    path: '/repo/default',
    displayName: 'default',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    head: '',
    branch: '',
    isBare: false,
    isMainWorktree: true,
    ...overrides
  }
}

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-jj',
    path: '/repo',
    displayName: 'jj repo',
    badgeColor: '#000000',
    addedAt: 1,
    kind: 'jj',
    ...overrides
  }
}

function detected(rows: Worktree[], overrides: Partial<DetectedWorktreeListResult> = {}) {
  return {
    repoId: 'repo-jj',
    authoritative: true,
    source: 'jj',
    worktrees: rows.map((row) => ({
      ...row,
      ownership: 'orca-managed' as const,
      selectedCheckout: row.isMainWorktree,
      visible: true
    })),
    ...overrides
  } satisfies DetectedWorktreeListResult
}

describe('projectSidebarWorktrees', () => {
  it('projects individually verified siblings from an incomplete jj catalog', () => {
    const healthy = worktree({
      jjWorkspace: { name: 'healthy', root: '/repo/default', rootResolved: true }
    })
    const missing = worktree({
      id: 'repo-jj::/missing',
      path: '/missing',
      jjWorkspace: { name: 'missing', root: '/missing', rootResolved: false }
    })
    const result = projectSidebarWorktrees(
      {},
      {
        'repo-jj': detected([healthy, missing], { authoritative: false })
      },
      [repo()]
    )
    expect(result['repo-jj']?.map((row) => row.id)).toEqual([healthy.id])
  })

  it('projects the jj owner and all visible siblings under one persisted repo without mutation', () => {
    const owner = worktree()
    const sibling = worktree({
      id: 'repo-jj::/repo/feature-o',
      path: '/repo/feature-o',
      displayName: 'feature-o',
      isMainWorktree: false,
      jjWorkspace: { name: 'feature-o', root: '/repo/feature-o', rootResolved: true }
    })
    const persisted = { 'repo-jj': [owner] }
    const result = projectSidebarWorktrees(persisted, { 'repo-jj': detected([owner, sibling]) }, [
      repo()
    ])

    expect(result['repo-jj']).toHaveLength(2)
    expect(result['repo-jj']?.map((row) => row.path)).toEqual(['/repo/default', '/repo/feature-o'])
    expect(result['repo-jj']?.[1]?.jjWorkspace?.name).toBe('feature-o')
    expect(persisted['repo-jj']).toEqual([owner])
  })

  it('keeps persisted rows authoritative and excludes hidden, non-jj, or unknown-repo detections', () => {
    const owner = worktree()
    const sibling = worktree({
      id: 'repo-jj::/repo/feature',
      path: '/repo/feature',
      isMainWorktree: false
    })
    const persisted = { 'repo-jj': [owner] }
    const hidden = detected([sibling], {
      worktrees: [{ ...sibling, visible: false, ownership: 'external', selectedCheckout: false }]
    })
    const result = projectSidebarWorktrees(
      persisted,
      {
        'repo-jj': hidden,
        'repo-git': detected(
          [worktree({ repoId: 'repo-git', id: 'repo-git::/git', path: '/git' })],
          { repoId: 'repo-git', source: 'git' }
        ),
        unknown: detected([sibling], { repoId: 'unknown' })
      },
      [repo()]
    )

    expect(result['repo-jj']).toEqual([owner])
    expect(result['repo-git']).toBeUndefined()
    expect(result.unknown).toBeUndefined()
  })
})
