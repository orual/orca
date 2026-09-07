import { getRepoExecutionHostId } from '../shared/execution-host'
import { isGitRepoKind } from '../shared/repo-kind'
import type { Repo } from '../shared/repo-types'
import { resolveLocalGitUsernameDetailed } from './git/git-username'

type RepoUsernameStore = {
  getRepos(): Repo[]
  // Why the repo and not its id: duplicate repo ids across execution hosts make an id-only write ambiguous.
  setResolvedRepoGitUsername(
    target: Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>,
    username: string
  ): boolean
}

type EnrichmentOptions = {
  onChanged?: () => void
}

// Why: resolution spawns git (and possibly gh) subprocesses, so run it at most
// once per repo location per app session — hydrateRepo serves the persisted
// value in between, and a relaunch picks up config changes.
const attemptedLocations = new Set<string>()
const locationGenerationByLocation = new Map<string, number>()
let enrichmentInFlight: Promise<void> | null = null
let rerunRequested = false

// Why the execution host and not connectionId: a runtime repo has no connectionId, so a
// connectionId-only key collides with a local repo at the same path and blocks one of them for the session.
function getRepoLocationKey(repo: Pick<Repo, 'path' | 'connectionId' | 'executionHostId'>): string {
  return `${getRepoExecutionHostId(repo)}\0${repo.path}`
}

function getCurrentGitRepo(store: RepoUsernameStore, snapshot: Repo): Repo | undefined {
  return store
    .getRepos()
    .find(
      (repo) =>
        isGitRepoKind(repo) &&
        repo.id === snapshot.id &&
        repo.path === snapshot.path &&
        getRepoExecutionHostId(repo) === getRepoExecutionHostId(snapshot)
    )
}

function retireNonGitLocations(allRepos: Repo[]): void {
  const liveGitLocations = new Set(allRepos.filter(isGitRepoKind).map(getRepoLocationKey))
  for (const locationKey of attemptedLocations) {
    if (!liveGitLocations.has(locationKey)) {
      attemptedLocations.delete(locationKey)
      locationGenerationByLocation.set(
        locationKey,
        (locationGenerationByLocation.get(locationKey) ?? 0) + 1
      )
    }
  }
}

async function enrichRepoGitUsernamesInBackground(
  store: RepoUsernameStore,
  options: EnrichmentOptions
): Promise<void> {
  const candidates = store.getRepos().filter(
    (repo) =>
      isGitRepoKind(repo) &&
      // Why: SSH repo paths are remote; local git cannot inspect them. The
      // SSH username path (getSshGitUsername) stays caller-driven.
      !repo.connectionId &&
      !attemptedLocations.has(getRepoLocationKey(repo))
  )
  let changed = false
  for (const repo of candidates) {
    const locationKey = getRepoLocationKey(repo)
    if (!getCurrentGitRepo(store, repo)) {
      continue
    }
    attemptedLocations.add(locationKey)
    const generation = locationGenerationByLocation.get(locationKey) ?? 0
    const { username, authoritative } = await resolveLocalGitUsernameDetailed(repo.path)
    if (
      !getCurrentGitRepo(store, repo) ||
      (locationGenerationByLocation.get(locationKey) ?? 0) !== generation
    ) {
      continue
    }
    // Why: a non-authoritative '' means a probe timed out and says nothing
    // about the account — keep the persisted value. An authoritative result
    // (including '') is the current truth: it must also CLEAR a stale
    // persisted username after the user removes github.user or logs out.
    if (!authoritative && !username) {
      continue
    }
    if (store.setResolvedRepoGitUsername(repo, username)) {
      changed = true
    }
  }
  if (changed) {
    options.onChanged?.()
  }
}

/**
 * Resolve git usernames for repos that haven't been probed this session, off
 * the caller's critical path. Fire-and-forget by design: repos:list must stay
 * subprocess-free (issue #7225 — a stuck sync probe froze startup for minutes).
 */
export function enrichRepoGitUsernames(
  store: RepoUsernameStore,
  options: EnrichmentOptions = {}
): void {
  retireNonGitLocations(store.getRepos())
  if (enrichmentInFlight) {
    // Why: a repo added mid-pass would otherwise be dropped until some later
    // repos:list happens to fire — queue one follow-up pass instead.
    rerunRequested = true
    return
  }
  enrichmentInFlight = enrichRepoGitUsernamesInBackground(store, options)
    .catch((error: unknown) => {
      console.error('[repo-username] Failed to enrich git usernames:', error)
    })
    .finally(() => {
      enrichmentInFlight = null
      if (rerunRequested) {
        rerunRequested = false
        enrichRepoGitUsernames(store, options)
      }
    })
}

export async function flushRepoGitUsernameEnrichmentForTests(): Promise<void> {
  // A queued rerun replaces enrichmentInFlight when the first pass settles.
  while (enrichmentInFlight) {
    await enrichmentInFlight
  }
}

export function resetRepoGitUsernameEnrichmentForTests(): void {
  attemptedLocations.clear()
  locationGenerationByLocation.clear()
  enrichmentInFlight = null
  rerunRequested = false
}
