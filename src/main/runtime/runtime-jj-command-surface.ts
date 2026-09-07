import type { RuntimeJjCommands } from './orca-runtime-jj'

type RuntimeJjCommandName =
  | 'detectRuntimeJj'
  | 'listRuntimeJjWorkspaces'
  | 'addRuntimeJjWorkspace'
  | 'removeRuntimeJjWorkspace'
  | 'listRuntimeJjChanges'
  | 'readRuntimeJjFileDiff'
  | 'getRuntimeJjCurrentChangeMetadata'
  | 'listRuntimeJjLocalBookmarks'
  | 'listRuntimeJjRemotes'
  | 'fetchRuntimeJjRemote'
  | 'pushRuntimeJjBookmark'
  | 'describeRuntimeJjCurrentChange'
  | 'createRuntimeJjBookmark'
  | 'moveRuntimeJjBookmark'
  | 'commitRuntimeJj'
  | 'updateRuntimeJjWorkspaceStale'

export type RuntimeJjCommandSurface = Pick<RuntimeJjCommands, RuntimeJjCommandName>

export function installRuntimeJjCommandSurface(
  target: RuntimeJjCommandSurface,
  commands: RuntimeJjCommands
): void {
  Object.assign(target, {
    detectRuntimeJj: commands.detectRuntimeJj.bind(commands),
    listRuntimeJjWorkspaces: commands.listRuntimeJjWorkspaces.bind(commands),
    addRuntimeJjWorkspace: commands.addRuntimeJjWorkspace.bind(commands),
    removeRuntimeJjWorkspace: commands.removeRuntimeJjWorkspace.bind(commands),
    listRuntimeJjChanges: commands.listRuntimeJjChanges.bind(commands),
    readRuntimeJjFileDiff: commands.readRuntimeJjFileDiff.bind(commands),
    getRuntimeJjCurrentChangeMetadata: commands.getRuntimeJjCurrentChangeMetadata.bind(commands),
    listRuntimeJjLocalBookmarks: commands.listRuntimeJjLocalBookmarks.bind(commands),
    listRuntimeJjRemotes: commands.listRuntimeJjRemotes.bind(commands),
    fetchRuntimeJjRemote: commands.fetchRuntimeJjRemote.bind(commands),
    pushRuntimeJjBookmark: commands.pushRuntimeJjBookmark.bind(commands),
    describeRuntimeJjCurrentChange: commands.describeRuntimeJjCurrentChange.bind(commands),
    createRuntimeJjBookmark: commands.createRuntimeJjBookmark.bind(commands),
    moveRuntimeJjBookmark: commands.moveRuntimeJjBookmark.bind(commands),
    commitRuntimeJj: commands.commitRuntimeJj.bind(commands),
    updateRuntimeJjWorkspaceStale: commands.updateRuntimeJjWorkspaceStale.bind(commands)
  } satisfies RuntimeJjCommandSurface)
}
