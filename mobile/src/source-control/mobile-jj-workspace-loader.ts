import type { JjChange, JjCurrentChangeMetadata, JjFailure } from '../../../src/shared/jj-types'
import { getMobileJjMetadata, isJjMethodUnavailable, listMobileJjChanges } from './mobile-jj-client'
import {
  loadMobileJjLocalBookmarks,
  type MobileJjOptionalLoaderState
} from './mobile-jj-optional-loaders'
import type { MobileJjIdentity, MobileJjScreenState } from './mobile-jj-source-control-types'

export type MobileJjWorkspaceLoaderState = MobileJjOptionalLoaderState & {
  identityRef: { current: MobileJjIdentity }
  mountedRef: { current: boolean }
  generationRef: { current: number }
  connState: string
  setScreenState: (
    state: MobileJjScreenState | ((previous: MobileJjScreenState) => MobileJjScreenState)
  ) => void
  setSelectedPaths: (paths: (previous: readonly string[]) => readonly string[]) => void
  reconcile: () => void
}

export type MobileJjRefreshRef = {
  current: { identity: MobileJjIdentity; promise: Promise<boolean> } | null
}

function sameIdentity(left: MobileJjIdentity, right: MobileJjIdentity): boolean {
  return (
    left.hostId === right.hostId &&
    left.worktreeId === right.worktreeId &&
    left.client === right.client &&
    left.clientId === right.clientId
  )
}

function failureMessage(result: JjFailure): string {
  return result.message || 'Unable to load jj workspace'
}

function isStale(result: unknown): result is JjFailure {
  return (
    typeof result === 'object' && result !== null && (result as { kind?: unknown }).kind === 'stale'
  )
}

type JjReadResult = { changes: JjChange[]; metadata: JjCurrentChangeMetadata }

export function createMobileJjWorkspaceRefresh(
  identity: MobileJjIdentity,
  identityRef: { current: MobileJjIdentity },
  mountedRef: { current: boolean },
  connState: string,
  refreshRef: MobileJjRefreshRef,
  state: MobileJjWorkspaceLoaderState
): (options?: { reconcile?: boolean }) => Promise<boolean> {
  return async (options?: { reconcile?: boolean }): Promise<boolean> => {
    const refreshIdentity = identity
    const pending = refreshRef.current
    if (pending && sameIdentity(pending.identity, refreshIdentity)) {
      const result = await pending.promise
      if (
        !options?.reconcile ||
        !result ||
        !mountedRef.current ||
        !sameIdentity(identityRef.current, refreshIdentity)
      ) {
        return result
      }
      if (refreshRef.current === pending) {
        refreshRef.current = null
      }
    }
    const generation = ++state.generationRef.current
    const current = (): boolean =>
      mountedRef.current &&
      state.generationRef.current === generation &&
      sameIdentity(identityRef.current, refreshIdentity)
    const promise = (async () => {
      const refreshClient = refreshIdentity.client
      const refreshWorktreeId = refreshIdentity.worktreeId
      if (!refreshWorktreeId || !refreshClient || connState !== 'connected') {
        if (current()) {
          state.setScreenState({ kind: 'error', message: 'Waiting for desktop...' })
        }
        return false
      }
      if (current()) {
        state.setScreenState((previous) =>
          previous.kind === 'ready' ? previous : { kind: 'loading' }
        )
      }
      try {
        const [changesResponse, metadataResponse, bookmarksResponse] = await Promise.allSettled([
          listMobileJjChanges(refreshClient, refreshWorktreeId),
          getMobileJjMetadata(refreshClient, refreshWorktreeId),
          loadMobileJjLocalBookmarks(refreshIdentity, state)
        ])
        if (!current()) {
          return false
        }
        if (bookmarksResponse.status === 'rejected') {
          state.setLocalBookmarksError('Unable to load local bookmarks')
        }
        if (changesResponse.status === 'rejected') {
          throw changesResponse.reason
        }
        if (metadataResponse.status === 'rejected') {
          throw metadataResponse.reason
        }
        const changes = changesResponse.value
        const metadata = metadataResponse.value
        if (!changes.ok) {
          if (changes.kind === 'unavailable' || changes.kind === 'unsupported') {
            state.setScreenState({ kind: 'unavailable', message: failureMessage(changes) })
          } else if (isStale(changes)) {
            state.setScreenState({ kind: 'stale', message: failureMessage(changes) })
          } else {
            state.setScreenState({ kind: 'error', message: failureMessage(changes) })
          }
          return false
        }
        if (!metadata.ok) {
          if (metadata.kind === 'unavailable' || metadata.kind === 'unsupported') {
            state.setScreenState({ kind: 'unavailable', message: failureMessage(metadata) })
          } else if (isStale(metadata)) {
            state.setScreenState({ kind: 'stale', message: failureMessage(metadata) })
          } else {
            state.setScreenState({ kind: 'error', message: failureMessage(metadata) })
          }
          return false
        }
        const result: JjReadResult = { changes: changes.changes, metadata: metadata.metadata }
        state.setScreenState({ kind: 'ready', ...result })
        state.setSelectedPaths((previous) =>
          previous.filter((path) => result.changes.some((change) => change.path === path))
        )
        if (options?.reconcile) {
          state.reconcile()
        }
        return true
      } catch (error) {
        if (!current()) {
          return false
        }
        state.setScreenState(
          isJjMethodUnavailable(error)
            ? { kind: 'unavailable', message: 'Update Orca desktop to use jj Source Control.' }
            : {
                kind: 'error',
                message: error instanceof Error ? error.message : 'Unable to load jj workspace'
              }
        )
        return false
      }
    })()
    refreshRef.current = { identity: refreshIdentity, promise }
    try {
      return await promise
    } finally {
      if (refreshRef.current?.promise === promise) {
        refreshRef.current = null
      }
    }
  }
}
