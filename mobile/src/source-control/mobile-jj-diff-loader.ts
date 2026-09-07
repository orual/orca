import type { RpcClient } from '../transport/rpc-client'
import { readMobileJjFileDiff } from './mobile-jj-client'
import type { MobileJjDiffState } from './mobile-jj-source-control-types'
import type { MobileJjIdentity } from './mobile-jj-source-control-types'

export type MobileJjDiffLoaderState = {
  identityRef: { current: MobileJjIdentity }
  mountedRef: { current: boolean }
  generationRef: { current: number }
  setDiffState: (state: MobileJjDiffState) => void
}

function sameIdentity(left: MobileJjIdentity, right: MobileJjIdentity): boolean {
  return (
    left.hostId === right.hostId &&
    left.worktreeId === right.worktreeId &&
    left.client === right.client &&
    left.clientId === right.clientId
  )
}

export async function loadMobileJjDiff(
  identity: MobileJjIdentity,
  path: string,
  parentRevision: string | undefined,
  state: MobileJjDiffLoaderState
): Promise<void> {
  const client = identity.client
  if (!client) {
    return
  }
  const generation = ++state.generationRef.current
  state.setDiffState({ kind: 'loading', path })
  const current = (): boolean =>
    state.mountedRef.current &&
    state.generationRef.current === generation &&
    sameIdentity(state.identityRef.current, identity)
  try {
    const result = await readMobileJjFileDiff(client as RpcClient, identity.worktreeId, {
      path,
      ...(parentRevision ? { parentRevision } : {})
    })
    if (!current()) {
      return
    }
    if (result.ok) {
      state.setDiffState({ kind: 'ready', path, result })
    } else {
      state.setDiffState({ kind: 'error', path, message: result.message })
    }
  } catch (error) {
    if (!current()) {
      return
    }
    state.setDiffState({
      kind: 'error',
      path,
      message: error instanceof Error ? error.message : 'Unable to load diff'
    })
  }
}
