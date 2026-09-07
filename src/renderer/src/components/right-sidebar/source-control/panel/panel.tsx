import type { JSX } from 'react'
import { translate } from '@/i18n/i18n'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { isFolderRepo, isJjRepo } from '../../../../../../shared/repo-kind'
import { JjChangesPanel } from './jj-changes-panel'
import { SourceControlPanelReady } from './panel-ready'
import { useSourceControlPanelModel } from './use-panel-model'

function EmptySourceControlPanel({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
      {message}
    </div>
  )
}

/** Git-only subtree. Keeping the model here prevents Git hooks from mounting for jj workspaces. */
function GitSourceControlPanel(): React.JSX.Element {
  const model = useSourceControlPanelModel()
  const { activeRepo, activeWorktree, isFolder, worktreePath } = model
  if (!activeWorktree || !activeRepo || !worktreePath) {
    return (
      <EmptySourceControlPanel
        message={translate(
          'auto.components.right.sidebar.SourceControl.c07b236287',
          'Select a workspace to view changes'
        )}
      />
    )
  }
  if (isFolder) {
    return (
      <EmptySourceControlPanel
        message={translate(
          'auto.components.right.sidebar.SourceControl.e131cd7128',
          'Source Control is only available for Git repositories'
        )}
      />
    )
  }
  return (
    <SourceControlPanelReady
      activeRepo={activeRepo}
      activeWorktree={activeWorktree}
      currentWorktreeId={activeWorktree.id}
      model={model}
      worktreePath={worktreePath}
    />
  )
}

/** Selects the provider before mounting either provider's eager hooks. */
export function SourceControlPanel(): React.JSX.Element {
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  if (!activeWorktree || !activeRepo || !activeWorktree.path) {
    return (
      <EmptySourceControlPanel
        message={translate(
          'auto.components.right.sidebar.SourceControl.c07b236287',
          'Select a workspace to view changes'
        )}
      />
    )
  }
  if (isJjRepo(activeRepo)) {
    return (
      <JjChangesPanel
        key={activeWorktree.id}
        worktreeId={activeWorktree.id}
        worktreePath={activeWorktree.path}
      />
    )
  }
  if (isFolderRepo(activeRepo)) {
    return (
      <EmptySourceControlPanel
        message={translate(
          'auto.components.right.sidebar.SourceControl.e131cd7128',
          'Source Control is only available for Git repositories'
        )}
      />
    )
  }
  return <GitSourceControlPanel />
}
