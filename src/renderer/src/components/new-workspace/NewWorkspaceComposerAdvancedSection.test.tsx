// @vitest-environment happy-dom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewWorkspaceComposerAdvancedSection } from './NewWorkspaceComposerAdvancedSection'

const parentPickerMock = vi.hoisted(() => vi.fn())

vi.mock('./ComposerParentWorktreePicker', () => ({
  ComposerParentWorktreePicker: (props: Record<string, unknown>) => {
    parentPickerMock(props)
    return <div data-testid="parent-worktree-picker" />
  }
}))

vi.mock('@/components/sparse/SparseCheckoutPresetSelect', () => ({
  default: () => <div data-testid="sparse-checkout-picker" />
}))

function renderAdvanced(
  overrides: Partial<React.ComponentProps<typeof NewWorkspaceComposerAdvancedSection>> = {}
) {
  return render(
    <NewWorkspaceComposerAdvancedSection
      advancedOpen
      smartNameSelection={null}
      name="workspace"
      onNameValueChange={() => {}}
      selectedRepoIsGit={false}
      selectedRepoIsJj={false}
      jjStartRevision="@"
      onJjStartRevisionChange={() => {}}
      branchesEnabled
      branchNameInputId="branch-name"
      branchNameOverride=""
      onBranchNameOverrideChange={() => {}}
      parentWorktreeId={null}
      onParentWorktreeIdChange={() => {}}
      selectedRepoExecutionHostId="local"
      selectedRepoProjectId={null}
      activeFolderWorkspaceId={null}
      note=""
      onNoteChange={() => {}}
      setupControlsEnabled={false}
      setupConfig={null}
      setupConfigLabel="Setup"
      setupRunLabel="Run setup"
      setupAskLabel="Run setup now?"
      setupRunButtonLabel="Run setup now"
      setupSkipButtonLabel="Skip for now"
      requiresExplicitSetupChoice={false}
      resolvedSetupDecision={null}
      onSetupDecisionChange={() => {}}
      showSetupAgentStartupPolicy={false}
      setupAgentStartupPolicy="start-immediately"
      onSetupAgentStartupPolicyChange={() => {}}
      setupDecision={null}
      shouldWaitForSetupCheck={false}
      sparseControlsEnabled={false}
      repoId="repo-1"
      sparsePresets={[]}
      sparseSelectedPresetId={null}
      onSparseSelectPreset={() => {}}
      canUseSparseCheckout={false}
      {...overrides}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NewWorkspaceComposerAdvancedSection jj controls', () => {
  it('renders the jj revision input and does not mount Git controls', () => {
    const onJjStartRevisionChange = vi.fn()
    renderAdvanced({
      selectedRepoIsJj: true,
      jjStartRevision: '@-2',
      onJjStartRevisionChange
    })

    const revisionInput = screen.getByDisplayValue('@-2')
    expect(revisionInput).not.toBeNull()
    fireEvent.change(revisionInput, { target: { value: 'main@' } })
    expect(onJjStartRevisionChange).toHaveBeenCalledWith('main@')
    expect(screen.queryByPlaceholderText('feature/my-branch')).toBeNull()
    expect(screen.queryByText('Parent worktree')).toBeNull()
    expect(screen.queryByTestId('parent-worktree-picker')).toBeNull()
    expect(screen.queryByTestId('sparse-checkout-picker')).toBeNull()
    expect(parentPickerMock).not.toHaveBeenCalled()
  })

  it('keeps Git branch and parent controls for Git repositories', () => {
    renderAdvanced({ selectedRepoIsGit: true })

    expect(screen.getByPlaceholderText('feature/my-branch')).not.toBeNull()
    expect(screen.getByTestId('parent-worktree-picker')).not.toBeNull()
    expect(screen.queryByPlaceholderText('@')).toBeNull()
  })

  it('keeps folder workspaces free of both Git and jj controls', () => {
    renderAdvanced()

    expect(screen.queryByPlaceholderText('feature/my-branch')).toBeNull()
    expect(screen.queryByPlaceholderText('@')).toBeNull()
    expect(screen.queryByText('Parent worktree')).toBeNull()
    expect(parentPickerMock).not.toHaveBeenCalled()
  })
})
