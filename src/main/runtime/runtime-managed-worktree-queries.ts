import type { DetectedWorktreeListResult, Worktree } from '../../shared/worktree/types'
import type { Repo, RepoKind } from '../../shared/repo-types'
import { getRepoKind } from '../../shared/repo-kind'
import type { RuntimeWorktreeListResult } from '../../shared/runtime-types'
import type { ExecutionHostId } from '../../shared/execution-host'
import { buildWorktreeListingPage } from './worktree-listing-host-scope'
import { getLocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import type { Store } from '../persistence'
import type { RuntimeStore } from './runtime-store-contract'
import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { NativeLocalWorktreeMetadataScanExpectation } from '../persistence/tracking-repos/missing-local-worktree-metadata-pruning'
import type { WorktreeVisibilitySourceMatcher } from '../../shared/worktree/visibility-sources'
import { getRetiredNameRegistryForRepo } from '../worktree-name-retirement'
import { listDetectedManagedWorktrees } from './runtime-managed-worktree-detected-listing'
import {
  buildKnownOrcaWorkspaceLayouts,
  isLegacyRepoForExternalWorktreeVisibility,
  toDetectedWorktree
} from '../../shared/worktree/ownership'
import {
  createWorktreeVisibilitySourceMatcher,
  resolveCustomWorktreeVisibilitySources
} from '../../shared/worktree/visibility-sources'
import { resolveConfiguredWorktreeBasePaths } from '../../shared/worktree/configured-worktree-base-path'

export type RuntimeWorktreeListingOptions = {
  /** Internal caller projection; never populated from RPC params or persisted state. */
  excludeRepoKinds?: readonly RepoKind[]
}

type Dependencies = {
  getStore(): RuntimeStore | null
  listResolved(): Promise<ResolvedWorktree[]>
  resolveRepo(selector: string): Promise<Repo>
  selectRepos(selector: string): Repo[]
  scanRepo(repo: Repo): Promise<RuntimeWorktreeScanResult>
  /** Hosts this runtime has repos or workspaces on, so a host with no rows is still named. */
  listKnownHostIds(): Iterable<ExecutionHostId>
}

/**
 * The destructive scan expectation for one repo, or undefined when this repo must not carry one.
 *
 * WSL-routed repos are excluded for the same reason the desktop listing excludes them: the listing
 * runs in the distro and reports Linux paths while metadata can hold UNC ones, and v1 cannot prove
 * those aliases equivalent. A runtime that needs repair throws rather than resolving routing, which
 * is likewise no basis for deleting rows.
 */
function captureLocalMetadataPruneExpectation(
  store: RuntimeStore,
  repo: Repo
): NativeLocalWorktreeMetadataScanExpectation | undefined {
  if (typeof store.captureNativeLocalWorktreeMetadataScanExpectation !== 'function') {
    return undefined
  }
  try {
    if (getLocalProjectWorktreeGitOptions(store as unknown as Store, repo).wslDistro) {
      return undefined
    }
  } catch {
    return undefined
  }
  return store.captureNativeLocalWorktreeMetadataScanExpectation(repo)
}

export class RuntimeManagedWorktreeQueries {
  constructor(private readonly deps: Dependencies) {}

  async list(
    repoSelector: string | undefined,
    limit: number,
    sourceDefaultsSupported = true,
    options?: RuntimeWorktreeListingOptions
  ): Promise<RuntimeWorktreeListResult> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('invalid_limit')
    }
    const resolved = await this.deps.listResolved()
    const repoId = repoSelector ? (await this.deps.resolveRepo(repoSelector)).id : null
    const excludedKinds = new Set(options?.excludeRepoKinds ?? [])
    const reposById = new Map(
      (this.deps.getStore()?.getRepos() ?? []).map((repo) => [repo.id, repo])
    )
    const visibleResolved = resolved.filter(
      (worktree) => !excludedKinds.has(getRepoKind(reposById.get(worktree.repoId) ?? {}))
    )
    const pathsByRepo = new Map<string, string[]>()
    for (const worktree of visibleResolved) {
      const paths = pathsByRepo.get(worktree.repoId) ?? []
      paths.push(worktree.path)
      pathsByRepo.set(worktree.repoId, paths)
    }
    const visibilityDefaults = this.visibilityDefaults(sourceDefaultsSupported)
    const matchers = new Map(
      (this.deps.getStore()?.getRepos() ?? []).map((repo) => [
        repo.id,
        createWorktreeVisibilitySourceMatcher(
          [repo.path, ...(pathsByRepo.get(repo.id) ?? [])],
          resolveCustomWorktreeVisibilitySources(repo, visibilityDefaults),
          resolveConfiguredWorktreeBasePaths(repo)
        )
      ])
    )
    const worktrees = visibleResolved.filter(
      (worktree) =>
        (!repoId || worktree.repoId === repoId) &&
        this.isVisible(worktree, matchers.get(worktree.repoId), sourceDefaultsSupported)
    )
    // Why: a `--repo` listing was scoped by the caller, so naming every configured host as
    // omitted would report a gap the caller deliberately excluded.
    return buildWorktreeListingPage(worktrees, limit, repoId ? [] : this.deps.listKnownHostIds())
  }

  resolveRepoForConnection(selector: string, connectionId?: string | null): Promise<Repo> {
    if (connectionId === undefined) {
      return this.deps.resolveRepo(selector)
    }
    const wanted = connectionId?.trim() || null
    const matches = this.deps
      .selectRepos(selector)
      .filter((repo) => (repo.connectionId?.trim() || null) === wanted)
    if (matches.length !== 1) {
      throw new Error(matches.length > 1 ? 'selector_ambiguous' : 'repo_not_found')
    }
    return Promise.resolve(matches[0])
  }

  async listDetected(
    repo: Repo,
    sourceDefaultsSupported = true,
    options?: RuntimeWorktreeListingOptions
  ): Promise<DetectedWorktreeListResult> {
    if (options?.excludeRepoKinds?.includes(getRepoKind(repo))) {
      return { repoId: repo.id, authoritative: false, source: 'metadata-fallback', worktrees: [] }
    }
    return listDetectedManagedWorktrees(
      {
        getStore: this.deps.getStore,
        scanRepo: this.deps.scanRepo,
        captureLocalMetadataPruneExpectation,
        visibilityDefaults: (supported, settings) => this.visibilityDefaults(supported, settings),
        toDetected: (targetRepo, worktree, matcher, supported, settings, meta) =>
          this.toDetected(targetRepo, worktree, matcher, supported, settings, meta)
      },
      repo,
      sourceDefaultsSupported
    )
  }

  isVisible(
    worktree: Worktree,
    matcher?: WorktreeVisibilitySourceMatcher,
    sourceDefaultsSupported = true,
    providedSettings?: ReturnType<RuntimeStore['getSettings']>
  ): boolean {
    const repo = this.deps.getStore()?.getRepo(worktree.repoId)
    return repo
      ? this.toDetected(repo, worktree, matcher, sourceDefaultsSupported, providedSettings).visible
      : true
  }

  buildVisibilityMatchers(
    worktrees: readonly Worktree[],
    sourceDefaultsSupported = true,
    providedSettings?: ReturnType<RuntimeStore['getSettings']>
  ): Map<string, WorktreeVisibilitySourceMatcher> {
    const checkoutPathsByRepoId = new Map<string, string[]>()
    for (const worktree of worktrees) {
      const checkoutPaths = checkoutPathsByRepoId.get(worktree.repoId) ?? []
      checkoutPaths.push(worktree.path)
      checkoutPathsByRepoId.set(worktree.repoId, checkoutPaths)
    }
    const visibilityDefaults = this.visibilityDefaults(sourceDefaultsSupported, providedSettings)
    return new Map(
      (this.deps.getStore()?.getRepos() ?? [])
        .filter((repo) => checkoutPathsByRepoId.has(repo.id))
        .map((repo) => [
          repo.id,
          createWorktreeVisibilitySourceMatcher(
            [repo.path, ...(checkoutPathsByRepoId.get(repo.id) ?? [])],
            resolveCustomWorktreeVisibilitySources(repo, visibilityDefaults),
            resolveConfiguredWorktreeBasePaths(repo)
          )
        ])
    )
  }

  private toDetected(
    repo: Repo,
    worktree: Worktree,
    matcher?: WorktreeVisibilitySourceMatcher,
    sourceDefaultsSupported = true,
    providedSettings?: ReturnType<RuntimeStore['getSettings']>,
    providedMeta?: WorktreeMeta | null
  ) {
    const store = this.deps.getStore()
    const settings = providedSettings ?? store?.getSettings()
    if (!settings) {
      return {
        ...worktree,
        ownership: 'unknown-legacy' as const,
        selectedCheckout: false,
        visible: true
      }
    }
    const visibilityDefaults = this.visibilityDefaults(sourceDefaultsSupported, settings)
    return toDetectedWorktree({
      repo,
      worktree,
      meta:
        providedMeta === undefined
          ? store?.getWorktreeMeta(worktree.id)
          : (providedMeta ?? undefined),
      settings: { ...settings, worktreeVisibilityDefaults: visibilityDefaults },
      knownOrcaLayouts: buildKnownOrcaWorkspaceLayouts(settings, repo),
      isLegacyRepoForVisibility: isLegacyRepoForExternalWorktreeVisibility(repo),
      worktreeVisibilitySourceMatcher: matcher
    })
  }

  async listRetiredNames(
    repoSelector: string,
    options?: RuntimeWorktreeListingOptions
  ): Promise<{
    retiredNamesByRepo: Record<string, readonly string[]>
    retiredNameTiersByRepo: Record<string, number>
  }> {
    const store = this.deps.getStore()
    if (!store?.getRetiredWorktreeNameRegistry || !store.mergeRetiredWorktreeNames) {
      return { retiredNamesByRepo: {}, retiredNameTiersByRepo: {} }
    }
    const repo = await this.deps.resolveRepo(repoSelector)
    if (options?.excludeRepoKinds?.includes(getRepoKind(repo))) {
      return { retiredNamesByRepo: {}, retiredNameTiersByRepo: {} }
    }
    const settings = store.getSettings()
    const registry = await getRetiredNameRegistryForRepo(
      store as never,
      repo,
      store.getRepos(),
      settings
    )
    return {
      retiredNamesByRepo: { [repo.id]: registry.names },
      retiredNameTiersByRepo: { [repo.id]: registry.exhaustedTiers }
    }
  }

  private visibilityDefaults(
    sourceDefaultsSupported: boolean,
    providedSettings?: ReturnType<RuntimeStore['getSettings']>
  ) {
    const defaults =
      providedSettings !== undefined
        ? providedSettings.worktreeVisibilityDefaults
        : this.deps.getStore()?.getSettings().worktreeVisibilityDefaults
    return sourceDefaultsSupported || !defaults ? defaults : { external: defaults.external }
  }
}
