import type { JSX, Ref } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export function DeleteWorktreeDialogFooter({
  isMainWorktree,
  isDeleting,
  canForceDelete,
  isJjWorkspaceDelete,
  isBatchDelete,
  worktreeCount,
  canDeleteAllLineage,
  lineageDeleteTargetCount,
  onCancel,
  onForceDelete,
  onDelete,
  onJjForget,
  onJjForgetAndDelete,
  confirmButtonRef
}: {
  isMainWorktree: boolean
  isDeleting: boolean
  canForceDelete: boolean
  isJjWorkspaceDelete: boolean
  isBatchDelete: boolean
  worktreeCount: number
  canDeleteAllLineage: boolean
  lineageDeleteTargetCount: number
  onCancel: () => void
  onForceDelete: () => void
  onDelete: () => void
  onJjForget: () => void
  onJjForgetAndDelete: () => void
  confirmButtonRef: Ref<HTMLButtonElement>
}): JSX.Element {
  const label = isDeleting
    ? canForceDelete
      ? 'Force Deleting...'
      : 'Deleting...'
    : isBatchDelete
      ? `Delete ${worktreeCount} Workspaces`
      : canDeleteAllLineage
        ? `Delete ${lineageDeleteTargetCount} Workspaces`
        : canForceDelete
          ? 'Force Delete'
          : 'Delete Workspace'

  return (
    <>
      <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
        {isMainWorktree
          ? translate('auto.components.sidebar.DeleteWorktreeDialogFooter.cf95e3b5bb', 'Close')
          : translate('auto.components.sidebar.DeleteWorktreeDialogFooter.c0e972d726', 'Cancel')}
      </Button>
      {!isMainWorktree &&
        (isJjWorkspaceDelete ? (
          <div className="delete-worktree-dialog-jj-actions flex min-w-0 flex-1 flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onJjForget} disabled={isDeleting}>
              Forget registration
            </Button>
            <Button
              ref={confirmButtonRef}
              variant="destructive"
              onClick={onJjForgetAndDelete}
              disabled={isDeleting}
            >
              {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 />}
              Forget and delete directory
            </Button>
          </div>
        ) : (
          <Button
            ref={confirmButtonRef}
            variant="destructive"
            onClick={canForceDelete ? onForceDelete : onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 />}
            {label}
          </Button>
        ))}
    </>
  )
}
