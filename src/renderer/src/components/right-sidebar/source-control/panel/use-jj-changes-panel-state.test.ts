// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isJjWorkspaceStaleFailure } from '../../../../../../shared/jj-types'
import type {
  JjChangesResult,
  JjCommitResult,
  JjCurrentChangeMetadataResult
} from '../../../../../../shared/jj-types'

const mocks = vi.hoisted(() => ({
  activeWorktree: {
    id: 'wt-1',
    repoId: 'repo-1',
    path: '/repo/wt-1'
  } as { id: string; repoId: string; path: string } | null,
  activeRepo: {
    id: 'repo-1',
    connectionId: null,
    executionHostId: null,
    kind: 'jj'
  } as {
    id: string
    connectionId: string | null
    executionHostId: string | null
    kind: 'jj'
  } | null,
  settings: { activeRuntimeEnvironmentId: null },
  listRuntimeJjChanges: vi.fn(),
  getRuntimeJjCurrentChangeMetadata: vi.fn(),
  commitRuntimeJj: vi.fn(),
  createRuntimeJjBookmark: vi.fn(),
  describeRuntimeJjCurrentChange: vi.fn(),
  listRuntimeJjLocalBookmarks: vi.fn(),
  moveRuntimeJjBookmark: vi.fn(),
  readRuntimeJjFileDiff: vi.fn(),
  updateRuntimeJjWorkspaceStale: vi.fn(),
  notifyEditorExternalFileChange: vi.fn(),
  installPoller: vi.fn(),
  pollerRun: null as null | (() => Promise<void> | void),
  pollerCleanup: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: <T>(selector: (state: { settings: typeof mocks.settings }) => T): T =>
    selector({ settings: mocks.settings })
}))
vi.mock('@/store/selectors', () => ({
  useActiveWorktree: () => mocks.activeWorktree,
  useRepoById: () => mocks.activeRepo
}))
vi.mock('@/runtime/runtime-jj-client', () => ({
  listRuntimeJjChanges: mocks.listRuntimeJjChanges,
  getRuntimeJjCurrentChangeMetadata: mocks.getRuntimeJjCurrentChangeMetadata,
  commitRuntimeJj: mocks.commitRuntimeJj,
  createRuntimeJjBookmark: mocks.createRuntimeJjBookmark,
  describeRuntimeJjCurrentChange: mocks.describeRuntimeJjCurrentChange,
  listRuntimeJjLocalBookmarks: mocks.listRuntimeJjLocalBookmarks,
  moveRuntimeJjBookmark: mocks.moveRuntimeJjBookmark,
  readRuntimeJjFileDiff: mocks.readRuntimeJjFileDiff,
  updateRuntimeJjWorkspaceStale: mocks.updateRuntimeJjWorkspaceStale
}))
vi.mock('@/lib/window-visibility-timeout-poller', () => ({
  installWindowVisibilityTimeoutPoller: vi.fn(
    (config: { run: () => Promise<void> | void }): (() => void) => {
      mocks.pollerRun = config.run
      mocks.installPoller()
      return mocks.pollerCleanup
    }
  )
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionId: vi.fn(() => null) }))
vi.mock('@/lib/repo-runtime-owner', () => ({
  getRepoOwnerRoutedSettings: vi.fn((settings: typeof mocks.settings) => settings)
}))
vi.mock('../../../editor/editor-autosave', () => ({
  notifyEditorExternalFileChange: mocks.notifyEditorExternalFileChange
}))

import { useJjChangesPanelState } from './use-jj-changes-panel-state'

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

function changes(path: string): JjChangesResult {
  return {
    ok: true,
    comparison: 'current-change-vs-parents',
    changes: [{ path, status: 'modified' }]
  }
}

beforeEach(() => {
  mocks.activeWorktree = { id: 'wt-1', repoId: 'repo-1', path: '/repo/wt-1' }
  mocks.activeRepo = {
    id: 'repo-1',
    connectionId: null,
    executionHostId: null,
    kind: 'jj'
  }
  mocks.listRuntimeJjChanges.mockReset()
  mocks.listRuntimeJjChanges.mockResolvedValue(changes('/repo/wt-1/initial.ts'))
  mocks.getRuntimeJjCurrentChangeMetadata.mockReset()
  mocks.getRuntimeJjCurrentChangeMetadata.mockResolvedValue({
    ok: true,
    metadata: {
      commitId: 'commit-1',
      changeId: 'change-1',
      description: '',
      bookmarks: [],
      conflicted: false,
      workspaceName: 'default'
    }
  } satisfies JjCurrentChangeMetadataResult)
  mocks.commitRuntimeJj.mockReset()
  mocks.commitRuntimeJj.mockResolvedValue({ ok: true } satisfies JjCommitResult)
  mocks.createRuntimeJjBookmark.mockReset()
  mocks.createRuntimeJjBookmark.mockResolvedValue({ ok: true })
  mocks.describeRuntimeJjCurrentChange.mockReset()
  mocks.describeRuntimeJjCurrentChange.mockResolvedValue({ ok: true })
  mocks.listRuntimeJjLocalBookmarks.mockReset()
  mocks.listRuntimeJjLocalBookmarks.mockResolvedValue({ ok: true, bookmarks: [] })
  mocks.moveRuntimeJjBookmark.mockReset()
  mocks.moveRuntimeJjBookmark.mockResolvedValue({ ok: true })
  mocks.readRuntimeJjFileDiff.mockReset()
  mocks.updateRuntimeJjWorkspaceStale.mockReset()
  mocks.updateRuntimeJjWorkspaceStale.mockResolvedValue({ ok: true })
  mocks.notifyEditorExternalFileChange.mockReset()
  mocks.installPoller.mockReset()
  mocks.pollerCleanup.mockReset()
  mocks.pollerRun = null
})

afterEach(() => cleanup())

describe('useJjChangesPanelState ownership and polling', () => {
  it('distinguishes the exact stale working-copy hint from overloaded stale failures', () => {
    expect(
      isJjWorkspaceStaleFailure({
        kind: 'stale',
        message:
          'Error: The working copy is stale (not updated since operation 838e6b416165). Hint: Run `jj workspace update-stale` to update it. See https://docs.jj-vcs.dev/latest/working-copy/#stale-working-copy for more information.'
      })
    ).toBe(true)
    expect(
      isJjWorkspaceStaleFailure({
        kind: 'stale',
        message: 'There is no jj repo in the current directory.'
      })
    ).toBe(false)
    expect(
      isJjWorkspaceStaleFailure({
        kind: 'error',
        message:
          'The working copy is stale (not updated since operation 12). Hint: Run `jj workspace update-stale` to update it.'
      })
    ).toBe(false)
  })

  it('coalesces automatic refreshes while one list request is pending', async () => {
    const first = deferred<JjChangesResult>()
    mocks.listRuntimeJjChanges.mockReturnValue(first.promise)
    const hook = renderHook(() => useJjChangesPanelState())

    expect(mocks.listRuntimeJjChanges).toHaveBeenCalledOnce()
    act(() => {
      void mocks.pollerRun?.()
    })
    expect(mocks.listRuntimeJjChanges).toHaveBeenCalledOnce()

    await act(async () => {
      first.resolve(changes('first.ts'))
      await first.promise
    })
    expect(hook.result.current.state.changes).toEqual([{ path: 'first.ts', status: 'modified' }])
    hook.unmount()
  })

  it('lets a forced retry supersede an older response', async () => {
    const first = deferred<JjChangesResult>()
    const second = deferred<JjChangesResult>()
    mocks.listRuntimeJjChanges
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const hook = renderHook(() => useJjChangesPanelState())

    act(() => {
      void hook.result.current.refresh({ force: true })
    })
    expect(mocks.listRuntimeJjChanges).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve(changes('new.ts'))
      await second.promise
      first.resolve(changes('old.ts'))
      await first.promise
    })
    expect(hook.result.current.state.changes).toEqual([{ path: 'new.ts', status: 'modified' }])
  })

  it('drops a response from the previous workspace generation', async () => {
    const first = deferred<JjChangesResult>()
    const second = deferred<JjChangesResult>()
    mocks.listRuntimeJjChanges
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const hook = renderHook(() => useJjChangesPanelState())

    mocks.activeWorktree = { id: 'wt-2', repoId: 'repo-1', path: '/repo/wt-2' }
    act(() => {
      hook.rerender()
    })
    expect(mocks.listRuntimeJjChanges).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve(changes('new-worktree.ts'))
      await second.promise
      first.resolve(changes('old-worktree.ts'))
      await first.promise
    })
    expect(hook.result.current.state.changes).toEqual([
      { path: 'new-worktree.ts', status: 'modified' }
    ])
  })

  it('notifies all editor surfaces after confirmed stale recovery success', async () => {
    const hook = renderHook(() => useJjChangesPanelState())

    await act(async () => {
      await hook.result.current.recoverStaleWorkspace()
    })

    expect(mocks.notifyEditorExternalFileChange).toHaveBeenCalledOnce()
    expect(mocks.notifyEditorExternalFileChange).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      worktreePath: '/repo/wt-1',
      relativePath: '',
      runtimeEnvironmentId: null,
      workspaceWide: true
    })
  })

  it('does not notify editors after a failed or uncertain stale recovery', async () => {
    mocks.updateRuntimeJjWorkspaceStale.mockResolvedValueOnce({
      ok: false,
      kind: 'stale',
      message: 'still stale'
    })
    const hook = renderHook(() => useJjChangesPanelState())

    await act(async () => {
      await hook.result.current.recoverStaleWorkspace()
    })

    expect(mocks.notifyEditorExternalFileChange).not.toHaveBeenCalled()
  })

  it('does not notify the previous workspace when recovery resolves after a switch', async () => {
    const recovery = deferred<{ ok: true }>()
    mocks.updateRuntimeJjWorkspaceStale.mockReturnValueOnce(recovery.promise)
    const hook = renderHook(() => useJjChangesPanelState())

    let recoveryPromise: Promise<unknown> | undefined
    act(() => {
      recoveryPromise = hook.result.current.recoverStaleWorkspace()
      mocks.activeWorktree = { id: 'wt-2', repoId: 'repo-1', path: '/repo/wt-2' }
      hook.rerender()
    })
    recovery.resolve({ ok: true })
    await act(async () => {
      await recoveryPromise
    })

    expect(mocks.notifyEditorExternalFileChange).not.toHaveBeenCalled()
  })

  it('marks a rejected commit uncertain and does not permit replay', async () => {
    mocks.commitRuntimeJj.mockRejectedValueOnce(new Error('runtime disconnected'))
    const hook = renderHook(() => useJjChangesPanelState())

    let result: JjCommitResult | undefined
    await act(async () => {
      result = await hook.result.current.commit({
        expectedCommitId: 'commit-1',
        message: 'message',
        intent: { kind: 'all' }
      })
    })

    expect(result).toMatchObject({ kind: 'uncertain', uncertain: true })
    expect(hook.result.current.commitError).toMatchObject({ kind: 'uncertain', uncertain: true })
    expect(hook.result.current.isCommitting).toBe(false)
  })
})
