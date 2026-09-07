// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import type { WorktreeCardProperty } from '../../../../shared/ui-chrome-types'
import type { Worktree } from '../../../../shared/worktree/types'

const openModal = vi.fn()
const setRenamingWorktreeId = vi.fn()
const updateWorktreeMeta = vi.fn()
const testDoubles = vi.hoisted(() => ({
  activateWorktreeFromSidebar: vi.fn()
}))
let worktreeCardProperties: WorktreeCardProperty[] = ['status', 'comment']
let settings: Partial<GlobalSettings> | null = null

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      browserTabsByWorktree: {},
      createBrowserTab: vi.fn(),
      deleteFolderWorkspace: vi.fn(),
      deleteStateByWorktreeId: {},
      fetchHostedReviewForBranch: vi.fn(),
      fetchIssue: vi.fn(),
      fetchLinearIssue: vi.fn(),
      gitConflictOperationByWorktree: {},
      hostedReviewCache: {},
      issueCache: {},
      linearIssueCache: {},
      openModal,
      openTaskPage: vi.fn(),
      projectGroups: [],
      ptyIdsByTabId: {},
      remoteBranchConflictByWorktreeId: {},
      renamingWorktreeId: null,
      setActiveWorktree: vi.fn(),
      setRemoteBrowserPageHandle: vi.fn(),
      setRenamingWorktreeId,
      settings,
      sshConnectionStates: new Map(),
      sshTargetLabels: new Map(),
      tabsByWorktree: {},
      updateWorktreeMeta,
      workspacePortScan: null,
      worktreeCardProperties
    })
}))

vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/lib/sidebar-worktree-activation', () => ({
  activateWorktreeFromSidebar: testDoubles.activateWorktreeFromSidebar
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({
  getActiveRuntimeTarget: () => ({ kind: 'local' })
}))

vi.mock('./use-worktree-activity-status', () => ({
  useWorktreeActivityStatus: () => 'idle'
}))

vi.mock('./CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownStartedAt: () => null
}))

vi.mock('./WorktreeCardAgents', () => ({
  default: () => <div data-testid="inline-agents" />
}))

vi.mock('./WorktreeContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="context-menu-wrapper">{children}</div>
  ),
  CLOSE_ALL_CONTEXT_MENUS_EVENT: 'orca:test-close-context-menus',
  WORKTREE_CONTEXT_MENU_SCOPE_ATTR: 'data-orca-context-menu-scope',
  WORKTREE_NATIVE_CONTEXT_MENU_ATTR: 'data-worktree-native-context-menu'
}))

vi.mock('./WorktreeTitleInlineRename', () => ({
  WorktreeTitleInlineRename: ({
    disabled,
    displayName
  }: {
    disabled?: boolean
    displayName: string
  }) => (
    <span data-testid="inline-rename" data-disabled={disabled ? 'true' : 'false'}>
      {displayName}
    </span>
  )
}))

import WorktreeCard from './WorktreeCard'

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'orca',
    badgeColor: '#999999',
    addedAt: 1,
    ...overrides
  }
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'repo-1::/repo/worktrees/affiliate',
    repoId: 'repo-1',
    path: '/repo/worktrees/affiliate',
    displayName: 'Affiliate child',
    branch: 'refs/heads/affiliate-child',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    comment: 'read only',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    ...overrides
  }
}

describe('WorktreeCard affiliate list mode', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.clearAllMocks()
    worktreeCardProperties = ['status', 'comment']
    settings = null
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('keeps the card visual surface but disables mutating list interactions', () => {
    act(() => {
      root.render(
        <WorktreeCard
          worktree={makeWorktree()}
          repo={makeRepo()}
          isActive={false}
          nativeDragEnabled
          flushSurface
          affiliateListMode
        />
      )
    })

    const surface = container.querySelector<HTMLElement>('[data-worktree-card-surface="true"]')
    const parentContent = container.querySelector<HTMLElement>(
      '[data-worktree-card-parent-content=""]'
    )
    expect(surface).not.toBeNull()
    expect(parentContent?.className).toContain('gap-0.5')
    expect(parentContent?.className).toContain('pl-0')
    const statusSlot = container.querySelector<HTMLElement>('[data-worktree-card-status-slot]')
    expect(statusSlot?.className).toContain('px-1')
    expect(container.querySelector('[data-testid="context-menu-wrapper"]')).toBeNull()
    expect(surface?.getAttribute('draggable')).toBe('false')
    expect(
      container.querySelector('[data-testid="inline-rename"]')?.getAttribute('data-disabled')
    ).toBe('true')

    act(() => {
      surface?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(openModal).not.toHaveBeenCalled()
    expect(setRenamingWorktreeId).not.toHaveBeenCalled()
    expect(updateWorktreeMeta).not.toHaveBeenCalled()

    act(() => {
      surface?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(testDoubles.activateWorktreeFromSidebar).toHaveBeenCalledWith(
      'repo-1::/repo/worktrees/affiliate',
      'local'
    )
  })

  it('renders and activates a verified jj main workspace through the shared host target', () => {
    const mainJjWorkspace = makeWorktree({
      id: 'repo-1::/repo',
      path: '/repo',
      displayName: 'main',
      branch: '',
      isMainWorktree: true,
      hostId: 'local'
    })

    act(() => {
      root.render(
        <WorktreeCard
          worktree={mainJjWorkspace}
          repo={makeRepo({ kind: 'jj' })}
          isActive={false}
          flushSurface
        />
      )
    })

    const surface = container.querySelector<HTMLElement>('[data-worktree-card-surface="true"]')
    expect(surface?.textContent).toContain('main')
    act(() => {
      surface?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(testDoubles.activateWorktreeFromSidebar).toHaveBeenCalledWith('repo-1::/repo', 'local')
  })

  it('renders the jj owner and sibling labels and activates each host-qualified row', () => {
    const owner = makeWorktree({
      id: 'repo-1::/repo',
      path: '/repo',
      displayName: 'default',
      branch: '',
      isMainWorktree: true,
      hostId: 'local',
      jjWorkspace: { name: 'default', root: '/repo', rootResolved: true }
    })
    const sibling = makeWorktree({
      id: 'repo-1::/repo/feature-o',
      path: '/repo/feature-o',
      displayName: 'feature-o',
      branch: '',
      isMainWorktree: false,
      hostId: 'local',
      jjWorkspace: { name: 'feature-o', root: '/repo/feature-o', rootResolved: true }
    })

    act(() => {
      root.render(
        <>
          <WorktreeCard worktree={owner} repo={makeRepo({ kind: 'jj' })} isActive={false} />
          <WorktreeCard worktree={sibling} repo={makeRepo({ kind: 'jj' })} isActive={false} />
        </>
      )
    })

    const surfaces = container.querySelectorAll<HTMLElement>('[data-worktree-card-surface="true"]')
    expect(surfaces).toHaveLength(2)
    expect(surfaces[1]?.textContent).toContain('feature-o')

    act(() => {
      surfaces[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      surfaces[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(testDoubles.activateWorktreeFromSidebar).toHaveBeenNthCalledWith(
      1,
      'repo-1::/repo',
      'local'
    )
    expect(testDoubles.activateWorktreeFromSidebar).toHaveBeenNthCalledWith(
      2,
      'repo-1::/repo/feature-o',
      'local'
    )
  })

  it('still shows inline agent details in affiliate list mode', () => {
    worktreeCardProperties = ['status', 'inline-agents']

    act(() => {
      root.render(
        <WorktreeCard
          worktree={makeWorktree()}
          repo={makeRepo()}
          isActive={false}
          nativeDragEnabled
          flushSurface
          affiliateListMode
        />
      )
    })

    expect(container.querySelector('[data-testid="inline-agents"]')).not.toBeNull()
  })
})
