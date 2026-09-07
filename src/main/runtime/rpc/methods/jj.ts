import type { RpcMethod } from '../core'
import { defineMethod } from '../core'
import {
  JjBookmarkMutation,
  JjCommit,
  JjCurrentChangeMetadata,
  JjRemoteFetch,
  JjRemotePush,
  JjDescribe,
  JjFileDiff,
  JjWorkspaceAdd,
  JjWorkspaceRemove
} from './jj-params'
import { WorktreeSelector } from './git-params'

export const JJ_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'jj.detect',
    params: WorktreeSelector,
    handler: (params, { runtime, signal }) =>
      runtime.detectRuntimeJj(params.worktree, signal ? { signal } : undefined)
  }),
  defineMethod({
    name: 'jj.listWorkspaces',
    params: WorktreeSelector,
    handler: (params, { runtime, signal }) =>
      runtime.listRuntimeJjWorkspaces(params.worktree, signal ? { signal } : undefined)
  }),
  defineMethod({
    name: 'jj.addWorkspace',
    params: JjWorkspaceAdd,
    handler: (params, { runtime, signal }) =>
      runtime.addRuntimeJjWorkspace(
        params.worktree,
        {
          destination: params.destination,
          ...(params.name ? { name: params.name } : {}),
          ...(params.revision ? { revision: params.revision } : {})
        },
        signal ? { signal } : undefined
      )
  }),
  defineMethod({
    name: 'jj.removeWorkspace',
    params: JjWorkspaceRemove,
    handler: (params, { runtime, signal }) =>
      runtime.removeRuntimeJjWorkspace(
        params.worktree,
        { name: params.name, targetRoot: params.targetRoot, ownerRoot: params.ownerRoot },
        signal ? { signal } : undefined
      )
  }),
  defineMethod({
    name: 'jj.listChanges',
    params: WorktreeSelector,
    handler: (params, { runtime, signal }) =>
      runtime.listRuntimeJjChanges(params.worktree, signal ? { signal } : undefined)
  }),
  defineMethod({
    name: 'jj.readFileDiff',
    params: JjFileDiff,
    handler: (params, { runtime, signal }) =>
      runtime.readRuntimeJjFileDiff(
        params.worktree,
        {
          path: params.path,
          ...(params.revision ? { revision: params.revision } : {}),
          ...(params.parentRevision ? { parentRevision: params.parentRevision } : {})
        },
        signal ? { signal } : undefined
      )
  }),
  defineMethod({
    name: 'jj.getCurrentChangeMetadata',
    params: JjCurrentChangeMetadata,
    handler: (params, { runtime, signal }) =>
      runtime.getRuntimeJjCurrentChangeMetadata(params.worktree, signal ? { signal } : undefined)
  }),
  defineMethod({
    name: 'jj.listLocalBookmarks',
    params: WorktreeSelector,
    handler: (params, { runtime, signal }) =>
      runtime.listRuntimeJjLocalBookmarks(params.worktree, signal ? { signal } : undefined)
  }),
  defineMethod({
    name: 'jj.listRemotes',
    params: WorktreeSelector,
    handler: (params, { runtime, signal }) =>
      runtime.listRuntimeJjRemotes(params.worktree, signal ? { signal } : undefined)
  }),
  defineMethod({
    name: 'jj.fetchRemote',
    params: JjRemoteFetch,
    handler: (params, { runtime, signal }) =>
      runtime.fetchRuntimeJjRemote(
        params.worktree,
        { remote: params.remote },
        signal ? { signal } : undefined
      )
  }),
  defineMethod({
    name: 'jj.pushBookmark',
    params: JjRemotePush,
    handler: (params, { runtime, signal }) =>
      runtime.pushRuntimeJjBookmark(
        params.worktree,
        { remote: params.remote, bookmark: params.bookmark },
        signal ? { signal } : undefined
      )
  }),
  defineMethod({
    name: 'jj.describe',
    params: JjDescribe,
    handler: (params, { runtime, signal }) =>
      runtime.describeRuntimeJjCurrentChange(
        params.worktree,
        { expectedCommitId: params.expectedCommitId, message: params.message },
        signal ? { signal } : undefined
      )
  }),
  defineMethod({
    name: 'jj.createBookmark',
    params: JjBookmarkMutation,
    handler: (params, { runtime, signal }) =>
      runtime.createRuntimeJjBookmark(
        params.worktree,
        { expectedCommitId: params.expectedCommitId, name: params.name },
        signal ? { signal } : undefined
      )
  }),
  defineMethod({
    name: 'jj.moveBookmark',
    params: JjBookmarkMutation,
    handler: (params, { runtime, signal }) =>
      runtime.moveRuntimeJjBookmark(
        params.worktree,
        { expectedCommitId: params.expectedCommitId, name: params.name },
        signal ? { signal } : undefined
      )
  }),
  defineMethod({
    name: 'jj.commit',
    params: JjCommit,
    handler: (params, { runtime, signal }) =>
      runtime.commitRuntimeJj(
        params.worktree,
        {
          expectedCommitId: params.expectedCommitId,
          message: params.message,
          intent: params.intent
        },
        signal ? { signal } : undefined
      )
  }),
  defineMethod({
    name: 'jj.updateWorkspaceStale',
    params: WorktreeSelector,
    handler: (params, { runtime, signal }) =>
      runtime.updateRuntimeJjWorkspaceStale(params.worktree, signal ? { signal } : undefined)
  })
]
