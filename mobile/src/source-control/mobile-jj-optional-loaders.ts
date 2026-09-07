import type {
  JjLocalBookmark,
  JjLocalBookmarksResult,
  JjRemote,
  JjRemoteListResult
} from '../../../src/shared/jj-types'
import type { RpcClient } from '../transport/rpc-client'
import {
  isJjMethodUnavailable,
  listMobileJjLocalBookmarks,
  listMobileJjRemotes
} from './mobile-jj-client'
import type { MobileJjIdentity } from './mobile-jj-source-control-types'

export type MobileJjOptionalLoaderState = {
  identityRef: { current: MobileJjIdentity }
  mountedRef: { current: boolean }
  setLocalBookmarks: (bookmarks: JjLocalBookmark[]) => void
  setLocalBookmarksError: (message: string | null) => void
  setRemotes: (remotes: JjRemote[]) => void
  setRemoteError: (message: string | null) => void
}

function sameIdentity(left: MobileJjIdentity, right: MobileJjIdentity): boolean {
  return (
    left.hostId === right.hostId &&
    left.worktreeId === right.worktreeId &&
    left.client === right.client &&
    left.clientId === right.clientId
  )
}

function errorMessage(error: unknown, fallback: string, feature: string): string {
  if (isJjMethodUnavailable(error)) {
    return `Update Orca desktop to use jj ${feature}.`
  }
  return error instanceof Error ? error.message : fallback
}

export async function loadMobileJjLocalBookmarks(
  identity: MobileJjIdentity,
  state: MobileJjOptionalLoaderState
): Promise<JjLocalBookmarksResult> {
  if (!identity.client) {
    return { ok: false, kind: 'unavailable', message: 'Waiting for desktop...' }
  }
  try {
    const result = await listMobileJjLocalBookmarks(
      identity.client as RpcClient,
      identity.worktreeId
    )
    if (!sameIdentity(state.identityRef.current, identity) || !state.mountedRef.current) {
      return result
    }
    if (result.ok) {
      state.setLocalBookmarks(result.bookmarks)
      state.setLocalBookmarksError(null)
    } else {
      state.setLocalBookmarksError(result.message)
    }
    return result
  } catch (error) {
    const message = errorMessage(error, 'Unable to load local bookmarks', 'bookmarks')
    if (sameIdentity(state.identityRef.current, identity) && state.mountedRef.current) {
      state.setLocalBookmarksError(message)
    }
    return { ok: false, kind: 'unavailable', message }
  }
}

export async function loadMobileJjRemotes(
  identity: MobileJjIdentity,
  state: MobileJjOptionalLoaderState
): Promise<JjRemoteListResult> {
  if (!identity.client) {
    return { ok: false, kind: 'unavailable', message: 'Waiting for desktop...' }
  }
  try {
    const result = await listMobileJjRemotes(identity.client as RpcClient, identity.worktreeId)
    if (!sameIdentity(state.identityRef.current, identity) || !state.mountedRef.current) {
      return result
    }
    if (result.ok) {
      state.setRemotes(result.remotes)
      state.setRemoteError(null)
    } else {
      state.setRemoteError(result.message)
    }
    return result
  } catch (error) {
    const message = errorMessage(error, 'Unable to load remotes', 'remotes')
    if (sameIdentity(state.identityRef.current, identity) && state.mountedRef.current) {
      state.setRemoteError(message)
    }
    return { ok: false, kind: 'unavailable', message }
  }
}
