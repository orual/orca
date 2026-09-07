import { useAppStore } from '@/store'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { settleComposerSubmit } from '@/lib/composer-submit-cancellation'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import type { ComposerModel } from './composer-model'

export type QuickEphemeralVmRecipeResolution =
  | { kind: 'none' }
  | { kind: 'cancelled' }
  | { kind: 'skip' }
  | { kind: 'ready'; recipe: WorktreeCreationRequest['ephemeralVmRecipe'] }

type QuickEphemeralVmRecipeInput = Pick<
  ComposerModel,
  | 'ephemeralVmRecipes'
  | 'ephemeralVmsEnabled'
  | 'isSubmissionCancelled'
  | 'selectedEphemeralVmRecipeId'
  | 'selectedRepoExecutionHostId'
  | 'selectedWorkspaceTarget'
> & {
  repoId: string
}

export async function resolveQuickEphemeralVmRecipe(
  input: QuickEphemeralVmRecipeInput
): Promise<QuickEphemeralVmRecipeResolution> {
  const activeRecipeId = input.ephemeralVmsEnabled ? input.selectedEphemeralVmRecipeId : null
  if (!activeRecipeId || input.selectedWorkspaceTarget.status !== 'ready') {
    return { kind: 'none' }
  }

  const trustSettlement = await settleComposerSubmit(
    ensureHooksConfirmed(
      useAppStore.getState(),
      input.repoId,
      'vmRecipe',
      input.selectedRepoExecutionHostId ?? undefined,
      undefined,
      input.isSubmissionCancelled
    ),
    input.isSubmissionCancelled
  )
  if (trustSettlement.status === 'cancelled') {
    return { kind: 'cancelled' }
  }
  if (trustSettlement.value === 'skip') {
    return { kind: 'skip' }
  }

  const selectedRecipe = input.ephemeralVmRecipes.find((recipe) => recipe.id === activeRecipeId)
  return {
    kind: 'ready',
    recipe: {
      sourceRepoId: input.repoId,
      recipeId: activeRecipeId,
      projectId: input.selectedWorkspaceTarget.target.projectId,
      ...(selectedRecipe?.checkoutMode ? { checkoutMode: selectedRecipe.checkoutMode } : {})
    }
  }
}
