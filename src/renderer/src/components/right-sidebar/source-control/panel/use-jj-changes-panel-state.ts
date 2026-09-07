import { useEffect, useMemo, useRef, useState } from 'react'
import { getConnectionId } from '@/lib/connection-context'
import { getRepoOwnerRoutedSettings } from '@/lib/repo-runtime-owner'
import { installWindowVisibilityTimeoutPoller } from '@/lib/window-visibility-timeout-poller'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { isJjWorkspaceStaleFailure } from '../../../../../../shared/jj-types'
import type { JjLocalBookmark } from '../../../../../../shared/jj-types'
import type {
  JjChangesPanelModel,
  JjChangesPanelState,
  JjMetadataState
} from './jj-changes-panel-state-types'
import { useJjChangesPanelReadState } from './use-jj-changes-panel-state-read'
import { useJjChangesPanelCommitMutations } from './use-jj-changes-panel-state-mutations'
import { useJjChangesPanelRemoteMutations } from './use-jj-changes-panel-state-remote'
import { useJjChangesPanelStaleRecovery } from './use-jj-changes-panel-state-stale-recovery'

export type { JjChangesPanelModel } from './jj-changes-panel-state-types'

export function useJjChangesPanelState(): JjChangesPanelModel {
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const settings = useAppStore((s) => s.settings)
  const context = useMemo(() => {
    if (!activeWorktree?.path || !activeWorktree.id || !activeRepo) {
      return null
    }
    const ownerSettings = getRepoOwnerRoutedSettings(settings, activeRepo)
    return {
      settings: ownerSettings,
      worktreeId: activeWorktree.id,
      worktreePath: activeWorktree.path,
      connectionId: getConnectionId(activeWorktree.id) ?? undefined
    }
  }, [activeRepo, activeWorktree, settings])
  const contextKey = context
    ? `${context.worktreeId}::${context.worktreePath}::${context.connectionId ?? ''}::${context.settings?.activeRuntimeEnvironmentId ?? ''}`
    : 'unavailable'
  const [state, setState] = useState<JjChangesPanelState>({
    status: 'loading',
    changes: [],
    error: null
  })
  const [metadataState, setMetadataState] = useState<JjMetadataState>({
    status: 'loading',
    metadata: null,
    contextKey: null,
    error: null
  })
  const [localBookmarks, setLocalBookmarks] = useState<JjLocalBookmark[]>([])
  const [bookmarksStatus, setBookmarksStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [bookmarksError, setBookmarksError] = useState<string | null>(null)
  const contextGenerationRef = useRef(0)
  const readState = useJjChangesPanelReadState(context, contextKey, contextGenerationRef, {
    state,
    setState,
    metadataState,
    setMetadataState,
    localBookmarks,
    setLocalBookmarks,
    bookmarksStatus,
    setBookmarksStatus,
    bookmarksError,
    setBookmarksError
  })
  const { refresh, inFlightRefreshRef } = readState
  const commitMutations = useJjChangesPanelCommitMutations(
    context,
    contextKey,
    contextGenerationRef,
    refresh
  )
  const { reset: resetCommitMutations } = commitMutations
  const remoteMutations = useJjChangesPanelRemoteMutations(
    context,
    contextKey,
    contextGenerationRef,
    refresh
  )
  const { reset: resetRemoteMutations } = remoteMutations
  const staleRecovery = useJjChangesPanelStaleRecovery(context, contextGenerationRef, refresh)
  const { reset: resetStaleRecovery } = staleRecovery

  const canRecoverStaleWorkspace =
    (state.status === 'error' &&
      state.kind === 'stale' &&
      isJjWorkspaceStaleFailure({ kind: state.kind, message: state.error })) ||
    (metadataState.status === 'error' &&
      metadataState.kind === 'stale' &&
      metadataState.error !== null &&
      isJjWorkspaceStaleFailure({ kind: metadataState.kind, message: metadataState.error }))

  useEffect(() => {
    contextGenerationRef.current += 1
    inFlightRefreshRef.current?.controller.abort()
    inFlightRefreshRef.current = null
    resetCommitMutations()
    resetRemoteMutations()
    resetStaleRecovery()
    setState({ status: 'loading', changes: [], error: null })
    setMetadataState({ status: 'loading', metadata: null, contextKey: null, error: null })
    setLocalBookmarks([])
    setBookmarksStatus('loading')
    setBookmarksError(null)
    if (!context) {
      return
    }
    void refresh()
    return installWindowVisibilityTimeoutPoller({
      run: () => refresh(),
      getDelayMs: () => 5_000
    })
  }, [
    context,
    contextGenerationRef,
    contextKey,
    inFlightRefreshRef,
    refresh,
    resetCommitMutations,
    resetRemoteMutations,
    resetStaleRecovery
  ])

  useEffect(
    () => () => {
      contextGenerationRef.current += 1
      inFlightRefreshRef.current?.controller.abort()
      inFlightRefreshRef.current = null
      resetCommitMutations()
      resetRemoteMutations()
      resetStaleRecovery()
    },
    [
      contextGenerationRef,
      inFlightRefreshRef,
      resetCommitMutations,
      resetRemoteMutations,
      resetStaleRecovery
    ]
  )

  return {
    state,
    metadata: metadataState.metadata,
    metadataContextKey: metadataState.contextKey,
    metadataStatus: metadataState.status,
    metadataError: metadataState.error,
    localBookmarks,
    bookmarksStatus,
    bookmarksError,
    ...commitMutations,
    ...remoteMutations,
    ...staleRecovery,
    canRecoverStaleWorkspace,
    context,
    contextKey,
    refresh: readState.refresh,
    readDiff: readState.readDiff,
    listRemotes: readState.listRemotes
  }
}
