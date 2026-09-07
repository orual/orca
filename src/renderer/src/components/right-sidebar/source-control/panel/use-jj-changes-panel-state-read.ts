import { useCallback, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import {
  getRuntimeJjCurrentChangeMetadata,
  listRuntimeJjChanges,
  listRuntimeJjLocalBookmarks,
  listRuntimeJjRemotes,
  readRuntimeJjFileDiff
} from '@/runtime/runtime-jj-client'
import type {
  JjChangesResult,
  JjCurrentChangeMetadataResult,
  JjFileDiffResult,
  JjLocalBookmark,
  JjLocalBookmarksResult,
  JjRemoteListResult
} from '../../../../../../shared/jj-types'
import type {
  InFlightRefresh,
  JjChangesPanelContext,
  JjChangesPanelGeneration,
  JjChangesPanelRefresh,
  JjChangesPanelState,
  JjMetadataState,
  RefreshOptions
} from './jj-changes-panel-state-types'

function failureMessage(result: { message: string; kind: string }): string {
  return (
    result.message ||
    translate(
      'auto.components.right.sidebar.SourceControl.jj.failureKind',
      'Jujutsu is {{value0}}.',
      { value0: result.kind }
    )
  )
}

type ReadSnapshotState = {
  state: JjChangesPanelState
  setState: React.Dispatch<React.SetStateAction<JjChangesPanelState>>
  metadataState: JjMetadataState
  setMetadataState: React.Dispatch<React.SetStateAction<JjMetadataState>>
  localBookmarks: JjLocalBookmark[]
  setLocalBookmarks: React.Dispatch<React.SetStateAction<JjLocalBookmark[]>>
  bookmarksStatus: 'loading' | 'ready' | 'error'
  setBookmarksStatus: React.Dispatch<React.SetStateAction<'loading' | 'ready' | 'error'>>
  bookmarksError: string | null
  setBookmarksError: React.Dispatch<React.SetStateAction<string | null>>
}

export function useJjChangesPanelReadState(
  context: JjChangesPanelContext | null,
  contextKey: string,
  contextGenerationRef: JjChangesPanelGeneration,
  snapshot: ReadSnapshotState
): {
  refresh: JjChangesPanelRefresh
  readDiff: (
    path: string,
    parentRevision?: string,
    options?: { signal?: AbortSignal }
  ) => Promise<JjFileDiffResult>
  listRemotes: (options?: { signal?: AbortSignal }) => Promise<JjRemoteListResult>
  inFlightRefreshRef: React.MutableRefObject<InFlightRefresh | null>
} {
  const { setState, setMetadataState, setLocalBookmarks, setBookmarksStatus, setBookmarksError } =
    snapshot
  const inFlightRefreshRef = useRef<InFlightRefresh | null>(null)

  const refresh = useCallback(
    ({ force = false }: RefreshOptions = {}): Promise<void> => {
      if (!context) {
        setState({ status: 'loading', changes: [], error: null })
        setMetadataState({ status: 'loading', metadata: null, contextKey: null, error: null })
        return Promise.resolve()
      }
      const current = inFlightRefreshRef.current
      if (current?.contextKey === contextKey && !force) {
        return current.promise
      }
      current?.controller.abort()
      const generation = contextGenerationRef.current
      const controller = new AbortController()
      const request = {
        contextKey,
        generation,
        controller,
        promise: Promise.resolve()
      }
      const isCurrent = (): boolean =>
        contextGenerationRef.current === generation && inFlightRefreshRef.current === request
      setState((currentState) => ({
        status: 'loading',
        changes: currentState.changes,
        error: null
      }))
      setMetadataState((currentState) => ({
        status: 'loading',
        metadata: currentState.metadata,
        contextKey: currentState.contextKey,
        error: null
      }))
      inFlightRefreshRef.current = request
      const promise = (async (): Promise<void> => {
        const [changesResponse, metadataResponse, bookmarksResponse] = await Promise.allSettled([
          listRuntimeJjChanges(context, { signal: controller.signal }),
          getRuntimeJjCurrentChangeMetadata(context, { signal: controller.signal }),
          listRuntimeJjLocalBookmarks(context, { signal: controller.signal })
        ])
        if (!isCurrent()) {
          return
        }
        applyChangesResponse(changesResponse, controller, setState)
        applyMetadataResponse(metadataResponse, contextKey, controller, setMetadataState)
        applyBookmarksResponse(
          bookmarksResponse,
          controller,
          setLocalBookmarks,
          setBookmarksStatus,
          setBookmarksError
        )
        if (inFlightRefreshRef.current === request) {
          inFlightRefreshRef.current = null
        }
      })()
      request.promise = promise
      return promise
    },
    [
      context,
      contextGenerationRef,
      contextKey,
      setBookmarksError,
      setBookmarksStatus,
      setLocalBookmarks,
      setMetadataState,
      setState
    ]
  )

  const readDiff = useCallback(
    (
      path: string,
      parentRevision?: string,
      options?: { signal?: AbortSignal }
    ): Promise<JjFileDiffResult> => {
      if (!context) {
        return Promise.resolve({
          ok: false,
          kind: 'unavailable',
          message: translate(
            'auto.components.right.sidebar.SourceControl.jj.workspaceUnavailable',
            'Jujutsu workspace is unavailable.'
          )
        })
      }
      return readRuntimeJjFileDiff(context, { path, parentRevision }, options)
    },
    [context]
  )

  const listRemotes = useCallback(
    (options: { signal?: AbortSignal } = {}): Promise<JjRemoteListResult> => {
      if (!context) {
        return Promise.resolve({
          ok: false,
          kind: 'unavailable',
          message: translate(
            'auto.components.right.sidebar.SourceControl.jj.workspaceUnavailable',
            'Jujutsu workspace is unavailable.'
          )
        })
      }
      return listRuntimeJjRemotes(context, options)
    },
    [context]
  )

  return { refresh, readDiff, listRemotes, inFlightRefreshRef }
}

function applyChangesResponse(
  response: PromiseSettledResult<JjChangesResult>,
  controller: AbortController,
  setState: React.Dispatch<React.SetStateAction<JjChangesPanelState>>
): void {
  if (response.status === 'fulfilled') {
    const result = response.value
    if (result.ok) {
      setState({ status: 'ready', changes: result.changes, error: null })
    } else {
      setState((currentState) => ({
        status: 'error',
        changes: currentState.changes,
        error: failureMessage(result),
        kind: result.kind
      }))
    }
  } else if (!controller.signal.aborted) {
    setState((currentState) => ({
      status: 'error',
      changes: currentState.changes,
      error: response.reason instanceof Error ? response.reason.message : String(response.reason),
      kind: 'error'
    }))
  }
}

function applyMetadataResponse(
  response: PromiseSettledResult<JjCurrentChangeMetadataResult>,
  contextKey: string,
  controller: AbortController,
  setMetadataState: React.Dispatch<React.SetStateAction<JjMetadataState>>
): void {
  if (response.status === 'fulfilled') {
    const result = response.value
    if (result.ok) {
      setMetadataState({ status: 'ready', metadata: result.metadata, contextKey, error: null })
    } else {
      setMetadataState((currentState) => ({
        status: 'error',
        metadata: currentState.metadata,
        contextKey: currentState.contextKey,
        error: failureMessage(result),
        kind: result.kind
      }))
    }
  } else if (!controller.signal.aborted) {
    setMetadataState((currentState) => ({
      status: 'error',
      metadata: currentState.metadata,
      contextKey: currentState.contextKey,
      error: response.reason instanceof Error ? response.reason.message : String(response.reason),
      kind: 'error'
    }))
  }
}

function applyBookmarksResponse(
  response: PromiseSettledResult<JjLocalBookmarksResult>,
  controller: AbortController,
  setLocalBookmarks: ReadSnapshotState['setLocalBookmarks'],
  setBookmarksStatus: ReadSnapshotState['setBookmarksStatus'],
  setBookmarksError: ReadSnapshotState['setBookmarksError']
): void {
  if (response.status === 'fulfilled') {
    const result = response.value
    if (result.ok) {
      setLocalBookmarks(result.bookmarks)
      setBookmarksStatus('ready')
      setBookmarksError(null)
    } else {
      setBookmarksStatus('error')
      setBookmarksError(failureMessage(result))
    }
  } else if (!controller.signal.aborted) {
    setBookmarksStatus('error')
    setBookmarksError(
      response.reason instanceof Error ? response.reason.message : String(response.reason)
    )
  }
}
