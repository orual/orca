import { useEffect, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileJjSourceControlState } from './use-mobile-jj-source-control-state'

const host = vi.hoisted(() => ({
  client: null as RpcClient | null,
  state: 'connected' as const
}))
const appState = vi.hoisted(() => ({ listener: null as ((state: string) => void) | null }))

vi.mock('../transport/client-context', () => ({
  useHostClient: () => host,
  useForceReconnect: () => vi.fn()
}))
vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => undefined | (() => void)) => {
    useEffect(effect, [])
  }
}))
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listener = listener
      return {
        remove: () => {
          appState.listener = null
        }
      }
    }
  }
}))

const metadata = {
  commitId: 'commit-1',
  changeId: 'change-1',
  description: 'Draft',
  bookmarks: [{ name: 'main', readOnly: true }],
  conflicted: false,
  workspaceName: 'workspace'
}
const changes = {
  comparison: 'current-change-vs-parents' as const,
  changes: [{ path: 'src/a.ts', status: 'modified' as const, stats: { added: 1, removed: 1 } }]
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function renderHook(
  client: RpcClient,
  worktreeId = 'wt-1'
): Promise<{
  renderer: ReactTestRenderer
  getState: () => ReturnType<typeof useMobileJjSourceControlState>
  Harness: (props: { worktreeId: string }) => ReactElement | null
}> {
  host.client = client
  let current: ReturnType<typeof useMobileJjSourceControlState> | null = null
  function Harness({ worktreeId: currentWorktreeId }: { worktreeId: string }) {
    current = useMobileJjSourceControlState({ hostId: 'host-1', worktreeId: currentWorktreeId })
    return null
  }
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(<Harness worktreeId={worktreeId} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  return {
    renderer: renderer as ReactTestRenderer,
    getState: () => current as ReturnType<typeof useMobileJjSourceControlState>,
    Harness
  }
}

afterEach(() => {
  host.client = null
  appState.listener = null
  vi.restoreAllMocks()
})

describe('useMobileJjSourceControlState', () => {
  it('serializes concurrent commits and sends the expected commit id', async () => {
    let releaseFirst: (() => void) | null = null
    let commitCalls = 0
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'jj.listChanges') {
        return { ok: true, result: { ok: true, ...changes } }
      }
      if (method === 'jj.getCurrentChangeMetadata') {
        return { ok: true, result: { ok: true, metadata } }
      }
      if (method === 'jj.commit') {
        commitCalls += 1
        if (commitCalls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
        return { ok: true, result: { ok: true } }
      }
      throw new Error(`unexpected ${method}`)
    })
    const client = { sendRequest } as unknown as RpcClient
    const { renderer, getState } = await renderHook(client)
    act(() => getState().setCommitMessage('save draft'))
    await act(async () => {
      await Promise.resolve()
    })
    const first = getState().commit({ kind: 'all' })
    const second = getState().commit({ kind: 'selected', paths: ['src/a.ts'] })
    await act(async () => {
      await Promise.resolve()
    })
    expect(commitCalls).toBe(1)
    await expect(second).resolves.toBeNull()
    releaseFirst?.()
    await act(async () => {
      await first
    })
    expect(commitCalls).toBe(1)
    expect(
      sendRequest.mock.calls
        .filter(([method]) => method === 'jj.commit')
        .map(([, params]) => params)
    ).toEqual([
      {
        worktree: 'id:wt-1',
        expectedCommitId: 'commit-1',
        message: 'save draft',
        intent: { kind: 'all' }
      }
    ])
    renderer.unmount()
  })

  it('surfaces uncertain commit outcomes without retrying', async () => {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'jj.listChanges') {
        return { ok: true, result: { ok: true, ...changes } }
      }
      if (method === 'jj.getCurrentChangeMetadata') {
        return { ok: true, result: { ok: true, metadata } }
      }
      if (method === 'jj.commit') {
        throw new Error('connection lost after dispatch')
      }
      throw new Error(`unexpected ${method}`)
    })
    const { renderer, getState } = await renderHook({ sendRequest } as unknown as RpcClient)
    act(() => getState().setCommitMessage('save'))
    await act(async () => {
      await Promise.resolve()
    })
    let result: unknown
    await act(async () => {
      result = await getState().commit({ kind: 'all' })
    })
    expect(result).toMatchObject({ ok: false, kind: 'uncertain', uncertain: true })
    expect(getState().mutationUncertain).toBe(true)
    expect(sendRequest.mock.calls.filter(([method]) => method === 'jj.commit')).toHaveLength(1)
    renderer.unmount()
  })

  it('clears uncertainty only after a successful authoritative refresh', async () => {
    let readsAvailable = true
    const reconciliation = deferred<unknown>()
    const sendRequest = vi.fn(async (method: string) => {
      if (!readsAvailable) {
        await reconciliation.promise
      }
      if (method === 'jj.listChanges') {
        if (!readsAvailable) {
          throw new Error('connection lost during refresh')
        }
        return { ok: true, result: { ok: true, ...changes } }
      }
      if (method === 'jj.getCurrentChangeMetadata') {
        if (!readsAvailable) {
          throw new Error('connection lost during refresh')
        }
        return { ok: true, result: { ok: true, metadata } }
      }
      if (method === 'jj.commit') {
        throw new Error('connection lost after dispatch')
      }
      throw new Error(`unexpected ${method}`)
    })
    const { renderer, getState } = await renderHook({ sendRequest } as unknown as RpcClient)
    act(() => getState().setCommitMessage('save'))
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await getState().commit({ kind: 'all' })
    })
    expect(getState().mutationUncertain).toBe(true)

    readsAvailable = false
    const failedRefresh = getState().refresh({ reconcile: true })
    await act(async () => {
      await Promise.resolve()
      reconciliation.reject(new Error('connection lost during refresh'))
      await failedRefresh
    })
    expect(getState().mutationUncertain).toBe(true)

    readsAvailable = true
    await act(async () => {
      await getState().refresh({ reconcile: true })
    })
    expect(getState().mutationUncertain).toBe(false)
    renderer.unmount()
  })

  it('fences an old client refresh when the client object changes', async () => {
    const oldList = deferred<unknown>()
    const oldMetadata = deferred<unknown>()
    const newList = deferred<unknown>()
    const newMetadata = deferred<unknown>()
    const oldClient = {
      sendRequest: vi.fn((method: string) =>
        method === 'jj.listChanges' ? oldList.promise : oldMetadata.promise
      )
    } as unknown as RpcClient
    const newClient = {
      sendRequest: vi.fn((method: string) =>
        method === 'jj.listChanges' ? newList.promise : newMetadata.promise
      )
    } as unknown as RpcClient
    const initial = await renderHook(oldClient)
    act(() => {
      initial.getState().setSelectedPaths(['src/a.ts'])
      initial.getState().setCommitMessage('old client message')
    })
    host.client = newClient
    await act(async () => {
      initial.renderer.update(<initial.Harness worktreeId="wt-1" />)
      await Promise.resolve()
    })
    expect(initial.getState().selectedPaths).toEqual([])
    expect(initial.getState().commitMessage).toBe('')
    newList.resolve({ ok: true, result: { ok: true, ...changes } })
    newMetadata.resolve({ ok: true, result: { ok: true, metadata } })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    oldList.resolve({
      ok: true,
      result: {
        ok: true,
        changes: [{ path: 'old.ts', status: 'added', stats: { added: 1, removed: 0 } }],
        comparison: 'current-change-vs-parents'
      }
    })
    oldMetadata.resolve({
      ok: true,
      result: { ok: true, metadata: { ...metadata, commitId: 'old-commit' } }
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(initial.getState().screenState).toMatchObject({
      kind: 'ready',
      changes: changes.changes
    })
    initial.renderer.unmount()
  })

  it('loads bookmarks with the base refresh while keeping remotes on demand', async () => {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'jj.listChanges') {
        return { ok: true, result: { ok: true, ...changes } }
      }
      if (method === 'jj.getCurrentChangeMetadata') {
        return { ok: true, result: { ok: true, metadata } }
      }
      if (method === 'jj.listLocalBookmarks') {
        return {
          ok: true,
          result: { ok: true, bookmarks: [{ name: 'feature/mobile', commitId: 'commit-1' }] }
        }
      }
      if (method === 'jj.listRemotes') {
        return {
          ok: true,
          result: { ok: true, remotes: [{ name: 'origin', url: 'https://example.test/repo' }] }
        }
      }
      throw new Error(`unexpected ${method}`)
    })
    const { renderer, getState } = await renderHook({ sendRequest } as unknown as RpcClient)
    expect(getState().localBookmarks).toEqual([{ name: 'feature/mobile', commitId: 'commit-1' }])
    expect(sendRequest.mock.calls.filter(([method]) => method === 'jj.listRemotes')).toHaveLength(0)
    await act(async () => {
      await getState().listRemotes()
    })
    expect(getState().remotes).toEqual([{ name: 'origin', url: 'https://example.test/repo' }])
    expect(sendRequest.mock.calls.filter(([method]) => method === 'jj.listRemotes')).toHaveLength(1)
    renderer.unmount()
  })

  it('refreshes local bookmarks after a successful bookmark mutation', async () => {
    let bookmarkReads = 0
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'jj.listChanges') {
        return { ok: true, result: { ok: true, ...changes } }
      }
      if (method === 'jj.getCurrentChangeMetadata') {
        return { ok: true, result: { ok: true, metadata } }
      }
      if (method === 'jj.listLocalBookmarks') {
        bookmarkReads += 1
        return {
          ok: true,
          result: {
            ok: true,
            bookmarks: bookmarkReads > 1 ? [{ name: 'feature/new', commitId: 'commit-1' }] : []
          }
        }
      }
      if (method === 'jj.createBookmark') {
        return { ok: true, result: { ok: true } }
      }
      throw new Error(`unexpected ${method}`)
    })
    const { renderer, getState } = await renderHook({ sendRequest } as unknown as RpcClient)
    expect(getState().localBookmarks).toEqual([])
    await act(async () => {
      await getState().createBookmark('feature/new')
    })
    expect(getState().localBookmarks).toEqual([{ name: 'feature/new', commitId: 'commit-1' }])
    expect(bookmarkReads).toBe(2)
    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'jj.createBookmark')
    ).toHaveLength(1)
    expect(
      sendRequest.mock.calls.find(([method]) => method === 'jj.createBookmark')?.[1]
    ).toMatchObject({
      worktree: 'id:wt-1',
      expectedCommitId: 'commit-1',
      name: 'feature/new'
    })
    renderer.unmount()
  })

  it('keeps base data ready when an old host rejects optional bookmark reads', async () => {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'jj.listChanges') {
        return { ok: true, result: { ok: true, ...changes } }
      }
      if (method === 'jj.getCurrentChangeMetadata') {
        return { ok: true, result: { ok: true, metadata } }
      }
      if (method === 'jj.listLocalBookmarks') {
        throw Object.assign(new Error('missing'), { code: 'method_not_found' })
      }
      throw new Error(`unexpected ${method}`)
    })
    const { renderer, getState } = await renderHook({ sendRequest } as unknown as RpcClient)
    expect(getState().screenState).toMatchObject({ kind: 'ready' })
    expect(getState().localBookmarks).toEqual([])
    expect(getState().localBookmarksError).toContain('Update Orca desktop')
    renderer.unmount()
  })

  it('fences optional bookmark and remote responses after switching identity', async () => {
    const oldBookmarks = deferred<unknown>()
    const oldRemotes = deferred<unknown>()
    const sendRequest = vi.fn((method: string, params?: { worktree?: string }) => {
      if (method === 'jj.listChanges') {
        return Promise.resolve({ ok: true, result: { ok: true, ...changes } })
      }
      if (method === 'jj.getCurrentChangeMetadata') {
        return Promise.resolve({ ok: true, result: { ok: true, metadata } })
      }
      if (method === 'jj.listLocalBookmarks') {
        return params?.worktree === 'id:wt-1'
          ? oldBookmarks.promise
          : Promise.resolve({ ok: true, result: { ok: true, bookmarks: [] } })
      }
      if (method === 'jj.listRemotes') {
        return params?.worktree === 'id:wt-1'
          ? oldRemotes.promise
          : Promise.resolve({ ok: true, result: { ok: true, remotes: [] } })
      }
      throw new Error(`unexpected ${method}`)
    })
    const { renderer, getState, Harness } = await renderHook({
      sendRequest
    } as unknown as RpcClient)
    const bookmarksRequest = getState().listLocalBookmarks()
    const remotesRequest = getState().listRemotes()
    await act(async () => {
      renderer.update(<Harness worktreeId="wt-2" />)
      await Promise.resolve()
    })
    oldBookmarks.resolve({
      ok: true,
      result: { ok: true, bookmarks: [{ name: 'old', commitId: 'old' }] }
    })
    oldRemotes.resolve({ ok: true, result: { ok: true, remotes: [{ name: 'old', url: 'old' }] } })
    await act(async () => {
      await Promise.all([bookmarksRequest, remotesRequest])
      await Promise.resolve()
    })
    expect(getState().localBookmarks).toEqual([])
    expect(getState().remotes).toEqual([])
    renderer.unmount()
  })

  it('locks every mutation after uncertainty until a successful reconciliation', async () => {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'jj.listChanges') {
        return { ok: true, result: { ok: true, ...changes } }
      }
      if (method === 'jj.getCurrentChangeMetadata') {
        return { ok: true, result: { ok: true, metadata } }
      }
      if (method === 'jj.listLocalBookmarks') {
        return { ok: true, result: { ok: true, bookmarks: [] } }
      }
      if (method === 'jj.commit') {
        throw new Error('lost after dispatch')
      }
      if (method === 'jj.describe') {
        return { ok: true, result: { ok: true } }
      }
      if (method === 'jj.createBookmark') {
        return { ok: true, result: { ok: true } }
      }
      if (method === 'jj.moveBookmark') {
        return { ok: true, result: { ok: true } }
      }
      if (method === 'jj.fetchRemote') {
        return { ok: true, result: { ok: true } }
      }
      if (method === 'jj.pushBookmark') {
        return { ok: true, result: { ok: true } }
      }
      throw new Error(`unexpected ${method}`)
    })
    const { renderer, getState } = await renderHook({ sendRequest } as unknown as RpcClient)
    act(() => getState().setCommitMessage('save'))
    await act(async () => {})
    await act(async () => {
      await getState().commit({ kind: 'all' })
    })
    expect(getState().mutationUncertain).toBe(true)
    const before = sendRequest.mock.calls.length
    await act(async () => {
      await Promise.all([
        getState().describe('desc'),
        getState().createBookmark('feature/new'),
        getState().moveBookmark('feature/old'),
        getState().fetchRemote('origin'),
        getState().pushBookmark('origin', 'feature/old'),
        getState().updateStale()
      ])
    })
    expect(sendRequest.mock.calls.length).toBe(before)
    renderer.unmount()
  })

  it('resets uncertain mutation state when switching worktrees', async () => {
    const sendRequest = vi.fn(async (method: string, params?: { worktree?: string }) => {
      if (method === 'jj.listChanges') {
        return { ok: true, result: { ok: true, ...changes } }
      }
      if (method === 'jj.getCurrentChangeMetadata') {
        return { ok: true, result: { ok: true, metadata } }
      }
      if (method === 'jj.commit' && params?.worktree === 'id:wt-1') {
        throw new Error('connection lost after dispatch')
      }
      if (method === 'jj.commit') {
        return { ok: true, result: { ok: true } }
      }
      throw new Error(`unexpected ${method}`)
    })
    const { renderer, getState, Harness } = await renderHook({
      sendRequest
    } as unknown as RpcClient)
    act(() => getState().setCommitMessage('save'))
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await getState().commit({ kind: 'all' })
    })
    expect(getState().mutationUncertain).toBe(true)

    await act(async () => {
      renderer.update(<Harness worktreeId="wt-2" />)
      await Promise.resolve()
    })
    expect(getState().mutationUncertain).toBe(false)
    act(() => getState().setCommitMessage('save new'))
    await act(async () => {
      await Promise.resolve()
    })
    const result = await act(async () => getState().commit({ kind: 'all' }))
    expect(result).toMatchObject({ ok: true })
    expect(sendRequest.mock.calls.filter(([method]) => method === 'jj.commit')).toHaveLength(2)
    expect(sendRequest.mock.calls.at(-1)?.[1]).toMatchObject({ worktree: 'id:wt-2' })
    renderer.unmount()
  })
})
