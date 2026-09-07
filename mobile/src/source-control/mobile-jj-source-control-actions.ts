import type { ActionSheetAction } from '../components/ActionSheetModal'

type Args = {
  hasMessage: boolean
  changeCount: number
  selectedCount: number
  busy: boolean
  uncertain: boolean
  canDescribe: boolean
  handlers: {
    commitAll: () => void
    commitSelected: () => void
    describe: () => void
    fetch: () => void
    push: () => void
  }
}

export function buildMobileJjSourceControlActions({
  hasMessage,
  changeCount,
  selectedCount,
  busy,
  uncertain,
  canDescribe,
  handlers
}: Args): ActionSheetAction[] {
  const disabled = busy || uncertain
  return [
    {
      label: 'Commit All',
      disabled: disabled || !hasMessage || changeCount === 0,
      hint: !hasMessage
        ? 'Enter a description or commit message'
        : changeCount === 0
          ? 'No changes to commit'
          : undefined,
      onPress: handlers.commitAll
    },
    {
      label: 'Commit Selected',
      disabled: disabled || !hasMessage || selectedCount === 0,
      hint: !hasMessage
        ? 'Enter a description or commit message'
        : selectedCount === 0
          ? 'Select at least one change'
          : undefined,
      onPress: handlers.commitSelected
    },
    {
      label: 'Describe',
      disabled: disabled || !hasMessage || !canDescribe,
      hint: !hasMessage
        ? 'Enter a description'
        : !canDescribe
          ? 'Describe is unavailable'
          : undefined,
      onPress: handlers.describe
    },
    { label: 'Fetch', disabled, onPress: handlers.fetch },
    { label: 'Push', disabled, onPress: handlers.push }
  ]
}
