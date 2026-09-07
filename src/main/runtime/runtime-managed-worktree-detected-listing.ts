import type { DetectedWorktreeListResult, Worktree } from '../../shared/worktree/types'
import type { Repo } from '../../shared/repo-types'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import { readWorktreeMetaForHost } from '../persistence/host-qualified-worktree-meta'
import { getRepoOwnedWorktreeMeta } from '../worktree-metadata-ownership'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { isFolderRepo } from '../../shared/repo-kind'
import { applyMetadataFallbackVisibility } from '../../shared/worktree/ownership'
import { projectResolvedWorktreeLineage } from '../../shared/resolved-worktree-lineage'
import {
  createWorktreeVisibilitySourceMatcher,
  resolveCustomWorktreeVisibilitySources
} from '../../shared/worktree/visibility-sources'
import { resolveConfiguredWorktreeBasePaths } from '../../shared/worktree/configured-worktree-base-path'
import { mergeWorktree } from '../ipc/worktree-logic'
import { pruneLineageForMissingRepoWorktrees } from '../worktree-lineage-pruning'
import { pruneMetadataMissingFromAuthoritativeLocalScan } from '../ipc/worktrees/listing/authoritative-local-worktree-metadata-pruning'
import type { NativeLocalWorktreeMetadataScanExpectation } from '../persistence/tracking-repos/missing-local-worktree-metadata-pruning'
import type { RuntimeStore } from './runtime-store-contract'
import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'
import { listRuntimeFolderWorkspaces } from './runtime-worktree-filesystem'
import type { WorktreeVisibilitySourceMatcher } from '../../shared/worktree/visibility-sources'
import { getLocalWorktreeScanGeneration } from '../local-worktree-scan-generation'
import type { Store } from '../persistence'

export type DetectedListingDependencies = {
  getStore(): RuntimeStore | null
  scanRepo(repo: Repo): Promise<RuntimeWorktreeScanResult>
  captureLocalMetadataPruneExpectation(
    store: RuntimeStore,
    repo: Repo
  ): NativeLocalWorktreeMetadataScanExpectation | undefined
  visibilityDefaults(
    sourceDefaultsSupported: boolean,
    settings?: ReturnType<RuntimeStore['getSettings']>
  ): ReturnType<RuntimeStore['getSettings']>['worktreeVisibilityDefaults'] | undefined
  toDetected(
    repo: Repo,
    worktree: Worktree,
    matcher: WorktreeVisibilitySourceMatcher | undefined,
    sourceDefaultsSupported: boolean,
    settings: ReturnType<RuntimeStore['getSettings']> | undefined,
    meta?: WorktreeMeta | null
  ): DetectedWorktreeListResult['worktrees'][number]
}

export async function listDetectedManagedWorktrees(
  deps: DetectedListingDependencies,
  repo: Repo,
  sourceDefaultsSupported = true
): Promise<DetectedWorktreeListResult> {
  const store = deps.getStore()
  if (!store) {
    throw new Error('runtime_unavailable')
  }
  const settings = store.getSettings()
  const visibilityDefaults = deps.visibilityDefaults(sourceDefaultsSupported)
  const visibilitySettings = { ...settings, worktreeVisibilityDefaults: visibilityDefaults }
  if (isFolderRepo(repo)) {
    const worktrees = listRuntimeFolderWorkspaces(store, repo)
    const metaById = store.getAllWorktreeMeta()
    const repoOwnerCount = store.getRepos().filter((candidate) => candidate.id === repo.id).length
    const matcher = createWorktreeVisibilitySourceMatcher(
      [repo.path, ...worktrees.map((worktree) => worktree.path)],
      resolveCustomWorktreeVisibilitySources(repo, visibilityDefaults),
      resolveConfiguredWorktreeBasePaths(repo)
    )
    const detected = worktrees.map((worktree) =>
      deps.toDetected(
        repo,
        worktree,
        matcher,
        sourceDefaultsSupported,
        visibilitySettings,
        getRepoOwnedWorktreeMeta(repo, worktree.id, metaById, repoOwnerCount) ?? null
      )
    )
    return {
      repoId: repo.id,
      authoritative: true,
      source: 'git',
      worktrees: projectResolvedWorktreeLineage(detected, store.getAllWorktreeLineage?.() ?? {})
    }
  }
  const metadataScanGeneration = getLocalWorktreeScanGeneration(repo.id)
  const metadataPruneExpectation = deps.captureLocalMetadataPruneExpectation(store, repo)
  let scan: RuntimeWorktreeScanResult
  try {
    scan = await deps.scanRepo(repo)
  } catch {
    scan = { ok: false, worktrees: [] }
  }
  if (scan.ok && scan.provider !== 'jj') {
    if (metadataPruneExpectation) {
      await pruneMetadataMissingFromAuthoritativeLocalScan({
        store: store as unknown as Store,
        repo,
        gitWorktrees: scan.worktrees,
        scan: metadataPruneExpectation,
        scanGeneration: metadataScanGeneration
      })
    }
    pruneLineageForMissingRepoWorktrees(store as unknown as Store, repo, scan.worktrees)
  }
  const matcher = createWorktreeVisibilitySourceMatcher(
    [repo.path, ...scan.worktrees.map((worktree) => worktree.path)],
    resolveCustomWorktreeVisibilitySources(repo, visibilityDefaults),
    resolveConfiguredWorktreeBasePaths(repo)
  )
  const expectedHostId = getRepoExecutionHostId(repo)
  const repoOwnerCount = store.getRepos().filter((candidate) => candidate.id === repo.id).length
  const metaById = store.getAllWorktreeMeta()
  const detected = scan.worktrees.map((gitWorktree) => {
    const id = `${repo.id}::${gitWorktree.path}`
    const meta =
      readWorktreeMetaForHost(store as unknown as Store, id, expectedHostId) ??
      getRepoOwnedWorktreeMeta(repo, id, metaById, repoOwnerCount)
    const worktree = {
      ...mergeWorktree(repo.id, gitWorktree, meta, repo.displayName),
      hostId: repoOwnerCount === 1 ? (meta?.hostId ?? expectedHostId) : expectedHostId
    }
    const result = deps.toDetected(
      repo,
      worktree,
      matcher,
      sourceDefaultsSupported,
      visibilitySettings,
      meta ?? null
    )
    return scan.ok ? result : applyMetadataFallbackVisibility(result)
  })
  return {
    repoId: repo.id,
    authoritative: scan.provider === 'jj' ? scan.ok && scan.complete === true : scan.ok,
    source: scan.provider === 'jj' ? 'jj' : scan.ok ? 'git' : 'metadata-fallback',
    worktrees: projectResolvedWorktreeLineage(detected, store.getAllWorktreeLineage?.() ?? {})
  }
}
