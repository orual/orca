import { useCallback, useRef, useState } from 'react'
import type {
  JjBookmarkMutationResult,
  JjCommitIntent,
  JjCommitResult,
  JjDescribeResult,
  JjRemoteFetchResult,
  JjRemotePushResult,
  JjWorkspaceStaleRecoveryResult
} from '../../../src/shared/jj-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import {
  createMobileJjBookmark,
  describeMobileJj,
  fetchMobileJjRemote,
  moveMobileJjBookmark,
  pushMobileJjBookmark
} from './mobile-jj-client'
import type { MobileJjIdentity, MobileJjScreenState } from './mobile-jj-source-control-types'
import {
  runMobileJjCommit,
  runMobileJjMutation,
  runMobileJjStaleRecovery,
  sameMobileJjIdentity,
  type MobileJjMutationRuntime,
  type MobileJjMutationState
} from './mobile-jj-mutation-domain'

export function useMobileJjMutations(args: {
  client: RpcClient | null
  connState: ConnectionState
  identity: MobileJjIdentity
  identityRef: { current: MobileJjIdentity }
  mountedRef: { current: boolean }
  screenState: MobileJjScreenState
  setScreenState: (next: MobileJjScreenState) => void
  commitMessage: string
  setCommitMessage: (message: string) => void
  selectedPaths: readonly string[]
  refresh: () => Promise<boolean>
}): {
  busyAction: string | null
  mutationUncertain: boolean
  mutationError: string | null
  commit: (intent?: JjCommitIntent) => Promise<JjCommitResult | null>
  updateStale: () => Promise<JjWorkspaceStaleRecoveryResult | null>
  reconcile: () => void
  describe: (message: string) => Promise<JjDescribeResult | null>
  createBookmark: (name: string) => Promise<JjBookmarkMutationResult | null>
  moveBookmark: (name: string) => Promise<JjBookmarkMutationResult | null>
  fetchRemote: (remote: string) => Promise<JjRemoteFetchResult | null>
  pushBookmark: (remote: string, bookmark: string) => Promise<JjRemotePushResult | null>
} {
  const {
    client,
    connState,
    identity,
    identityRef,
    mountedRef,
    screenState,
    setScreenState,
    commitMessage,
    setCommitMessage,
    selectedPaths,
    refresh
  } = args
  const [mutationState, setMutationState] = useState<MobileJjMutationState>(() => ({
    identity,
    busyAction: null,
    uncertain: false,
    error: null
  }))
  const mutationRef = useRef(Promise.resolve())
  const mutationBusyRef = useRef(false)
  const mutationUncertainRef = useRef(false)
  const mutationIdentityRef = useRef(identity)
  const operationGenerationRef = useRef(0)
  if (!sameMobileJjIdentity(mutationIdentityRef.current, identity)) {
    mutationIdentityRef.current = identity
    operationGenerationRef.current += 1
    mutationRef.current = Promise.resolve()
    mutationBusyRef.current = false
    mutationUncertainRef.current = false
    setMutationState({ identity, busyAction: null, uncertain: false, error: null })
  }
  const busyAction = sameMobileJjIdentity(mutationState.identity, identity)
    ? mutationState.busyAction
    : null
  const mutationUncertain = sameMobileJjIdentity(mutationState.identity, identity)
    ? mutationState.uncertain
    : false
  const mutationError = sameMobileJjIdentity(mutationState.identity, identity)
    ? mutationState.error
    : null
  const setBusyAction = (next: string | null) =>
    setMutationState((previous) => ({ ...previous, busyAction: next }))
  const setMutationUncertain = (next: boolean) =>
    setMutationState((previous) => ({ ...previous, uncertain: next }))
  const setMutationError = (next: string | null) =>
    setMutationState((previous) => ({ ...previous, error: next }))

  const enqueue = useCallback(<T>(action: () => Promise<T>): Promise<T> => {
    const run = mutationRef.current.then(action, action)
    mutationRef.current = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }, [])

  const runtime: MobileJjMutationRuntime = {
    client,
    connState,
    identity,
    identityRef,
    mountedRef,
    operationGenerationRef,
    mutationBusyRef,
    mutationUncertainRef,
    screenState,
    commitMessage,
    selectedPaths,
    enqueue,
    setBusyAction,
    setMutationUncertain,
    setMutationError,
    setCommitMessage,
    setScreenState,
    refresh
  }

  const commit = useCallback(
    (intent?: JjCommitIntent) => runMobileJjCommit(runtime, intent),
    [runtime]
  )

  const runMutation = useCallback(
    <
      T extends
        | JjDescribeResult
        | JjBookmarkMutationResult
        | JjRemoteFetchResult
        | JjRemotePushResult
    >(
      action: string,
      operation: (commitId: string) => Promise<T>
    ) => runMobileJjMutation(runtime, action, operation),
    [runtime]
  )

  const describe = useCallback(
    (message: string) =>
      runMutation('describe', (commitId) =>
        describeMobileJj(identity.client as RpcClient, identity.worktreeId, {
          expectedCommitId: commitId,
          message: message.trim()
        })
      ),
    [identity, runMutation]
  )
  const createBookmark = useCallback(
    (name: string) =>
      runMutation('create-bookmark', (commitId) =>
        createMobileJjBookmark(identity.client as RpcClient, identity.worktreeId, {
          expectedCommitId: commitId,
          name
        })
      ),
    [identity, runMutation]
  )
  const moveBookmark = useCallback(
    (name: string) =>
      runMutation('move-bookmark', (commitId) =>
        moveMobileJjBookmark(identity.client as RpcClient, identity.worktreeId, {
          expectedCommitId: commitId,
          name
        })
      ),
    [identity, runMutation]
  )
  const fetchRemote = useCallback(
    (remote: string) =>
      runMutation('fetch-remote', () =>
        fetchMobileJjRemote(identity.client as RpcClient, identity.worktreeId, { remote })
      ),
    [identity, runMutation]
  )
  const pushBookmark = useCallback(
    (remote: string, bookmark: string) =>
      runMutation('push-bookmark', () =>
        pushMobileJjBookmark(identity.client as RpcClient, identity.worktreeId, {
          remote,
          bookmark
        })
      ),
    [identity, runMutation]
  )

  const reconcile = useCallback(() => {
    if (!mutationUncertainRef.current) {
      return
    }
    mutationUncertainRef.current = false
    setMutationUncertain(false)
    setMutationError(null)
  }, [])

  const updateStale = useCallback(() => runMobileJjStaleRecovery(runtime), [runtime])

  return {
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
  }
}
