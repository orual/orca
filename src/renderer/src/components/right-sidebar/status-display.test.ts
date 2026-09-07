// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JjChangesResult } from '../../../../shared/jj-types'
import type { Repo } from '../../../../shared/repo-types'

const lifecycleMocks = vi.hoisted(() => ({
  settings: { activeRuntimeEnvironmentId: 'focused-runtime' },
  ownerSettings: { activeRuntimeEnvironmentId: 'owner-runtime' },
  listRuntimeJjChanges: vi.fn(),
  getRepoOwnerRoutedSettings: vi.fn(),
  pollerRun: null as (() => Promise<void> | void) | null,
  pollerCleanup: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: <T>(selector: (state: { settings: typeof lifecycleMocks.settings }) => T): T =>
    selector({ settings: lifecycleMocks.settings })
}))
vi.mock('@/runtime/runtime-jj-client', () => ({
  listRuntimeJjChanges: lifecycleMocks.listRuntimeJjChanges
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionId: vi.fn(() => null) }))
vi.mock('@/lib/repo-runtime-owner', () => ({
  getRepoOwnerRoutedSettings: lifecycleMocks.getRepoOwnerRoutedSettings
}))
vi.mock('@/lib/window-visibility-timeout-poller', () => ({
  installWindowVisibilityTimeoutPoller: vi.fn(
    (config: { run: () => Promise<void> | void }): (() => void) => {
      lifecycleMocks.pollerRun = config.run
      return lifecycleMocks.pollerCleanup
    }
  )
}))

import { useJjExplorerStatus } from './use-jj-explorer-status'
import {
  buildFolderStatusMap,
  buildIgnoredSet,
  buildStatusMap,
  isPathIgnored,
  normalizeJjChange,
  normalizeJjChangesResult,
  shouldShowIgnoredDecoration
} from './status-display'

describe('Jujutsu explorer status normalization', () => {
  it('renders direct M/A/D-compatible statuses and propagates non-deleted ancestors', () => {
    const entries = [
      normalizeJjChange({ path: 'src/changed.ts', status: 'modified' }),
      normalizeJjChange({ path: 'src/new.ts', status: 'added' }),
      normalizeJjChange({ path: 'src/gone.ts', status: 'deleted' })
    ]

    expect(buildStatusMap(entries)).toEqual(
      new Map([
        ['src/changed.ts', 'modified'],
        ['src/new.ts', 'added'],
        ['src/gone.ts', 'deleted']
      ])
    )
    expect(buildFolderStatusMap(entries)).toEqual(new Map([['src', 'modified']]))
  })

  it('maps conflicted changes to the existing modified decoration and retains failures', () => {
    const previous = [normalizeJjChange({ path: 'src/last.ts', status: 'modified' })]
    expect(normalizeJjChange({ path: 'src/conflict.ts', status: 'conflicted' }).status).toBe(
      'modified'
    )
    expect(
      normalizeJjChangesResult(
        { ok: false, kind: 'unavailable', message: 'jj unavailable' },
        previous
      )
    ).toBe(previous)
  })

  it('normalizes separators and preserves rename source metadata', () => {
    expect(
      normalizeJjChange({ path: '\\\\src\\\\new.ts', originalPath: 'old.ts', status: 'renamed' })
    ).toEqual({ path: 'src/new.ts', oldPath: 'old.ts', status: 'renamed', area: 'unstaged' })
  })
})

describe('buildIgnoredSet', () => {
  it('returns an empty set when ignoredPaths is undefined', () => {
    expect(buildIgnoredSet(undefined).size).toBe(0)
  })

  it('strips trailing slash from directory entries so lookups by TreeNode.relativePath hit', () => {
    const set = buildIgnoredSet(['dist/', 'node_modules/', '.env'])
    expect(set.has('dist')).toBe(true)
    expect(set.has('node_modules')).toBe(true)
    expect(set.has('.env')).toBe(true)
    expect(set.has('dist/')).toBe(false)
  })
})

describe('isPathIgnored', () => {
  it('returns false on an empty set without walking ancestors', () => {
    expect(isPathIgnored(new Set(), 'a/b/c.ts')).toBe(false)
  })

  it('matches direct hits', () => {
    expect(isPathIgnored(new Set(['.env']), '.env')).toBe(true)
  })

  it('inherits ignored status from an ancestor directory', () => {
    const ignored = new Set(['dist'])
    expect(isPathIgnored(ignored, 'dist/index.js')).toBe(true)
    expect(isPathIgnored(ignored, 'dist/sub/deep/file.js')).toBe(true)
  })

  it('does not match sibling paths that share a prefix', () => {
    const ignored = new Set(['dist'])
    expect(isPathIgnored(ignored, 'distance.ts')).toBe(false)
  })
})

describe('shouldShowIgnoredDecoration', () => {
  it('shows ignored decoration only when no real git status exists', () => {
    const ignored = new Set(['dist'])

    expect(shouldShowIgnoredDecoration(null, ignored, 'dist/index.js')).toBe(true)
    expect(shouldShowIgnoredDecoration('modified', ignored, 'dist/index.js')).toBe(false)
    expect(shouldShowIgnoredDecoration('untracked', ignored, 'dist/index.js')).toBe(false)
  })
})

type ExplorerHookProps = {
  repo: Repo | null
  worktreeId: string | null
  worktreePath: string | null
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function explorerRepo(kind: 'git' | 'folder' | 'jj', id = 'repo-1'): Repo {
  return {
    id,
    path: `/workspace/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 0,
    kind
  }
}

function jjChanges(path: string): JjChangesResult {
  return {
    ok: true,
    comparison: 'current-change-vs-parents',
    changes: [{ path, status: 'modified' }]
  }
}

describe('useJjExplorerStatus lifecycle', () => {
  beforeEach(() => {
    lifecycleMocks.listRuntimeJjChanges.mockReset()
    lifecycleMocks.getRepoOwnerRoutedSettings.mockReset()
    lifecycleMocks.getRepoOwnerRoutedSettings.mockReturnValue(lifecycleMocks.ownerSettings)
    lifecycleMocks.pollerRun = null
    lifecycleMocks.pollerCleanup.mockReset()
  })

  afterEach(() => cleanup())

  it('uses the selected repository owner context instead of focused settings', async () => {
    const request = deferred<JjChangesResult>()
    lifecycleMocks.listRuntimeJjChanges.mockReturnValue(request.promise)
    const repo = explorerRepo('jj')
    const hook = renderHook(() => useJjExplorerStatus(repo, 'wt-1', '/repo'))

    expect(lifecycleMocks.getRepoOwnerRoutedSettings).toHaveBeenCalledWith(
      lifecycleMocks.settings,
      repo
    )
    expect(lifecycleMocks.listRuntimeJjChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: lifecycleMocks.ownerSettings,
        worktreeId: 'wt-1',
        worktreePath: '/repo'
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )

    await act(async () => {
      request.resolve(jjChanges('src/owner.ts'))
      await request.promise
    })
    expect(hook.result.current.entries).toEqual([
      { path: 'src/owner.ts', status: 'modified', area: 'unstaged' }
    ])
  })

  it('refreshes on a matching filesystem event but ignores another worktree', async () => {
    lifecycleMocks.listRuntimeJjChanges
      .mockResolvedValueOnce(jjChanges('src/first.ts'))
      .mockResolvedValueOnce(jjChanges('src/second.ts'))
    const repo = explorerRepo('jj')
    const hook = renderHook(() => useJjExplorerStatus(repo, 'wt-1', '/repo'))
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('orca:editor-external-file-change', {
          detail: { worktreeId: 'wt-other', worktreePath: '/repo', relativePath: 'file.ts' }
        })
      )
      await Promise.resolve()
    })
    expect(lifecycleMocks.listRuntimeJjChanges).toHaveBeenCalledOnce()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('orca:editor-external-file-change', {
          detail: { worktreeId: 'wt-1', worktreePath: '/repo/', relativePath: 'file.ts' }
        })
      )
      await Promise.resolve()
    })
    expect(lifecycleMocks.listRuntimeJjChanges).toHaveBeenCalledTimes(2)
    expect(hook.result.current.entries).toEqual([
      { path: 'src/second.ts', status: 'modified', area: 'unstaged' }
    ])
  })

  it('drops an older response when a forced refresh finishes first', async () => {
    const first = deferred<JjChangesResult>()
    const second = deferred<JjChangesResult>()
    lifecycleMocks.listRuntimeJjChanges
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const repo = explorerRepo('jj')
    const hook = renderHook(() => useJjExplorerStatus(repo, 'wt-1', '/repo'))

    await act(async () => {
      void hook.result.current.refresh(true)
      await Promise.resolve()
    })
    expect(lifecycleMocks.listRuntimeJjChanges).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve(jjChanges('new.ts'))
      await second.promise
      first.resolve(jjChanges('old.ts'))
      await first.promise
    })
    expect(hook.result.current.entries).toEqual([
      { path: 'new.ts', status: 'modified', area: 'unstaged' }
    ])
  })

  it('drops stale results when the worktree context changes', async () => {
    const first = deferred<JjChangesResult>()
    const second = deferred<JjChangesResult>()
    lifecycleMocks.listRuntimeJjChanges
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const hook = renderHook(
      ({ repo, worktreeId, worktreePath }: ExplorerHookProps) =>
        useJjExplorerStatus(repo, worktreeId, worktreePath),
      {
        initialProps: {
          repo: explorerRepo('jj', 'repo-a'),
          worktreeId: 'wt-a',
          worktreePath: '/repo-a'
        }
      }
    )

    hook.rerender({
      repo: explorerRepo('jj', 'repo-b'),
      worktreeId: 'wt-b',
      worktreePath: '/repo-b'
    })
    expect(first.promise).toBeDefined()
    expect(lifecycleMocks.listRuntimeJjChanges).toHaveBeenCalledTimes(2)
    const firstSignal = lifecycleMocks.listRuntimeJjChanges.mock.calls[0]?.[1].signal as AbortSignal
    expect(firstSignal.aborted).toBe(true)

    await act(async () => {
      second.resolve(jjChanges('new.ts'))
      await second.promise
      first.resolve(jjChanges('old.ts'))
      await first.promise
    })
    expect(hook.result.current.entries).toEqual([
      { path: 'new.ts', status: 'modified', area: 'unstaged' }
    ])
  })

  it('clears and aborts when SCM is unmounted from the explorer', () => {
    const request = deferred<JjChangesResult>()
    lifecycleMocks.listRuntimeJjChanges.mockReturnValue(request.promise)
    const initialProps: ExplorerHookProps = {
      repo: explorerRepo('jj'),
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    }
    const hook = renderHook(
      ({ repo, worktreeId, worktreePath }: ExplorerHookProps) =>
        useJjExplorerStatus(repo, worktreeId, worktreePath),
      { initialProps }
    )
    const signal = lifecycleMocks.listRuntimeJjChanges.mock.calls[0]?.[1].signal as AbortSignal

    hook.rerender({ repo: null, worktreeId: null, worktreePath: null })

    expect(signal.aborted).toBe(true)
    expect(hook.result.current.entries).toEqual([])
  })

  it('retains the last successful snapshot after a failed refresh', async () => {
    lifecycleMocks.listRuntimeJjChanges
      .mockResolvedValueOnce(jjChanges('src/last-known.ts'))
      .mockResolvedValueOnce({ ok: false, kind: 'unavailable', message: 'jj unavailable' })
    const hook = renderHook(() => useJjExplorerStatus(explorerRepo('jj'), 'wt-1', '/repo'))
    await act(async () => {
      await Promise.resolve()
      await hook.result.current.refresh(true)
    })

    expect(hook.result.current.entries).toEqual([
      { path: 'src/last-known.ts', status: 'modified', area: 'unstaged' }
    ])
  })

  it('aborts an in-flight request when the hook unmounts', () => {
    const request = deferred<JjChangesResult>()
    lifecycleMocks.listRuntimeJjChanges.mockReturnValue(request.promise)
    const hook = renderHook(() => useJjExplorerStatus(explorerRepo('jj'), 'wt-1', '/repo'))
    const signal = lifecycleMocks.listRuntimeJjChanges.mock.calls[0]?.[1].signal as AbortSignal

    hook.unmount()

    expect(signal.aborted).toBe(true)
    request.resolve(jjChanges('stale.ts'))
  })

  it.each(['git', 'folder'] as const)('does not call jj for a %s repo', async (kind) => {
    const hook = renderHook(() => useJjExplorerStatus(explorerRepo(kind), 'wt-1', '/repo'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(lifecycleMocks.listRuntimeJjChanges).not.toHaveBeenCalled()
    expect(hook.result.current.entries).toEqual([])
  })
})
