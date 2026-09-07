import type { Repo, RepoKind } from './repo-types'

export function getRepoKind(repo: Pick<Repo, 'kind'>): RepoKind {
  if (repo.kind === 'folder' || repo.kind === 'jj') {
    return repo.kind
  }
  // Missing kind is the legacy Git representation; malformed values fail closed to Git too.
  return 'git'
}

export function isFolderRepo(repo: Pick<Repo, 'kind'>): boolean {
  return getRepoKind(repo) === 'folder'
}

export function isGitRepoKind(repo: Pick<Repo, 'kind'>): boolean {
  return getRepoKind(repo) === 'git'
}

export function isJjRepo(repo: Pick<Repo, 'kind'>): boolean {
  return getRepoKind(repo) === 'jj'
}

export function getRepoKindLabel(repo: Pick<Repo, 'kind'>): string {
  switch (getRepoKind(repo)) {
    case 'folder':
      return 'Folder'
    case 'jj':
      return 'Jujutsu'
    case 'git':
      return 'Git'
  }
}
