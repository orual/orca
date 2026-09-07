import { DialogDescription } from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'

export function DeleteWorktreeDialogDescription({
  targetClassName,
  targetLabel,
  isJjWorkspaceDelete,
  canDeleteAllLineage,
  childTargetLabel,
  descriptionSuffix
}: {
  targetClassName: string
  targetLabel: string | undefined
  isJjWorkspaceDelete: boolean
  canDeleteAllLineage: boolean
  childTargetLabel: string
  descriptionSuffix: string
}): React.JSX.Element {
  return (
    <DialogDescription className="text-xs">
      {isJjWorkspaceDelete ? (
        <>
          {translate('auto.components.sidebar.DeleteWorktreeDialog.jjForget', 'Forget')}{' '}
          <span className={targetClassName}>{targetLabel}</span>
          {translate(
            'auto.components.sidebar.DeleteWorktreeDialog.jjDirectoryChoice',
            "'s JJ workspace registration and choose whether to keep or delete its directory."
          )}
        </>
      ) : (
        <>
          {translate('auto.components.sidebar.DeleteWorktreeDialog.91492c9ad6', 'Remove')}{' '}
          <span className={targetClassName}>{targetLabel}</span>
          {canDeleteAllLineage ? (
            <>
              {' '}
              {translate('auto.components.sidebar.DeleteWorktreeDialog.ff2a74ac0e', 'and')}{' '}
              <span className="font-medium text-foreground">{childTargetLabel}</span>{' '}
              {descriptionSuffix}
            </>
          ) : (
            <> {descriptionSuffix}</>
          )}
        </>
      )}
    </DialogDescription>
  )
}
