import type { JSX } from 'react'
import {
  Bookmark,
  ChevronDown,
  Download,
  GitBranch,
  Loader2,
  RefreshCw,
  Upload
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { CommitActionMenu } from '../commit/commit-action-menu'
import { CommitMessageComposer } from '../commit/commit-message-composer'
import { CheckRunCopyButton } from '../../../editor/CheckRunCopyButton'
import { translate } from '@/i18n/i18n'
import type { JjChangesPanelModel } from './jj-changes-panel-state-types'

type HeaderProps = {
  model: JjChangesPanelModel
  commitMessage: string
  bookmarkName: string
  selectedBookmark: string
  visibleSelectedCount: number
  remainingCount: number
  onCommitMessageChange: (message: string) => void
  onBookmarkNameChange: (name: string) => void
  onSelectedBookmarkChange: (name: string) => void
  onCommit: (intent: 'all' | 'selected') => void
  onDescribe: () => void
  onCreateBookmark: () => void
  onMoveBookmark: () => void
  onOpenRemoteDialog: (kind: 'fetch' | 'push') => void
}

export function JjChangesPanelHeader({
  model,
  commitMessage,
  bookmarkName,
  selectedBookmark,
  visibleSelectedCount,
  remainingCount,
  onCommitMessageChange,
  onBookmarkNameChange,
  onSelectedBookmarkChange,
  onCommit,
  onDescribe,
  onCreateBookmark,
  onMoveBookmark,
  onOpenRemoteDialog
}: HeaderProps): JSX.Element {
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

  return (
    <div className="border-b border-border px-3 pb-3 pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground/70">
          <GitBranch className="size-3.5 shrink-0" />
          <span className="truncate">
            {model.metadata?.workspaceName
              ? `${model.metadata.workspaceName}@`
              : translate(
                  'auto.components.right.sidebar.SourceControl.jj.currentChange',
                  'Current change'
                )}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 shrink-0 gap-1 px-1.5 text-[11px] normal-case tracking-normal"
                disabled={!model.metadata}
                aria-label="Manage local bookmarks"
              >
                <Bookmark className="size-3" />
                {model.metadata?.bookmarks.length ? (
                  <span className="max-w-24 truncate">{model.metadata.bookmarks[0]?.name}</span>
                ) : (
                  <span>Bookmarks</span>
                )}
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" sideOffset={6} className="w-72 p-3">
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-foreground">Local bookmarks</div>
                  {model.metadata?.bookmarks.length ? (
                    <div className="flex flex-wrap gap-1">
                      {model.metadata.bookmarks.map((bookmark) => (
                        <Badge key={bookmark.name} variant="outline" title="Read-only bookmark">
                          {bookmark.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">
                      No bookmark at current change
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 border-t border-border pt-3">
                  <Input
                    value={bookmarkName}
                    disabled={mutationDisabled}
                    onChange={(event) => onBookmarkNameChange(event.target.value)}
                    placeholder="New local bookmark"
                    aria-label="New local bookmark name"
                    className="h-7 w-full text-xs"
                  />
                  <Button
                    type="button"
                    size="xs"
                    className="w-full"
                    disabled={mutationDisabled || bookmarkName.trim().length === 0}
                    onClick={onCreateBookmark}
                  >
                    Create bookmark
                  </Button>
                </div>
                <div className="space-y-1.5 border-t border-border pt-3">
                  <Select
                    value={selectedBookmark}
                    onValueChange={onSelectedBookmarkChange}
                    disabled={
                      mutationDisabled ||
                      model.bookmarksStatus !== 'ready' ||
                      model.localBookmarks.length === 0
                    }
                  >
                    <SelectTrigger size="sm" className="h-7 w-full text-xs">
                      <SelectValue
                        placeholder={
                          model.bookmarksStatus === 'loading'
                            ? 'Loading bookmarks…'
                            : 'Select bookmark to move'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {model.localBookmarks.map((bookmark) => (
                        <SelectItem key={bookmark.name} value={bookmark.name}>
                          {bookmark.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="w-full"
                    disabled={mutationDisabled || !selectedBookmark}
                    onClick={onMoveBookmark}
                  >
                    Move to current
                  </Button>
                </div>
                {model.bookmarksError ? (
                  <div className="text-[11px] text-destructive" role="alert">
                    {model.bookmarksError}
                  </div>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate(
            'auto.components.right.sidebar.SourceControl.jj.refreshChanges',
            'Refresh Jujutsu changes'
          )}
          onClick={() => void model.refresh({ force: true })}
        >
          <RefreshCw />
        </Button>
      </div>
      {model.metadata ? (
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="text-foreground/70">Change ID</span>
              <span
                className="max-w-32 truncate font-mono text-foreground/80"
                title={model.metadata.changeId}
              >
                {model.metadata.changeId.slice(0, 12)}
              </span>
              <CheckRunCopyButton text={model.metadata.changeId} label="Copy Change ID" />
              {model.metadata.conflicted ? <Badge variant="destructive">Conflict</Badge> : null}
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="text-foreground/70">Commit ID</span>
              <span
                className="max-w-32 truncate font-mono text-foreground/80"
                title={model.metadata.commitId}
              >
                {model.metadata.commitId.slice(0, 12)}
              </span>
              <CheckRunCopyButton text={model.metadata.commitId} label="Copy Commit ID" />
            </div>
          </div>
          {model.metadataStatus === 'error' && model.metadataError ? (
            <div className="text-destructive" role="alert">
              {model.metadataError}
            </div>
          ) : null}
        </div>
      ) : model.metadataStatus === 'loading' ? (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading current change…
        </div>
      ) : model.metadataError ? (
        <div className="mt-2 text-[11px] text-destructive" role="alert">
          {model.metadataError}
        </div>
      ) : null}
      {model.canRecoverStaleWorkspace ? (
        <div className="mt-2 rounded-md border border-border bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
          <div>Sync the recorded workspace state before viewing changes.</div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="mt-1.5"
            disabled={model.isRecoveringStaleWorkspace}
            aria-busy={model.isRecoveringStaleWorkspace}
            onClick={() => void model.recoverStaleWorkspace()}
          >
            {model.isRecoveringStaleWorkspace ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {model.isRecoveringStaleWorkspace ? 'Updating workspace…' : 'Update workspace'}
          </Button>
        </div>
      ) : null}
      {model.staleRecoveryError ? (
        <div className="mt-2 text-[11px] text-destructive" role="alert">
          {model.staleRecoveryError.kind === 'uncertain'
            ? `Workspace update outcome uncertain: ${model.staleRecoveryError.message} Reconcile the workspace before committing again.`
            : model.staleRecoveryError.message}
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        <CommitMessageComposer
          rows={3}
          commitMessage={commitMessage}
          disabled={commitDisabled}
          onCommitMessageChange={onCommitMessageChange}
          describedBy="jj-commit-error"
          showGenerate={false}
          isGenerating={false}
          onCancelGenerate={() => undefined}
          isGenerateDisabled
          onGenerate={() => undefined}
          placeholder="Description"
          ariaLabel="Description or commit message"
        />
        <CommitActionMenu
          showComposer
          primaryAction={{
            kind: 'commit',
            label: 'Commit all',
            title: 'Commit all current changes',
            disabled: commitDisabled || !hasMessage
          }}
          PrimaryIcon={GitBranch}
          showSpinner={model.isCommitting}
          showChevronSpinner={model.isRemoteMutating}
          moreCommitAndRemoteActionsLabel="More Jujutsu actions"
          moreActionsLabel="Describe, commit selected, fetch, or push"
          onPrimaryAction={() => onCommit('all')}
          dropdownMenuContent={
            <DropdownMenuContent align="end" className="min-w-[14rem]">
              <DropdownMenuItem
                disabled={mutationDisabled || !model.metadata}
                onSelect={onDescribe}
              >
                Describe
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={commitDisabled || !hasMessage || visibleSelectedCount === 0}
                onSelect={() => onCommit('selected')}
              >
                Commit selected
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={
                  mutationDisabled || model.remoteError?.kind === 'uncertain' || !model.metadata
                }
                onSelect={() => onOpenRemoteDialog('fetch')}
              >
                <Download className="size-3.5" />
                Fetch bookmarks…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={
                  mutationDisabled ||
                  model.remoteError?.kind === 'uncertain' ||
                  !model.metadata ||
                  model.localBookmarks.length === 0
                }
                onSelect={() => onOpenRemoteDialog('push')}
              >
                <Upload className="size-3.5" />
                Push bookmark…
              </DropdownMenuItem>
            </DropdownMenuContent>
          }
        />
        <div className="text-[11px] text-muted-foreground">
          Selected {visibleSelectedCount} · Remaining {remainingCount}
        </div>
        {model.commitError ? (
          <div
            id="jj-commit-error"
            className="rounded-md border border-destructive/25 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive"
            role="alert"
          >
            {model.commitError.kind === 'uncertain'
              ? `Commit outcome uncertain: ${model.commitError.message} Reconcile the workspace before committing again.`
              : model.commitError.message}
          </div>
        ) : null}
        {model.mutationError ? (
          <div
            id="jj-mutation-error"
            className="rounded-md border border-destructive/25 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive"
            role="alert"
          >
            {model.mutationError.kind === 'uncertain'
              ? `Jujutsu mutation outcome uncertain: ${model.mutationError.message} Reconcile before retrying.`
              : model.mutationError.message}
          </div>
        ) : null}
      </div>
    </div>
  )
}
