import type { Repo } from '../../../../shared/repo-types'
import type { ProjectHostSetup } from '../../../../shared/project-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { DetectedWorktreeListResult, Worktree } from '../../../../shared/worktree/types'
import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope,
  ALL_EXECUTION_HOSTS_SCOPE
} from '../../../../shared/execution-host'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { toVisibleWorktree } from '@/store/slices/worktrees/listing/worktree-catalog-visibility'
import { withRepoHostOwnership } from '@/store/slices/worktrees/listing/worktree-host-ownership'
import { getAllWorktreesFromState } from '@/store/selectors'
import {
  getCyclicProjectedWorktreeLineageIds,
  getLineageRenderInfo
} from './worktree-lineage-projection'
import {
  isAutomationGeneratedWorkspace,
  isCliCreatedWorkspace,
  isDetachedHeadWorkspace,
  isSleepingSweepExemptWorkspace
} from './visible-worktree-kinds'
import { isWorkspaceFromOtherDevice } from './workspace-creator-visibility'
import { isDefaultBranchWorkspace } from './default-branch-workspace'
import { getLineageAncestorIndex, getSortedWorktreeRankIndex } from './visible-worktree-indexes'
import { isInactiveWorkspace } from '@/lib/worktree-activity-state'
export type VisibleWorktreeOptions = {
  filterRepoIds: readonly string[]
  showSleepingWorkspaces: boolean
  tabsByWorktree: Record<string, Pick<TerminalTab, 'id'>[]> | null
  ptyIdsByTabId: Record<string, string[]> | null
  browserTabsByWorktree?: Record<string, { id: string }[]> | null
  worktreeIdsWithLiveAgent: ReadonlySet<string>
  hideDefaultBranchWorkspace: boolean
  hideAutomationGeneratedWorkspaces: boolean
  hideCliCreatedWorkspaces: boolean
  hideDetachedHeadWorkspaces: boolean
  hideWorkspacesFromOtherDevices: boolean
  pairedDeviceIdsByEnvironment: ReadonlyMap<string, string>
  alwaysShowDefaultBranchWorkspace?: boolean
  repoMap: Map<string, Repo>
  workspaceHostScope: ExecutionHostScope
  visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
  defaultHostId: ExecutionHostId
  worktreeLineageById: Record<string, WorktreeLineage>
  injectLineageAncestors?: boolean
  forcedVisibleWorktreeIds?: readonly string[]
}

export function projectSidebarWorktrees(
  worktreesByRepo: Record<string, Worktree[]>,
  detectedWorktreesByRepo: Readonly<Record<string, DetectedWorktreeListResult | undefined>> = {},
  repos: readonly Repo[] = [],
  projectHostSetups: readonly ProjectHostSetup[] = []
): Record<string, Worktree[]> {
  const projected: Record<string, Worktree[]> = {}
  const persistedIdentities = new Set<string>()
  for (const [repoId, worktrees] of Object.entries(worktreesByRepo)) {
    projected[repoId] = [...worktrees]
    for (const worktree of worktrees) {
      persistedIdentities.add(getWorktreeHostIdentity(worktree))
    }
  }

  const repoById = new Map(repos.map((repo) => [repo.id, repo]))
  const setupByRepoHost = new Map(
    projectHostSetups.map((setup) => [`${setup.repoId}::${setup.hostId}`, setup])
  )
  for (const [repoId, result] of Object.entries(detectedWorktreesByRepo)) {
    if (!result || result.source !== 'jj') {
      continue
    }
    const repo = repoById.get(repoId)
    if (!repo) {
      continue
    }
    const detectedHostIds = new Set<ExecutionHostId>()
    for (const worktree of result.worktrees) {
      if (
        !worktree.visible ||
        worktree.jjWorkspace?.rootResolved !== true ||
        worktree.path.trim().length === 0
      ) {
        continue
      }
      const hostId = worktree.hostId ?? getRepoExecutionHostId(repo)
      detectedHostIds.add(hostId)
      const setup = setupByRepoHost.get(`${repoId}::${hostId}`)
      const projectedWorktree = withRepoHostOwnership(toVisibleWorktree(worktree), hostId, setup)
      const identity = getWorktreeHostIdentity(projectedWorktree)
      if (persistedIdentities.has(identity)) {
        continue
      }
      const rows = projected[repoId] ?? (projected[repoId] = [])
      if (!rows.some((row) => getWorktreeHostIdentity(row) === identity)) {
        rows.push(projectedWorktree)
      }
    }
    if (detectedHostIds.size > 0 && !projected[repoId]) {
      projected[repoId] = []
    }
  }
  return projected
}

export function computeVisibleWorktrees(
  worktreesByRepo: Record<string, Worktree[]>,
  sortedIds: string[],
  opts: VisibleWorktreeOptions
): Worktree[] {
  let all = getAllWorktreesFromState({ worktreesByRepo })
  all = all.filter((w) => !w.isArchived)
  const lineageAncestorById = getLineageAncestorIndex(worktreesByRepo)

  if (opts.hideWorkspacesFromOtherDevices) {
    all = all.filter(
      (worktree) => !isWorkspaceFromOtherDevice(worktree, opts.pairedDeviceIdsByEnvironment)
    )
  }
  if (opts.hideDefaultBranchWorkspace) {
    all = all.filter((w) => !isDefaultBranchWorkspace(w))
  }
  if (opts.hideAutomationGeneratedWorkspaces) {
    all = all.filter((w) => !isAutomationGeneratedWorkspace(w))
  }
  if (opts.hideCliCreatedWorkspaces) {
    all = all.filter((w) => !isCliCreatedWorkspace(w))
  }
  if (opts.hideDetachedHeadWorkspaces) {
    all = all.filter((w) => !isDetachedHeadWorkspace(w))
  }

  const visibleHostIds =
    opts.visibleWorkspaceHostIds ??
    (opts.workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [opts.workspaceHostScope])
  if (visibleHostIds) {
    const visibleHostIdSet = new Set(visibleHostIds)
    all = all.filter((w) => {
      const repo = opts.repoMap.get(w.repoId)
      return repo
        ? visibleHostIdSet.has(getWorktreeExecutionHostId(w, repo, opts.defaultHostId))
        : false
    })
  }
  if (opts.filterRepoIds.length > 0) {
    const selectedRepoIds = new Set(opts.filterRepoIds)
    all = all.filter((w) => selectedRepoIds.has(w.repoId))
  }
  if (!opts.showSleepingWorkspaces) {
    all = all.filter(
      (w) =>
        isSleepingSweepExemptWorkspace(w, opts.alwaysShowDefaultBranchWorkspace) ||
        !isInactiveWorkspace(
          w.id,
          opts.tabsByWorktree,
          opts.ptyIdsByTabId,
          opts.browserTabsByWorktree,
          opts.worktreeIdsWithLiveAgent
        )
    )
  }
  if (opts.forcedVisibleWorktreeIds && opts.forcedVisibleWorktreeIds.length > 0) {
    const includedIds = new Set(all.map((worktree) => worktree.id))
    for (const worktreeId of opts.forcedVisibleWorktreeIds) {
      const worktree = lineageAncestorById.get(worktreeId)
      if (worktree && !includedIds.has(worktreeId)) {
        includedIds.add(worktreeId)
        all.push(worktree)
      }
    }
  }

  const orderIndex = getSortedWorktreeRankIndex(sortedIds)
  all.sort((a, b) => (orderIndex.get(a.id) ?? Infinity) - (orderIndex.get(b.id) ?? Infinity))
  return opts.injectLineageAncestors === false
    ? all
    : addVisibleLineageAncestors(all, lineageAncestorById, opts.worktreeLineageById)
}

function addVisibleLineageAncestors(
  worktrees: Worktree[],
  worktreeById: Map<string, Worktree>,
  lineageById: Record<string, WorktreeLineage>
): Worktree[] {
  const result: Worktree[] = []
  const included = new Set<string>()
  const visiting = new Set<string>()
  const cyclicLineageIds = getCyclicProjectedWorktreeLineageIds(lineageById, worktreeById)
  const addWithAncestors = (worktree: Worktree): void => {
    const identity = getWorktreeHostIdentity(worktree)
    if (included.has(identity) || visiting.has(identity)) {
      return
    }
    visiting.add(identity)
    const lineage = getLineageRenderInfo(worktree, lineageById, worktreeById, cyclicLineageIds)
    if (lineage.state === 'valid') {
      addWithAncestors(lineage.parent)
    }
    visiting.delete(identity)
    if (!included.has(identity)) {
      included.add(identity)
      result.push(worktree)
    }
  }
  for (const worktree of worktrees) {
    addWithAncestors(worktree)
  }
  return result
}

export function computeVisibleWorktreeIds(
  worktreesByRepo: Record<string, Worktree[]>,
  sortedIds: string[],
  opts: VisibleWorktreeOptions
): string[] {
  return computeVisibleWorktrees(worktreesByRepo, sortedIds, opts).map((worktree) => worktree.id)
}
