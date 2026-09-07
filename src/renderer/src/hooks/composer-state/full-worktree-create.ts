import type { CreateWorktreeResult } from '../../../../shared/worktree/create-types'
import type { ComposerModel } from './composer-model'
import type { FullWorktreeCreateArgsInput } from './full-worktree-create-args'
import { buildFullWorktreeCreateArgs } from './full-worktree-create-args'

export async function createFullWorktree(
  createWorktree: ComposerModel['createWorktree'],
  input: FullWorktreeCreateArgsInput
): Promise<CreateWorktreeResult> {
  return createWorktree(...buildFullWorktreeCreateArgs(input))
}
