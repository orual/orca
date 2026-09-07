import React, { createElement, useEffect, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}))
vi.mock('expo-router', () => ({}))
vi.mock('../storage/preferences', () => ({ savePinnedIds: vi.fn() }))
vi.mock('../transport/host-removal-lifecycle', () => ({ removeHostAndCloseClient: vi.fn() }))
vi.mock('../session/floating-workspace', () => ({
  floatingWorkspaceSessionPath: vi.fn(() => '/floating')
}))
vi.mock('../host-route-action-state', () => ({ setHostRouteNewWorktreeVisible: vi.fn() }))
vi.mock('../host-route-exit', () => ({ leaveHostRoute: vi.fn() }))
import type { ExecutionHostId } from '../../../src/shared/execution-host'
import type { JjCleanupPending } from '../../../src/shared/worktree/types'
import type { RpcClient } from '../transport/rpc-client'
import type { Worktree } from '../worktree/workspace-list-sections'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { useHostWorktreeActions } from './use-host-worktree-actions'

const HOST_ID: ExecutionHostId = 'ssh:builder'
const ITEM = {
  worktreeId: 'repo-1::/workspaces/feature',
  repoId: 'repo-1',
  hostId: HOST_ID,
  workspaceKind: 'jj',
  displayName: 'feature',
  repo: 'repo',
  path: '/workspaces/feature'
} as Worktree
const PROOF: JjCleanupPending = {
  hostId: HOST_ID,
  worktreeId: ITEM.worktreeId,
  workspaceName: 'feature',
  targetRoot: ITEM.path,
  ownerRoot: '/repo'
}

type HarnessApi = ReturnType<typeof useHostWorktreeActions> & {
  setNotice: React.Dispatch<React.SetStateAction<unknown>>
}
type HarnessProps = {
  client: RpcClient
  initialNotice?: { identity: string; kind: 'uncertain' | 'rejected'; message: string }
  onApi: (api: HarnessApi) => void
  onState: (state: {
    worktrees: Worktree[]
    pending: Map<string, unknown>
    notice: unknown
  }) => void
  authoritativeRefresh?: boolean
  lockNotice?: boolean
}

function Harness({
  client,
  initialNotice,
  onApi,
  onState,
  authoritativeRefresh,
  lockNotice
}: HarnessProps) {
  const [worktrees, setWorktrees] = useState<Worktree[]>([ITEM])
  const [, setLastKnownWorktrees] = useState<Worktree[]>([ITEM])
  const [currentNotice, setCurrentNotice] = useState(initialNotice ?? null)
  useEffect(() => {
    if (authoritativeRefresh) {
      setCurrentNotice((current) => (current?.kind === 'uncertain' ? null : current))
    }
    if (lockNotice) {
      setCurrentNotice({
        identity: `${HOST_ID}|${ITEM.worktreeId}`,
        kind: 'uncertain',
        message: 'lost'
      })
    }
  }, [authoritativeRefresh, lockNotice])
  const [, setInFlight] = useState<string | null>(null)
  const [pending, setPending] = useState(
    new Map<string, { worktree: Worktree; proof: JjCleanupPending }>()
  )
  const clientRef = useRef<RpcClient>(client)
  const currentHostIdRef = useRef<string | undefined>(HOST_ID)
  useEffect(() => {
    clientRef.current = client
  }, [client])
  onState({ worktrees, pending, notice: currentNotice })
  const state = {
    newWorktreeModalRef: { current: null },
    newWorktreeModalVisibleRef: { current: false },
    clientRef,
    currentHostIdRef,
    pinnedIds: new Set<string>(),
    repoHostIdByRepoId: new Map<string, ExecutionHostId>([['repo-1', HOST_ID]]),
    setConfirmRemoveHost: vi.fn(),
    setJjRemovalInFlight: setInFlight,
    setJjRemovalNotice: setCurrentNotice,
    setLastKnownWorktrees,
    setOptimisticActiveWorktreeIdentity: vi.fn(),
    setPendingJjCleanupByIdentity: setPending,
    setPinnedIds: vi.fn(),
    setRouteActionState: vi.fn(),
    setWorktrees,
    worktrees
  } as never
  const api = useHostWorktreeActions({
    client,
    connState: 'connected',
    embedded: false,
    fetchWorktrees: vi.fn().mockResolvedValue(undefined),
    forgetHostClient: vi.fn(),
    hostId: HOST_ID,
    pathname: `/h/${HOST_ID}`,
    router: { push: vi.fn(), replace: vi.fn() } as never,
    state
  })
  onApi({ ...api, setNotice: setCurrentNotice })
  return null
}

function renderHarness(
  client: RpcClient,
  initialNotice: HarnessProps['initialNotice'] = undefined
) {
  let api!: HarnessApi
  let latest!: { worktrees: Worktree[]; pending: Map<string, unknown>; notice: unknown }
  let renderer!: ReactTestRenderer
  const props = {
    client,
    initialNotice,
    onApi: (value: HarnessApi) => (api = value),
    onState: (value: typeof latest) => (latest = value)
  }
  act(() => {
    renderer = create(createElement(Harness, props))
  })
  return {
    api,
    renderer,
    latest: () => latest,
    props,
    update: (next: Partial<HarnessProps>) =>
      renderer.update(createElement(Harness, { ...props, ...next }))
  }
}

describe('useHostWorktreeActions JJ removal safety', () => {
  it('does not apply a deferred old-client response to rows, proof, or notice after replacement', async () => {
    let resolve!: (value: unknown) => void
    const oldClient = {
      sendRequest: vi.fn(() => new Promise((r) => (resolve = r)))
    } as unknown as RpcClient
    const newClient = { sendRequest: vi.fn() } as unknown as RpcClient
    const { api, latest, update } = renderHarness(oldClient)

    let removal!: Promise<void>
    await act(async () => {
      removal = api.handleJjRemoval(ITEM, 'forget-and-delete')
    })
    await act(async () => {
      update({ client: newClient })
    })
    await act(async () => {
      resolve({ ok: true, result: { jjCleanupPending: PROOF } })
      await removal
    })

    expect(oldClient.sendRequest).toHaveBeenCalledOnce()
    expect(newClient.sendRequest).not.toHaveBeenCalled()
    expect(latest().worktrees).toEqual([ITEM])
    expect(latest().pending.size).toBe(0)
    expect(latest().notice).toBeNull()
  })

  it('blocks a second removal after uncertain delivery and only permits it after a successful refresh', async () => {
    const first = {
      sendRequest: vi.fn().mockRejectedValue(markRpcDeliveryUnknown(new Error('lost')))
    } as unknown as RpcClient
    let currentApi!: HarnessApi
    const { api, update } = renderHarness(first)
    currentApi = api
    await act(async () => currentApi.handleJjRemoval(ITEM, 'forget-and-delete'))
    expect(first.sendRequest).toHaveBeenCalledOnce()
    await act(async () => {
      currentApi.setNotice({
        identity: `${HOST_ID}|${ITEM.worktreeId}`,
        kind: 'uncertain',
        message: 'lost'
      })
    })
    await act(async () => {
      update({ onApi: (value) => (currentApi = value) })
      await Promise.resolve()
    })
    await act(async () => currentApi.handleJjRemoval(ITEM, 'forget-and-delete'))
    expect(first.sendRequest).toHaveBeenCalledTimes(2)

    await act(async () => {
      currentApi.setNotice(null)
      update({ onApi: (value) => (currentApi = value) })
    })
    await act(async () => currentApi.handleJjRemoval(ITEM, 'forget-and-delete'))
    expect(first.sendRequest).toHaveBeenCalledTimes(3)
  })
})
