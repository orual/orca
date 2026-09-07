import type { ComposerModel } from './composer-model'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import { runBackgroundWorktreeCreation } from '@/lib/worktree-creation-flow'

export function finishQuickCreation(
  input: Pick<
    ComposerModel,
    | 'clearNewWorkspaceDraft'
    | 'createMultiple'
    | 'onCreated'
    | 'persistDraft'
    | 'resetForNextCreate'
  >,
  request: WorktreeCreationRequest
): void {
  if (input.persistDraft) {
    input.clearNewWorkspaceDraft()
  }
  runBackgroundWorktreeCreation(request)
  if (input.createMultiple) {
    input.resetForNextCreate()
  } else {
    input.onCreated?.()
  }
}
