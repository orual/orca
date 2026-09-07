import { describe, expect, it } from 'vitest'
import { getRepoKind, getRepoKindLabel, isFolderRepo, isGitRepoKind, isJjRepo } from './repo-kind'
import type { Repo } from './repo-types'

function repoWithKind(kind: Repo['kind']): Pick<Repo, 'kind'> {
  return { kind }
}

describe('repository kind classification', () => {
  it('preserves Git, folder, and Jujutsu kinds while treating absent kind as legacy Git', () => {
    expect(getRepoKind(repoWithKind(undefined))).toBe('git')
    expect(getRepoKind(repoWithKind('git'))).toBe('git')
    expect(getRepoKind(repoWithKind('folder'))).toBe('folder')
    expect(getRepoKind(repoWithKind('jj'))).toBe('jj')
    expect(getRepoKind(repoWithKind('unknown' as Repo['kind']))).toBe('git')
  })

  it('round-trips a persisted Jujutsu kind without changing its discriminator', () => {
    const persisted = JSON.stringify({ id: 'repo-jj', kind: 'jj' })
    const restored = JSON.parse(persisted) as Pick<Repo, 'kind'>

    expect(getRepoKind(restored)).toBe('jj')
    expect(JSON.parse(JSON.stringify(restored))).toEqual({ id: 'repo-jj', kind: 'jj' })
  })

  it('has strict Git and Jujutsu predicates', () => {
    expect(isGitRepoKind(repoWithKind(undefined))).toBe(true)
    expect(isGitRepoKind(repoWithKind('git'))).toBe(true)
    expect(isGitRepoKind(repoWithKind('folder'))).toBe(false)
    expect(isGitRepoKind(repoWithKind('jj'))).toBe(false)

    expect(isJjRepo(repoWithKind('jj'))).toBe(true)
    expect(isJjRepo(repoWithKind(undefined))).toBe(false)
    expect(isJjRepo(repoWithKind('git'))).toBe(false)
    expect(isJjRepo(repoWithKind('folder'))).toBe(false)
  })

  it('keeps folder classification separate from Jujutsu', () => {
    expect(isFolderRepo(repoWithKind('folder'))).toBe(true)
    expect(isFolderRepo(repoWithKind('jj'))).toBe(false)
  })

  it.each([
    [undefined, 'Git'],
    ['git', 'Git'],
    ['folder', 'Folder'],
    ['jj', 'Jujutsu']
  ] as const)('uses the stable %s kind label', (kind, label) => {
    expect(getRepoKindLabel(repoWithKind(kind))).toBe(label)
  })
})
