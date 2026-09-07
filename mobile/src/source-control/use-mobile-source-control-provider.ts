import { useCallback, useEffect, useState } from 'react'
import { useHostClient } from '../transport/client-context'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { readJjWorktreeKind } from './mobile-jj-client'

export type MobileSourceControlProvider = 'git' | 'jj' | 'folder'
export type MobileSourceControlProviderState =
  | { kind: 'loading' }
  | { kind: 'ready'; provider: MobileSourceControlProvider }
  | { kind: 'error'; message: string }

type ProviderIdentity = {
  hostId: string
  worktreeId: string
  client: RpcClient | null
}

type ProviderRequest = ProviderIdentity & {
  connState: ConnectionState
  nonce: number
}

type ProviderResolution = {
  identity: ProviderIdentity
  connState: ConnectionState
  nonce: number
  state: MobileSourceControlProviderState
}

function sameIdentity(left: ProviderIdentity, right: ProviderIdentity): boolean {
  return (
    left.hostId === right.hostId &&
    left.worktreeId === right.worktreeId &&
    left.client === right.client
  )
}

export function useMobileSourceControlProvider(
  hostId: string,
  worktreeId: string
): {
  provider: MobileSourceControlProvider | null
  providerState: MobileSourceControlProviderState
  connState: ConnectionState
  retry: () => void
} {
  const { client, state: connState } = useHostClient(hostId)
  const [resolution, setResolution] = useState<ProviderResolution | null>(null)
  const [nonce, setNonce] = useState(0)
  const request: ProviderRequest = { hostId, worktreeId, client, connState, nonce }
  const current =
    resolution &&
    sameIdentity(resolution.identity, request) &&
    resolution.connState === request.connState &&
    resolution.nonce === request.nonce
      ? resolution.state
      : { kind: 'loading' as const }

  useEffect(() => {
    let cancelled = false
    setResolution({
      identity: request,
      connState,
      nonce,
      state: { kind: 'loading' }
    })
    if (!client || connState !== 'connected' || !worktreeId) {
      return () => {
        cancelled = true
      }
    }
    void client
      .sendRequest('worktree.show', { worktree: `id:${worktreeId}` })
      .then((response) => {
        if (cancelled) {
          return
        }
        if (!response.ok) {
          setResolution({
            identity: request,
            connState,
            nonce,
            state: {
              kind: 'error',
              message: response.error?.message || 'Unable to identify workspace provider.'
            }
          })
          return
        }
        const result = response.result as
          | {
              worktree?: { workspaceKind?: unknown; jjWorkspace?: unknown }
            }
          | null
          | undefined
        const workspaceKind = result?.worktree?.workspaceKind
        if (
          workspaceKind !== undefined &&
          workspaceKind !== 'git' &&
          workspaceKind !== 'jj' &&
          workspaceKind !== 'folder-workspace'
        ) {
          setResolution({
            identity: request,
            connState,
            nonce,
            state: { kind: 'error', message: 'Desktop returned an unknown workspace provider.' }
          })
          return
        }
        setResolution({
          identity: request,
          connState,
          nonce,
          state: {
            kind: 'ready',
            provider:
              readJjWorktreeKind(result) === 'jj'
                ? 'jj'
                : workspaceKind === 'folder-workspace'
                  ? 'folder'
                  : 'git'
          }
        })
      })
      .catch(() => {
        if (!cancelled) {
          setResolution({
            identity: request,
            connState,
            nonce,
            state: {
              kind: 'error',
              message: 'Unable to identify workspace provider. Retry when connected.'
            }
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, connState, hostId, nonce, worktreeId])

  return {
    provider: current.kind === 'ready' ? current.provider : null,
    providerState: current,
    connState,
    retry: useCallback(() => setNonce((value) => value + 1), [])
  }
}
