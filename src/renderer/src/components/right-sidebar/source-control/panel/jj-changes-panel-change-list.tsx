import type { JSX } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DiffLineCounts } from '../listing/diff-line-counts'
import { dirname, basename } from '@/lib/path'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { translate } from '@/i18n/i18n'
import { STATUS_COLORS, STATUS_LABELS } from '../../status-display'
import type { JjChange } from '../../../../../../shared/jj-types'

function statusLabel(status: JjChange['status']): string {
  return status === 'conflicted' ? 'C' : STATUS_LABELS[status]
}

function statusColor(status: JjChange['status']): string {
  return STATUS_COLORS[status === 'conflicted' ? 'modified' : status]
}

type ChangeListProps = {
  changes: JjChange[]
  selectedPaths: Set<string>
  commitDisabled: boolean
  parentsByPath: Record<string, string[]>
  selectedParentByPath: Record<string, string>
  openingPath: string | null
  readErrorsByPath: Record<string, string>
  onTogglePath: (path: string, checked: boolean) => void
  onOpenChange: (change: JjChange) => void
  onSelectParent: (change: JjChange, parentRevision: string) => void
}

export function JjChangesPanelChangeList({
  changes,
  selectedPaths,
  commitDisabled,
  parentsByPath,
  selectedParentByPath,
  openingPath,
  readErrorsByPath,
  onTogglePath,
  onOpenChange,
  onSelectParent
}: ChangeListProps): JSX.Element {
  return (
    <>
      {changes.map((change) => {
        const parents = parentsByPath[change.path] ?? []
        const selectedParent = selectedParentByPath[change.path]
        const isSelected = selectedPaths.has(change.path)
        const FileIcon = getFileTypeIcon(change.path)
        const fileName = basename(change.path)
        const parentDir = dirname(change.path)
        const dirPath = parentDir === '.' ? '' : parentDir
        return (
          <div key={`${change.path}:${change.originalPath ?? ''}`}>
            <div className="flex min-w-0 items-center">
              <Checkbox
                checked={isSelected}
                disabled={commitDisabled}
                aria-label={`Select ${change.path}`}
                onCheckedChange={(checked) => onTogglePath(change.path, checked === true)}
                className="ml-3"
              />
              <Button
                type="button"
                variant="ghost"
                className="group h-auto min-h-7 min-w-0 flex-1 justify-start rounded-none px-2 py-1.5 text-left text-xs font-normal"
                onClick={() => onOpenChange(change)}
                disabled={openingPath === change.path}
              >
                <FileIcon
                  className="size-3.5 shrink-0"
                  style={{ color: statusColor(change.status) }}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-foreground">{fileName}</span>
                  {dirPath ? (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{dirPath}</span>
                  ) : null}
                  {change.originalPath ? (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {translate(
                        'auto.components.right.sidebar.SourceControl.jj.renamedFrom',
                        'renamed from {{value0}}',
                        { value0: change.originalPath }
                      )}
                    </span>
                  ) : null}
                </span>
                <DiffLineCounts added={change.stats?.added} removed={change.stats?.removed} />
                <span
                  className="w-4 shrink-0 text-center text-[10px] font-bold"
                  style={{ color: statusColor(change.status) }}
                >
                  {statusLabel(change.status)}
                </span>
                {openingPath === change.path ? <Loader2 className="size-3 animate-spin" /> : null}
              </Button>
            </div>
            {readErrorsByPath[change.path] ? (
              <div
                className="mb-2 ml-9 mr-3 rounded-md border border-destructive/25 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive"
                role="alert"
              >
                {translate(
                  'auto.components.right.sidebar.SourceControl.jj.diffReadError',
                  'Unable to read this Jujutsu diff: {{value0}}',
                  { value0: readErrorsByPath[change.path] }
                )}
              </div>
            ) : null}
            {parents.length > 1 ? (
              <div className="mb-2 ml-9 mr-3 rounded-md border border-border bg-muted/20 px-2 py-1.5">
                <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <TriangleAlert className="size-3" />
                  {translate(
                    'auto.components.right.sidebar.SourceControl.jj.chooseMergeParent',
                    'Choose merge parent'
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {parents.map((parentRevision) => (
                    <Button
                      type="button"
                      key={parentRevision}
                      variant={selectedParent === parentRevision ? 'secondary' : 'outline'}
                      size="xs"
                      onClick={() => onSelectParent(change, parentRevision)}
                    >
                      {parentRevision}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}
