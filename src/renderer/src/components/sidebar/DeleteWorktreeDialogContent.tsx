import React from 'react'
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { AppState } from '@/store/types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { DeleteWorktreeLineageNotice } from './DeleteWorktreeLineageNotice'
import { DeleteWorktreeSkipConfirmOption } from './DeleteWorktreeSkipConfirmOption'
import { DeleteWorktreeDialogFooter } from './DeleteWorktreeDialogFooter'
import { DeleteWorktreeDialogDescription } from './DeleteWorktreeDialogDescription'
import { DeleteWorktreeTargetPreview } from './DeleteWorktreeTargetPreview'
import { DeleteWorktreeWarningPanels } from './DeleteWorktreeWarningPanels'

type LineageDelete = {
  descendants: readonly Worktree[]
  deleteAllTargets: readonly Worktree[]
}

type DeleteCopy = {
  targetClassName: string
  targetLabel: string | undefined
  descriptionSuffix: string
  mainWorktreeBlocker: string
}

type LineageDeleteCopy = {
  childTargetLabel: string
  descriptionSuffix: string
}

export function DeleteWorktreeDialogContent({
  isMainWorktree,
  isBatchDelete,
  isJjWorkspaceDelete,
  isDeleting,
  canForceDelete,
  canDeleteAllLineage,
  worktree,
  worktrees,
  allWorktrees,
  hostLabelById,
  deleteStateByWorktreeId,
  dirtyChangeCountsByWorktreeId,
  deleteError,
  deleteCopy,
  lineageDelete,
  lineageDeleteCopy,
  allowSkipConfirm,
  dontAskAgain,
  onToggleDontAskAgain,
  onCancel,
  onForceDelete,
  onDelete,
  onJjForget,
  onJjForgetAndDelete,
  confirmButtonRef
}: {
  isMainWorktree: boolean
  isBatchDelete: boolean
  isJjWorkspaceDelete: boolean
  isDeleting: boolean
  canForceDelete: boolean
  canDeleteAllLineage: boolean
  worktree: Worktree | null
  worktrees: readonly Worktree[]
  allWorktrees: readonly Worktree[]
  hostLabelById: ReadonlyMap<ExecutionHostId, string>
  deleteStateByWorktreeId: AppState['deleteStateByWorktreeId']
  dirtyChangeCountsByWorktreeId: ReadonlyMap<string, number>
  deleteError: string | null
  deleteCopy: DeleteCopy
  lineageDelete: LineageDelete
  lineageDeleteCopy: LineageDeleteCopy
  allowSkipConfirm: boolean
  dontAskAgain: boolean
  onToggleDontAskAgain: () => void
  onCancel: () => void
  onForceDelete: () => void
  onDelete: () => void
  onJjForget: () => void
  onJjForgetAndDelete: () => void
  confirmButtonRef: React.RefObject<HTMLButtonElement | null>
}): React.JSX.Element {
  return (
    <DialogContent
      className="max-w-md"
      onOpenAutoFocus={(event) => {
        if (isMainWorktree) {
          return
        }
        event.preventDefault()
        confirmButtonRef.current?.focus()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-sm">
          {isBatchDelete
            ? translate(
                'auto.components.sidebar.DeleteWorktreeDialog.86f0ae1257',
                'Delete Workspaces'
              )
            : translate(
                'auto.components.sidebar.DeleteWorktreeDialog.fc23c4cbdf',
                'Delete Workspace'
              )}
        </DialogTitle>
        <DeleteWorktreeDialogDescription
          targetClassName={deleteCopy.targetClassName}
          targetLabel={deleteCopy.targetLabel}
          isJjWorkspaceDelete={isJjWorkspaceDelete}
          canDeleteAllLineage={canDeleteAllLineage}
          childTargetLabel={lineageDeleteCopy.childTargetLabel}
          descriptionSuffix={
            canDeleteAllLineage ? lineageDeleteCopy.descriptionSuffix : deleteCopy.descriptionSuffix
          }
        />
      </DialogHeader>

      <DeleteWorktreeTargetPreview
        isBatchDelete={isBatchDelete}
        worktree={worktree}
        worktrees={worktrees}
        collisionWorktrees={allWorktrees}
        hostLabelById={hostLabelById}
        deleteStateByWorktreeId={deleteStateByWorktreeId}
        dirtyChangeCountsByWorktreeId={dirtyChangeCountsByWorktreeId}
      />

      {lineageDelete.descendants.length > 0 && (
        <DeleteWorktreeLineageNotice
          descendants={lineageDelete.descendants}
          dirtyChangeCountsByWorktreeId={dirtyChangeCountsByWorktreeId}
        />
      )}

      <DeleteWorktreeWarningPanels
        isMainWorktree={isMainWorktree}
        mainWorktreeBlocker={deleteCopy.mainWorktreeBlocker}
        deleteError={deleteError}
      />

      {isJjWorkspaceDelete && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-muted-foreground">
          Forget and delete permanently removes the directory, including ignored and
          untracked-excluded files. Forget registration only removes the JJ workspace registration
          and leaves all files on disk.
        </div>
      )}

      <DeleteWorktreeSkipConfirmOption
        showDontAskAgain={!isMainWorktree && allowSkipConfirm && !canForceDelete}
        dontAskAgain={dontAskAgain}
        onToggleDontAskAgain={onToggleDontAskAgain}
      />

      <DialogFooter>
        <DeleteWorktreeDialogFooter
          isMainWorktree={isMainWorktree}
          isDeleting={isDeleting}
          canForceDelete={canForceDelete}
          isJjWorkspaceDelete={isJjWorkspaceDelete}
          isBatchDelete={isBatchDelete}
          worktreeCount={worktrees.length}
          canDeleteAllLineage={canDeleteAllLineage}
          lineageDeleteTargetCount={lineageDelete.deleteAllTargets.length}
          onCancel={onCancel}
          onForceDelete={onForceDelete}
          onDelete={onDelete}
          onJjForget={onJjForget}
          onJjForgetAndDelete={onJjForgetAndDelete}
          confirmButtonRef={confirmButtonRef}
        />
      </DialogFooter>
    </DialogContent>
  )
}
