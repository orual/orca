import type { JSX } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { JjLocalBookmark } from '../../../../../../shared/jj-types'

type RemoteOption = { name: string; url: string }

type RemoteDialogProps = {
  kind: 'fetch' | 'push' | null
  options: RemoteOption[]
  status: 'idle' | 'loading' | 'error'
  selectedRemote: string
  selectedPushBookmark: string
  localBookmarks: JjLocalBookmark[]
  isRemoteMutating: boolean
  remoteError: { kind: string; message: string } | null
  onOpenChange: (open: boolean) => void
  onRemoteChange: (remote: string) => void
  onBookmarkChange: (bookmark: string) => void
  onSubmit: () => void
}

export function JjChangesPanelRemoteDialog({
  kind,
  options,
  status,
  selectedRemote,
  selectedPushBookmark,
  localBookmarks,
  isRemoteMutating,
  remoteError,
  onOpenChange,
  onRemoteChange,
  onBookmarkChange,
  onSubmit
}: RemoteDialogProps): JSX.Element {
  return (
    <Dialog open={kind !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{kind === 'push' ? 'Push bookmark' : 'Fetch bookmarks'}</DialogTitle>
          <DialogDescription>
            {kind === 'push'
              ? 'Choose one remote and one local bookmark. Only that bookmark will be pushed.'
              : 'Choose one remote to fetch. Fetch does not rebase or update the working copy.'}
          </DialogDescription>
        </DialogHeader>
        {status === 'loading' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading remotes…
          </div>
        ) : status === 'error' ? (
          <div className="text-xs text-destructive" role="alert">
            Unable to list jj remotes.
          </div>
        ) : options.length === 0 ? (
          <div className="text-xs text-muted-foreground">No jj remotes are configured.</div>
        ) : (
          <div className="space-y-3">
            <Select value={selectedRemote} onValueChange={onRemoteChange}>
              <SelectTrigger size="sm" className="w-full text-xs" aria-label="Remote">
                <SelectValue placeholder="Select remote" />
              </SelectTrigger>
              <SelectContent>
                {options.map((remote) => (
                  <SelectItem key={remote.name} value={remote.name}>
                    <span className="flex min-w-0 flex-col">
                      <span>{remote.name}</span>
                      <span className="max-w-64 truncate text-[10px] text-muted-foreground">
                        {remote.url}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {kind === 'push' ? (
              <Select value={selectedPushBookmark} onValueChange={onBookmarkChange}>
                <SelectTrigger size="sm" className="w-full text-xs" aria-label="Bookmark">
                  <SelectValue placeholder="Select bookmark" />
                </SelectTrigger>
                <SelectContent>
                  {localBookmarks.map((bookmark) => (
                    <SelectItem key={bookmark.name} value={bookmark.name}>
                      {bookmark.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        )}
        {remoteError ? (
          <div
            className="rounded-md border border-destructive/25 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive"
            role="alert"
          >
            {remoteError.kind === 'uncertain'
              ? `Remote operation outcome uncertain: ${remoteError.message} Reconcile before retrying.`
              : remoteError.message}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isRemoteMutating}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={
              status !== 'idle' ||
              !selectedRemote ||
              isRemoteMutating ||
              remoteError?.kind === 'uncertain' ||
              (kind === 'push' && !selectedPushBookmark)
            }
          >
            {isRemoteMutating ? <Loader2 className="animate-spin" /> : null}
            {kind === 'push' ? 'Push bookmark' : 'Fetch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
