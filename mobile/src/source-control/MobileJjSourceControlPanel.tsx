import { useEffect, useMemo, useRef, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ConfirmModal } from '../components/ConfirmModal'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { MobileJjBookmarkSheet, type MobileJjBookmark } from './MobileJjBookmarkSheet'
import { buildMobileJjSourceControlActions } from './mobile-jj-source-control-actions'
import { MobileJjRemoteSheet, type MobileJjRemote } from './MobileJjRemoteSheet'
import { colors } from '../theme/mobile-theme'
import type {
  JjCommitIntent,
  JjLocalBookmarksResult,
  JjRemoteListResult
} from '../../../src/shared/jj-types'
import { useMobileJjSourceControlState } from './use-mobile-jj-source-control-state'
import type { MobileJjSourceControlState } from './use-mobile-jj-source-control-state'
import { MobileJjSourceControlHeader } from './MobileJjSourceControlHeader'
import { MobileJjWorkspaceContent } from './MobileJjWorkspaceContent'
import { MobileJjWorkspaceState } from './MobileJjWorkspaceState'

const styles = { container: { flex: 1, backgroundColor: colors.bgBase } }

type Props = {
  hostId: string
  worktreeId: string
  name?: string
  onRequestClose?: () => void
}

type ExpandedJjActions = {
  localBookmarks?: MobileJjBookmark[]
  localBookmarksError?: string | null
  bookmarksError?: string | null
  describe?: (message: string) => Promise<unknown> | void
  createBookmark?: (name: string) => Promise<unknown> | void
  moveBookmark?: (name: string) => Promise<unknown> | void
  listLocalBookmarks?: () => Promise<JjLocalBookmarksResult>
  listRemotes?: () => Promise<JjRemoteListResult>
  fetchRemote?: (remote: string) => Promise<unknown> | void
  pushBookmark?: (remote: string, bookmark: string) => Promise<unknown> | void
  remoteError?: string | null
  mutationError?: string | null
}

export function MobileJjSourceControlPanel({
  hostId,
  worktreeId,
  name = '',
  onRequestClose
}: Props) {
  const router = useRouter()
  const state = useMobileJjSourceControlState({ hostId, worktreeId })
  const expanded = state as MobileJjSourceControlState & ExpandedJjActions
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [bookmarkSheet, setBookmarkSheet] = useState(false)
  const [bookmarksLoading, setBookmarksLoading] = useState(false)
  const [bookmarkLoadError, setBookmarkLoadError] = useState<string | null>(null)
  const [bookmarkMutationError, setBookmarkMutationError] = useState<string | null>(null)
  const [remoteKind, setRemoteKind] = useState<'fetch' | 'push' | null>(null)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteLoadError, setRemoteLoadError] = useState<string | null>(null)
  const [remoteMutationError, setRemoteMutationError] = useState<string | null>(null)
  const [remotes, setRemotes] = useState<MobileJjRemote[]>([])
  const [selectedRemote, setSelectedRemote] = useState('')
  const [selectedBookmark, setSelectedBookmark] = useState('')
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    label: string
    run: () => void
  } | null>(null)
  const [parentRevision, setParentRevision] = useState<string | undefined>()
  const [availableParents, setAvailableParents] = useState<string[]>([])
  const draftContextRef = useRef<string | null>(null)
  const draftEditedRef = useRef(false)
  const changes = state.screenState.kind === 'ready' ? state.screenState.changes : []
  const metadata = state.screenState.kind === 'ready' ? state.screenState.metadata : null
  const diff = state.diffState.kind === 'ready' ? state.diffState.result : null
  const selectableParents = useMemo(
    () =>
      availableParents.length > 0
        ? availableParents
        : (diff?.parentDiffs?.map((entry) => entry.parentRevision) ?? []),
    [availableParents, diff]
  )
  useEffect(() => {
    if (diff?.parentDiffs && diff.parentDiffs.length > 1) {
      setAvailableParents(diff.parentDiffs.map((entry) => entry.parentRevision))
    }
  }, [diff])
  const visibleSelectedPaths = useMemo(
    () => state.selectedPaths.filter((path) => changes.some((change) => change.path === path)),
    [changes, state.selectedPaths]
  )
  const ioBusy = state.busyAction !== null || state.diffState.kind === 'loading'
  const mutationDisabled = ioBusy || state.mutationUncertain
  const onBack = onRequestClose ?? (() => router.back())
  const openBookmarks = async () => {
    setBookmarkSheet(true)
    setBookmarksLoading(true)
    setBookmarkLoadError(null)
    setBookmarkMutationError(null)
    try {
      const result = await expanded.listLocalBookmarks?.()
      if (result && !result.ok) {
        setBookmarkLoadError(result.message)
      }
    } catch (error) {
      setBookmarkLoadError(
        error instanceof Error ? error.message : 'Unable to load local bookmarks'
      )
    } finally {
      setBookmarksLoading(false)
    }
  }
  const openRemote = async (kind: 'fetch' | 'push') => {
    if (!expanded.listRemotes || state.mutationUncertain) {
      return
    }
    setRemoteKind(kind)
    setRemoteLoading(true)
    setRemoteLoadError(null)
    setRemoteMutationError(null)
    setSelectedRemote('')
    setSelectedBookmark('')
    try {
      const result = await expanded.listRemotes()
      if (result.ok) {
        setRemotes(result.remotes)
      } else {
        setRemotes([])
        setRemoteLoadError(result.message)
      }
    } catch (error) {
      setRemotes([])
      setRemoteLoadError(error instanceof Error ? error.message : 'Unable to load remotes')
    } finally {
      setRemoteLoading(false)
    }
  }
  const handleCommit = async (kind: 'all' | 'selected') => {
    const intent: JjCommitIntent =
      kind === 'all' ? { kind: 'all' } : { kind: 'selected', paths: [...visibleSelectedPaths] }
    if (kind === 'selected' && visibleSelectedPaths.length === 0) {
      return
    }
    const result = await state.commit(intent)
    if (result?.ok) {
      draftEditedRef.current = false
    }
  }
  const handleDescribe = async () => {
    if (!expanded.describe || state.mutationUncertain) {
      return
    }
    const result = await expanded.describe(state.commitMessage)
    if (result && typeof result === 'object' && 'ok' in result && result.ok) {
      draftEditedRef.current = false
    }
  }
  const handleRemoteMutation = async (
    kind: 'fetch' | 'push',
    remote: string,
    bookmark?: string
  ) => {
    setRemoteMutationError(null)
    try {
      const result =
        kind === 'fetch'
          ? await expanded.fetchRemote?.(remote)
          : await expanded.pushBookmark?.(remote, bookmark ?? '')
      if (!result || typeof result !== 'object' || !('ok' in result) || result.ok) {
        setRemoteKind(null)
      } else {
        setRemoteMutationError(
          'message' in result && typeof result.message === 'string'
            ? result.message
            : 'jj remote operation failed'
        )
      }
    } catch (error) {
      setRemoteMutationError(error instanceof Error ? error.message : 'jj remote operation failed')
    }
  }
  const togglePath = (path: string) => {
    state.setSelectedPaths(
      state.selectedPaths.includes(path)
        ? state.selectedPaths.filter((selected) => selected !== path)
        : [...state.selectedPaths, path]
    )
  }
  useEffect(() => {
    const contextKey = `${hostId}:${worktreeId}:${metadata?.commitId ?? ''}`
    if (draftContextRef.current !== contextKey) {
      draftContextRef.current = contextKey
      draftEditedRef.current = false
      state.setCommitMessage(metadata?.description ?? '')
    } else if (!draftEditedRef.current && state.commitMessage !== (metadata?.description ?? '')) {
      state.setCommitMessage(metadata?.description ?? '')
    }
  }, [hostId, metadata?.commitId, metadata?.description, state, worktreeId])

  const draftMessage = state.commitMessage
  const runBookmarkMutation = async (action: () => Promise<unknown> | void) => {
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        setBookmarkMutationError(
          'message' in result && typeof result.message === 'string'
            ? result.message
            : 'jj bookmark operation failed'
        )
      }
    } catch (error) {
      setBookmarkMutationError(
        error instanceof Error ? error.message : 'jj bookmark operation failed'
      )
    }
  }
  const mutationError = expanded.mutationError ?? null
  const bookmarkError =
    bookmarkLoadError ??
    bookmarkMutationError ??
    expanded.localBookmarksError ??
    expanded.bookmarksError ??
    mutationError
  const remoteError =
    remoteLoadError ?? remoteMutationError ?? expanded.remoteError ?? mutationError
  const actionSheetActions = buildMobileJjSourceControlActions({
    hasMessage: draftMessage.trim().length > 0,
    changeCount: changes.length,
    selectedCount: visibleSelectedPaths.length,
    busy: ioBusy,
    uncertain: state.mutationUncertain,
    canDescribe: Boolean(expanded.describe),
    handlers: {
      commitAll: () => void handleCommit('all'),
      commitSelected: () => void handleCommit('selected'),
      describe: () => void handleDescribe(),
      fetch: () => void openRemote('fetch'),
      push: () => void openRemote('push')
    }
  })

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <MobileJjSourceControlHeader
        name={name}
        worktreeId={worktreeId}
        workspaceName={metadata?.workspaceName ?? undefined}
        busy={ioBusy}
        onBack={onBack}
        onRefresh={() => void state.refresh({ reconcile: true })}
        onManageBookmarks={() => void openBookmarks()}
      />
      {state.screenState.kind !== 'ready' ? (
        <MobileJjWorkspaceState
          screenState={state.screenState}
          mutationError={state.mutationError}
          busy={ioBusy}
          uncertain={state.mutationUncertain}
          onRetry={() => void state.refresh()}
          onUpdate={() => void state.updateStale()}
        />
      ) : (
        <MobileJjWorkspaceContent
          metadata={metadata}
          changes={changes}
          selectedPaths={visibleSelectedPaths}
          selectableParents={selectableParents}
          parentRevision={parentRevision}
          diff={diff}
          message={draftMessage}
          selectedCount={visibleSelectedPaths.length}
          busy={ioBusy}
          uncertain={state.mutationUncertain}
          mutationError={mutationError}
          diffError={state.diffState.kind === 'error' ? state.diffState.message : undefined}
          onMessageChange={(message) => {
            draftEditedRef.current = true
            state.setCommitMessage(message)
          }}
          onCommit={(kind) => void handleCommit(kind)}
          onOpenActions={() => setShowActionSheet(true)}
          onTogglePath={togglePath}
          onOpenDiff={(path) => {
            setParentRevision(undefined)
            setAvailableParents([])
            void state.readDiff(path)
          }}
          onSelectParent={(parent) => {
            setParentRevision(parent)
            if (diff) {
              void state.readDiff(diff.path, parent)
            }
          }}
        />
      )}
      <ActionSheetModal
        visible={showActionSheet}
        title="Source Control"
        message={metadata?.workspaceName ?? name}
        actions={actionSheetActions}
        onClose={() => setShowActionSheet(false)}
      />
      <MobileJjBookmarkSheet
        visible={bookmarkSheet}
        bookmarks={metadata?.bookmarks ?? []}
        localBookmarks={expanded.localBookmarks ?? []}
        busy={ioBusy || state.mutationUncertain}
        loading={bookmarksLoading}
        error={bookmarkError}
        onClose={() => setBookmarkSheet(false)}
        onCreate={(bookmark) => {
          if (!mutationDisabled) {
            setConfirmAction({
              title: 'Create local bookmark?',
              message: `Create "${bookmark}" at the current change?`,
              label: 'Create',
              run: () => void runBookmarkMutation(() => expanded.createBookmark?.(bookmark))
            })
          }
        }}
        onMove={(bookmark) => {
          if (!mutationDisabled) {
            setConfirmAction({
              title: 'Move local bookmark?',
              message: `Move "${bookmark}" to the current change? jj will refuse a non-forward move.`,
              label: 'Move',
              run: () => void runBookmarkMutation(() => expanded.moveBookmark?.(bookmark))
            })
          }
        }}
      />
      <MobileJjRemoteSheet
        visible={remoteKind !== null}
        kind={remoteKind ?? 'fetch'}
        remotes={remotes}
        bookmarks={expanded.localBookmarks ?? []}
        selectedRemote={selectedRemote}
        selectedBookmark={selectedBookmark}
        busy={ioBusy || state.mutationUncertain}
        loading={remoteLoading}
        error={remoteError}
        onClose={() => setRemoteKind(null)}
        onRemote={setSelectedRemote}
        onBookmark={setSelectedBookmark}
        onSubmit={() => {
          if (mutationDisabled || remoteLoading || !selectedRemote) {
            return
          }
          if (remoteKind === 'fetch') {
            void handleRemoteMutation('fetch', selectedRemote)
            return
          }
          if (!selectedBookmark) {
            return
          }
          setConfirmAction({
            title: 'Push bookmark?',
            message: `Push the exact bookmark "${selectedBookmark}" to remote "${selectedRemote}"?`,
            label: 'Push',
            run: () => void handleRemoteMutation('push', selectedRemote, selectedBookmark)
          })
        }}
      />
      <ConfirmModal
        visible={confirmAction !== null}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message}
        confirmLabel={confirmAction?.label}
        onConfirm={() => {
          if (!state.mutationUncertain) {
            confirmAction?.run()
          }
          setConfirmAction(null)
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </SafeAreaView>
  )
}
