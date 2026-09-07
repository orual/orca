import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { notifyEditorExternalFileChange } from '../../../editor/editor-autosave'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { useJjChangesPanelState } from './use-jj-changes-panel-state'
import { useJjChangesPanelFileOpening } from './use-jj-changes-panel-file-opening'
import { JjChangesPanelHeader } from './jj-changes-panel-header'
import { JjChangesPanelChangeList } from './jj-changes-panel-change-list'
import { JjChangesPanelRemoteDialog } from './jj-changes-panel-remote-dialog'

export function JjChangesPanel({
  worktreeId,
  worktreePath
}: {
  worktreeId: string
  worktreePath: string
}): JSX.Element {
  const model = useJjChangesPanelState()
  const confirm = useConfirmationDialog()
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [commitMessage, setCommitMessage] = useState('')
  const [bookmarkName, setBookmarkName] = useState('')
  const [selectedBookmark, setSelectedBookmark] = useState('')
  const [selectedPushBookmark, setSelectedPushBookmark] = useState('')
  const [remoteDialog, setRemoteDialog] = useState<'fetch' | 'push' | null>(null)
  const [remoteOptions, setRemoteOptions] = useState<{ name: string; url: string }[]>([])
  const [remoteStatus, setRemoteStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [selectedRemote, setSelectedRemote] = useState('')
  const draftContextRef = useRef<string | null>(null)
  const draftEditedRef = useRef(false)
  const visibleSelectedPaths = useMemo(
    () =>
      new Set(
        model.state.changes
          .filter((change) => selectedPaths.has(change.path))
          .map((change) => change.path)
      ),
    [model.state.changes, selectedPaths]
  )
  const fileOpening = useJjChangesPanelFileOpening(worktreeId, worktreePath, model.readDiff)

  useEffect(() => {
    if (!model.localBookmarks.some((bookmark) => bookmark.name === selectedBookmark)) {
      setSelectedBookmark(model.localBookmarks[0]?.name ?? '')
    }
  }, [model.localBookmarks, selectedBookmark])

  const metadataIsCurrent = model.metadataContextKey === model.contextKey && model.metadata !== null
  const commitDisabled =
    !model.context ||
    !metadataIsCurrent ||
    model.metadataStatus !== 'ready' ||
    model.isCommitting ||
    model.isMutating ||
    model.isRecoveringStaleWorkspace ||
    model.isRemoteMutating ||
    model.state.status === 'error' ||
    model.mutationError?.kind === 'uncertain' ||
    model.commitError?.kind === 'uncertain' ||
    model.staleRecoveryError?.kind === 'uncertain'
  const mutationDisabled =
    !model.context ||
    !metadataIsCurrent ||
    model.metadataStatus !== 'ready' ||
    model.metadata?.conflicted === true ||
    model.isMutating ||
    model.isCommitting ||
    model.isRecoveringStaleWorkspace ||
    model.isRemoteMutating ||
    model.mutationError?.kind === 'uncertain' ||
    model.staleRecoveryError?.kind === 'uncertain'
  const hasMessage = commitMessage.trim().length > 0

  useEffect(() => {
    if (draftContextRef.current !== model.contextKey) {
      draftContextRef.current = model.contextKey
      draftEditedRef.current = false
      setCommitMessage(metadataIsCurrent ? (model.metadata?.description ?? '') : '')
      setSelectedPaths(new Set())
    } else if (
      !draftEditedRef.current &&
      metadataIsCurrent &&
      model.metadata?.description !== commitMessage
    ) {
      setCommitMessage(model.metadata.description)
    }
  }, [commitMessage, metadataIsCurrent, model.contextKey, model.metadata])

  const submitCommit = useCallback(
    async (intent: 'all' | 'selected'): Promise<void> => {
      if (commitDisabled || !model.metadata || !hasMessage) {
        return
      }
      const paths = [...visibleSelectedPaths]
      if (intent === 'selected' && paths.length === 0) {
        return
      }
      const result = await model.commit({
        expectedCommitId: model.metadata.commitId,
        message: commitMessage,
        intent: intent === 'all' ? { kind: 'all' } : { kind: 'selected', paths }
      })
      if (result.ok) {
        draftEditedRef.current = false
        setSelectedPaths(new Set())
        const changedPaths =
          intent === 'selected' ? paths : model.state.changes.map((change) => change.path)
        for (const relativePath of changedPaths) {
          notifyEditorExternalFileChange({ worktreeId, worktreePath, relativePath })
        }
      }
    },
    [
      commitDisabled,
      commitMessage,
      hasMessage,
      model,
      visibleSelectedPaths,
      worktreeId,
      worktreePath
    ]
  )

  const submitDescribe = useCallback(async (): Promise<void> => {
    if (mutationDisabled || model.metadata === null) {
      return
    }
    const result = await model.describe({
      expectedCommitId: model.metadata.commitId,
      message: commitMessage
    })
    if (result.ok) {
      draftEditedRef.current = false
    }
  }, [commitMessage, model, mutationDisabled])

  const submitCreateBookmark = useCallback(async (): Promise<void> => {
    const name = bookmarkName.trim()
    if (mutationDisabled || model.metadata === null || !name) {
      return
    }
    const accepted = await confirm({
      title: 'Create local bookmark?',
      description: `Create "${name}" at the current change?`,
      confirmLabel: 'Create'
    })
    if (accepted) {
      const result = await model.createBookmark({ expectedCommitId: model.metadata.commitId, name })
      if (result.ok) {
        setBookmarkName('')
      }
    }
  }, [bookmarkName, confirm, model, mutationDisabled])

  const openRemoteDialog = useCallback(
    async (kind: 'fetch' | 'push'): Promise<void> => {
      if (model.isRemoteMutating || !model.context) {
        return
      }
      setRemoteDialog(kind)
      setRemoteStatus('loading')
      setSelectedRemote('')
      setSelectedPushBookmark('')
      try {
        const result = await model.listRemotes()
        if (!result.ok) {
          setRemoteStatus('error')
          return
        }
        setRemoteOptions(result.remotes)
        setRemoteStatus('idle')
      } catch {
        setRemoteStatus('error')
      }
    },
    [model]
  )

  const submitRemote = useCallback(async (): Promise<void> => {
    if (
      !remoteDialog ||
      !selectedRemote ||
      model.isRemoteMutating ||
      model.remoteError?.kind === 'uncertain'
    ) {
      return
    }
    if (remoteDialog === 'fetch') {
      setRemoteDialog(null)
      await model.fetchRemote({ remote: selectedRemote })
      return
    }
    if (!selectedPushBookmark) {
      return
    }
    const accepted = await confirm({
      title: 'Push bookmark?',
      description: `Push the exact bookmark "${selectedPushBookmark}" to remote "${selectedRemote}"?`,
      confirmLabel: 'Push'
    })
    if (accepted) {
      setRemoteDialog(null)
      await model.pushBookmark({ remote: selectedRemote, bookmark: selectedPushBookmark })
    }
  }, [confirm, model, remoteDialog, selectedPushBookmark, selectedRemote])

  const submitMoveBookmark = useCallback(async (): Promise<void> => {
    if (mutationDisabled || model.metadata === null || !selectedBookmark) {
      return
    }
    const accepted = await confirm({
      title: 'Move local bookmark?',
      description: `Move "${selectedBookmark}" to the current change? jj will refuse a non-forward move.`,
      confirmLabel: 'Move'
    })
    if (accepted) {
      await model.moveBookmark({
        expectedCommitId: model.metadata.commitId,
        name: selectedBookmark
      })
    }
  }, [confirm, model, mutationDisabled, selectedBookmark])

  const header = (
    <JjChangesPanelHeader
      model={model}
      commitMessage={commitMessage}
      bookmarkName={bookmarkName}
      selectedBookmark={selectedBookmark}
      visibleSelectedCount={visibleSelectedPaths.size}
      remainingCount={Math.max(model.state.changes.length - visibleSelectedPaths.size, 0)}
      onCommitMessageChange={(message) => {
        draftEditedRef.current = true
        setCommitMessage(message)
      }}
      onBookmarkNameChange={setBookmarkName}
      onSelectedBookmarkChange={setSelectedBookmark}
      onCommit={(intent) => void submitCommit(intent)}
      onDescribe={() => void submitDescribe()}
      onCreateBookmark={() => void submitCreateBookmark()}
      onMoveBookmark={() => void submitMoveBookmark()}
      onOpenRemoteDialog={(kind) => void openRemoteDialog(kind)}
    />
  )

  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
      {header}
      {model.state.status === 'loading' && model.state.changes.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {translate(
            'auto.components.right.sidebar.SourceControl.jj.loadingChanges',
            'Loading Jujutsu changes…'
          )}
        </div>
      ) : model.state.status === 'error' ? (
        <div className="space-y-3 px-4 py-6" role="alert">
          <div className="flex items-start gap-2 text-sm font-medium text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {translate(
              'auto.components.right.sidebar.SourceControl.jj.changesUnavailable',
              'Jujutsu changes unavailable'
            )}
          </div>
          <div className="text-xs text-muted-foreground">{model.state.error}</div>
          {!model.canRecoverStaleWorkspace ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void model.refresh({ force: true })}
            >
              <RefreshCw />
              {translate('auto.components.right.sidebar.SourceControl.jj.retry', 'Retry')}
            </Button>
          ) : null}
        </div>
      ) : model.state.changes.length === 0 ? (
        <div className="px-4 py-6">
          <div className="text-sm font-medium text-foreground">
            {translate(
              'auto.components.right.sidebar.SourceControl.jj.noChanges',
              'No Jujutsu changes'
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.SourceControl.jj.cleanChanges',
              'The current change is clean against its parent revisions.'
            )}
          </div>
        </div>
      ) : (
        <JjChangesPanelChangeList
          changes={model.state.changes}
          selectedPaths={visibleSelectedPaths}
          commitDisabled={commitDisabled}
          parentsByPath={fileOpening.parentsByPath}
          selectedParentByPath={fileOpening.selectedParentByPath}
          openingPath={fileOpening.openingPath}
          readErrorsByPath={fileOpening.readErrorsByPath}
          onTogglePath={(path, checked) => {
            setSelectedPaths((current) => {
              const next = new Set(current)
              if (checked) {
                next.add(path)
              } else {
                next.delete(path)
              }
              return next
            })
          }}
          onOpenChange={(change) => void fileOpening.openChange(change)}
          onSelectParent={fileOpening.selectParent}
        />
      )}
      <JjChangesPanelRemoteDialog
        kind={remoteDialog}
        options={remoteOptions}
        status={remoteStatus}
        selectedRemote={selectedRemote}
        selectedPushBookmark={selectedPushBookmark}
        localBookmarks={model.localBookmarks}
        isRemoteMutating={model.isRemoteMutating}
        remoteError={model.remoteError}
        onOpenChange={(open) => {
          if (!open && !model.isRemoteMutating) {
            setRemoteDialog(null)
          }
        }}
        onRemoteChange={setSelectedRemote}
        onBookmarkChange={setSelectedPushBookmark}
        onSubmit={() => void submitRemote()}
      />
    </div>
  )
}
