import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JjLocalBookmark, JjRemote } from '../../../src/shared/jj-types'
import { useHostClient, useForceReconnect } from '../transport/client-context'
import { loadMobileJjLocalBookmarks, loadMobileJjRemotes } from './mobile-jj-optional-loaders'
import { loadMobileJjDiff } from './mobile-jj-diff-loader'
import { createMobileJjWorkspaceRefresh } from './mobile-jj-workspace-loader'
import { useMobileJjMutations } from './use-mobile-jj-mutations'
import { useMobileJjPolling } from './use-mobile-jj-polling'
import type {
  MobileJjDiffState,
  MobileJjScreenState,
  MobileJjSourceControlState
} from './mobile-jj-source-control-types'
export type {
  MobileJjDiffState,
  MobileJjScreenState,
  MobileJjSourceControlState
} from './mobile-jj-source-control-types'
export type { MobileJjIdentity } from './mobile-jj-source-control-types'
import type { MobileJjIdentity } from './mobile-jj-source-control-types'

export function useMobileJjSourceControlState(args: {
  hostId: string
  worktreeId: string
}): MobileJjSourceControlState {
  const { hostId, worktreeId } = args
  const { client, clientId: resolvedClientId, state: connState } = useHostClient(hostId)
  const clientId = resolvedClientId ?? null
  const forceReconnect = useForceReconnect()
  const [screenState, setScreenState] = useState<MobileJjScreenState>({ kind: 'loading' })
  const [diffState, setDiffState] = useState<MobileJjDiffState>({ kind: 'idle' })
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([])
  const [commitMessage, setCommitMessage] = useState('')
  const [localBookmarks, setLocalBookmarks] = useState<JjLocalBookmark[]>([])
  const [remotes, setRemotes] = useState<JjRemote[]>([])
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [localBookmarksError, setLocalBookmarksError] = useState<string | null>(null)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const generationRef = useRef(0)
  const diffGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const refreshRef = useRef<{
    identity: MobileJjIdentity
    promise: Promise<boolean>
  } | null>(null)
  const identity = useMemo<MobileJjIdentity>(
    () => ({ hostId, worktreeId, client, clientId }),
    [client, clientId, hostId, worktreeId]
  )
  const identityRef = useRef(identity)
  identityRef.current = identity
  const reconcileRef = useRef<() => void>(() => {})

  const optionalLoaderState = useMemo(
    () => ({
      identityRef,
      mountedRef,
      setLocalBookmarks,
      setLocalBookmarksError,
      setRemotes,
      setRemoteError
    }),
    [identityRef, mountedRef]
  )
  const workspaceLoaderState = useMemo(
    () => ({
      ...optionalLoaderState,
      generationRef,
      connState,
      setScreenState,
      setSelectedPaths,
      reconcile: () => reconcileRef.current()
    }),
    [connState, optionalLoaderState]
  )
  const refresh = useMemo(
    () =>
      createMobileJjWorkspaceRefresh(
        identity,
        identityRef,
        mountedRef,
        connState,
        refreshRef,
        workspaceLoaderState
      ),
    [connState, identity, workspaceLoaderState]
  )

  const listLocalBookmarks = useCallback(
    () => loadMobileJjLocalBookmarks(identity, optionalLoaderState),
    [identity, optionalLoaderState]
  )
  const listRemotes = useCallback(
    () => loadMobileJjRemotes(identity, optionalLoaderState),
    [identity, optionalLoaderState]
  )

  const diffLoaderState = useMemo(
    () => ({ identityRef, mountedRef, generationRef: diffGenerationRef, setDiffState }),
    []
  )
  const readDiff = useCallback(
    (path: string, parentRevision?: string) => {
      if (connState !== 'connected') {
        return Promise.resolve()
      }
      return loadMobileJjDiff(identity, path, parentRevision, diffLoaderState)
    },
    [connState, diffLoaderState, identity]
  )

  const mutationActions = useMobileJjMutations({
    client,
    connState,
    identity,
    identityRef,
    mountedRef,
    screenState,
    setScreenState: (next) => setScreenState(next),
    commitMessage,
    setCommitMessage,
    selectedPaths,
    refresh: () => refresh()
  })

  const {
    busyAction,
    mutationUncertain,
    mutationError,
    commit,
    updateStale,
    reconcile,
    describe,
    createBookmark,
    moveBookmark,
    fetchRemote,
    pushBookmark
  } = mutationActions
  reconcileRef.current = reconcile

  useEffect(() => {
    mountedRef.current = true
    refreshRef.current = null
    generationRef.current += 1
    diffGenerationRef.current += 1
    setScreenState({ kind: 'loading' })
    setDiffState({ kind: 'idle' })
    setSelectedPaths([])
    setCommitMessage('')
    setLocalBookmarks([])
    setRemotes([])
    setMetadataError(null)
    setLocalBookmarksError(null)
    setRemoteError(null)
    void refresh()
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      diffGenerationRef.current += 1
    }
  }, [identity, refresh])

  useMobileJjPolling(refresh, () => !refreshRef.current)

  return useMemo(
    () => ({
      client,
      localBookmarks,
      remotes,
      metadataError,
      describe,
      createBookmark,
      moveBookmark,
      fetchRemote,
      pushBookmark,
      listRemotes,
      listLocalBookmarks,
      localBookmarksError,
      remoteError,
      connState,
      forceReconnect,
      screenState,
      diffState,
      busyAction,
      selectedPaths,
      setSelectedPaths,
      commitMessage,
      setCommitMessage,
      refresh,
      readDiff,
      commit,
      updateStale,
      mutationUncertain,
      mutationError
    }),
    [
      busyAction,
      client,
      localBookmarks,
      remotes,
      metadataError,
      describe,
      createBookmark,
      moveBookmark,
      fetchRemote,
      pushBookmark,
      listRemotes,
      listLocalBookmarks,
      localBookmarksError,
      remoteError,
      commit,
      commitMessage,
      connState,
      diffState,
      forceReconnect,
      mutationError,
      mutationUncertain,
      readDiff,
      refresh,
      screenState,
      selectedPaths,
      updateStale
    ]
  )
}
