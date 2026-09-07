import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileSourceControlProvider } from './use-mobile-source-control-provider'

const host = vi.hoisted(() => ({ client: null as RpcClient | null, state: 'connected' as const }))
vi.mock('../transport/client-context', () => ({ useHostClient: () => host }))

afterEach(() => {
  host.client = null
  vi.restoreAllMocks()
})

describe('useMobileSourceControlProvider', () => {
  it.each([
    [{ workspaceKind: 'jj' }, 'jj'],
    [{ workspaceKind: 'folder-workspace' }, 'folder'],
    [{ workspaceKind: 'git' }, 'git']
  ])('selects %s before provider hooks mount', async (worktree, expected) => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { worktree } })
    host.client = { sendRequest } as unknown as RpcClient
    let provider: string | null = null
    function Harness() {
      provider = useMobileSourceControlProvider('host-1', 'wt-1').provider
      return null
    }
    const renderer = create(createElement(Harness))
    await act(async () => {
      await Promise.resolve()
    })
    expect(provider).toBe(expected)
    expect(sendRequest).toHaveBeenCalledWith('worktree.show', { worktree: 'id:wt-1' })
    renderer.unmount()
  })

  it('fails closed on RPC errors instead of mounting Git', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'disconnected', message: 'offline' } })
    host.client = { sendRequest } as unknown as RpcClient
    let snapshot: ReturnType<typeof useMobileSourceControlProvider> | null = null
    function Harness() {
      snapshot = useMobileSourceControlProvider('host-1', 'wt-1')
      return null
    }
    const renderer = create(createElement(Harness))
    await act(async () => {
      await Promise.resolve()
    })
    expect(snapshot?.provider).toBeNull()
    expect(snapshot?.providerState.kind).toBe('error')
    renderer.unmount()
  })

  it('keeps a folder projection separate when it has no jj metadata', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { worktree: { workspaceKind: 'folder-workspace' } } })
    host.client = { sendRequest } as unknown as RpcClient
    let provider: string | null = null
    function Harness() {
      provider = useMobileSourceControlProvider('host-1', 'wt-1').provider
      return null
    }
    const renderer = create(createElement(Harness))
    await act(async () => {
      await Promise.resolve()
    })
    expect(provider).toBe('folder')
    renderer.unmount()
  })

  it('fails closed when the provider probe rejects instead of mounting Git', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('offline'))
    host.client = { sendRequest } as unknown as RpcClient
    let snapshot: ReturnType<typeof useMobileSourceControlProvider> | null = null
    function Harness() {
      snapshot = useMobileSourceControlProvider('host-1', 'wt-1')
      return null
    }
    const renderer = create(createElement(Harness))
    await act(async () => {
      await Promise.resolve()
    })
    expect(snapshot?.provider).toBeNull()
    expect(snapshot?.providerState.kind).toBe('error')
    renderer.unmount()
  })

  it('preserves legacy Git when the successful worktree shape omits workspaceKind', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { worktree: {} } })
    host.client = { sendRequest } as unknown as RpcClient
    let snapshot: ReturnType<typeof useMobileSourceControlProvider> | null = null
    function Harness() {
      snapshot = useMobileSourceControlProvider('host-1', 'wt-1')
      return null
    }
    const renderer = create(createElement(Harness))
    await act(async () => {
      await Promise.resolve()
    })
    expect(snapshot?.provider).toBe('git')
    expect(snapshot?.providerState).toEqual({ kind: 'ready', provider: 'git' })
    renderer.unmount()
  })

  it('does not retain a prior provider while the worktree identity changes', async () => {
    let resolveSecond: ((value: unknown) => void) | null = null
    const first = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { worktree: { workspaceKind: 'jj' } } })
    const second = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve
        })
    )
    const client = { sendRequest: first } as unknown as RpcClient
    host.client = client
    let snapshot: ReturnType<typeof useMobileSourceControlProvider> | null = null
    function Harness({ worktreeId }: { worktreeId: string }) {
      snapshot = useMobileSourceControlProvider('host-1', worktreeId)
      return null
    }
    const renderer = create(createElement(Harness, { worktreeId: 'jj-wt' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(snapshot?.provider).toBe('jj')

    ;(client.sendRequest as ReturnType<typeof vi.fn>).mockImplementation(second)
    await act(async () => {
      renderer.update(createElement(Harness, { worktreeId: 'git-wt' }))
    })
    expect(snapshot?.provider).toBeNull()
    expect(snapshot?.providerState.kind).toBe('loading')
    resolveSecond?.({ ok: true, result: { worktree: { workspaceKind: 'git' } } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(snapshot?.provider).toBe('git')
    renderer.unmount()
  })

  it('restarts provider detection when the client object is replaced', async () => {
    let resolveSecond: ((value: unknown) => void) | null = null
    const first = {
      sendRequest: vi
        .fn()
        .mockResolvedValue({ ok: true, result: { worktree: { workspaceKind: 'jj' } } })
    }
    const second = {
      sendRequest: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          })
      )
    }
    host.client = first as unknown as RpcClient
    let snapshot: ReturnType<typeof useMobileSourceControlProvider> | null = null
    function Harness() {
      snapshot = useMobileSourceControlProvider('host-1', 'wt-1')
      return null
    }
    const renderer = create(createElement(Harness))
    await act(async () => {
      await Promise.resolve()
    })
    expect(snapshot?.provider).toBe('jj')
    host.client = second as unknown as RpcClient
    await act(async () => {
      renderer.update(createElement(Harness))
    })
    expect(snapshot?.provider).toBeNull()
    expect(snapshot?.providerState.kind).toBe('loading')
    resolveSecond?.({ ok: true, result: { worktree: { workspaceKind: 'git' } } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(snapshot?.provider).toBe('git')
    expect(second.sendRequest).toHaveBeenCalledWith('worktree.show', { worktree: 'id:wt-1' })
    renderer.unmount()
  })
})
