import type {
  JjChangesResult,
  JjCurrentChangeMetadataResult,
  JjDetection,
  JjFileDiffResult,
  JjLocalBookmarksResult,
  JjRemoteListResult,
  JjWorkspaceAddInput,
  JjWorkspaceAddResult,
  JjWorkspaceListResult,
  JjWorkspaceRemoveInput,
  JjWorkspaceRemoveResult
} from '../../../shared/jj-types'
import { callRuntimeRpc, getActiveRuntimeTarget, selectorFor } from './runtime-jj-client-shared'
import type { RuntimeGitContext } from './runtime-git-client-context'

export function detectRuntimeJj(context: RuntimeGitContext): Promise<JjDetection> {
  return callRuntimeRpc<JjDetection>(
    getActiveRuntimeTarget(context.settings),
    'jj.detect',
    { worktree: selectorFor(context) },
    { timeoutMs: 15_000 }
  )
}

export function listRuntimeJjWorkspaces(
  context: RuntimeGitContext
): Promise<JjWorkspaceListResult> {
  return callRuntimeRpc<JjWorkspaceListResult>(
    getActiveRuntimeTarget(context.settings),
    'jj.listWorkspaces',
    { worktree: selectorFor(context) },
    { timeoutMs: 15_000 }
  )
}

export function addRuntimeJjWorkspace(
  context: RuntimeGitContext,
  input: JjWorkspaceAddInput
): Promise<JjWorkspaceAddResult> {
  return callRuntimeRpc<JjWorkspaceAddResult>(
    getActiveRuntimeTarget(context.settings),
    'jj.addWorkspace',
    { worktree: selectorFor(context), ...input },
    { timeoutMs: 30_000 }
  )
}

export function removeRuntimeJjWorkspace(
  context: RuntimeGitContext,
  input: JjWorkspaceRemoveInput
): Promise<JjWorkspaceRemoveResult> {
  return callRuntimeRpc<JjWorkspaceRemoveResult>(
    getActiveRuntimeTarget(context.settings),
    'jj.removeWorkspace',
    { worktree: selectorFor(context), ...input },
    { timeoutMs: 30_000 }
  )
}

export function listRuntimeJjChanges(
  context: RuntimeGitContext,
  options: { signal?: AbortSignal } = {}
): Promise<JjChangesResult> {
  return callRuntimeRpc<JjChangesResult>(
    getActiveRuntimeTarget(context.settings),
    'jj.listChanges',
    { worktree: selectorFor(context) },
    { timeoutMs: 15_000, signal: options.signal }
  )
}

export function readRuntimeJjFileDiff(
  context: RuntimeGitContext,
  input: { path: string; revision?: string; parentRevision?: string },
  options: { signal?: AbortSignal } = {}
): Promise<JjFileDiffResult> {
  return callRuntimeRpc<JjFileDiffResult>(
    getActiveRuntimeTarget(context.settings),
    'jj.readFileDiff',
    { worktree: selectorFor(context), ...input },
    { timeoutMs: 30_000, signal: options.signal }
  )
}

export function getRuntimeJjCurrentChangeMetadata(
  context: RuntimeGitContext,
  options: { signal?: AbortSignal } = {}
): Promise<JjCurrentChangeMetadataResult> {
  return callRuntimeRpc<JjCurrentChangeMetadataResult>(
    getActiveRuntimeTarget(context.settings),
    'jj.getCurrentChangeMetadata',
    { worktree: selectorFor(context) },
    { timeoutMs: 15_000, signal: options.signal }
  )
}

export function listRuntimeJjLocalBookmarks(
  context: RuntimeGitContext,
  options: { signal?: AbortSignal } = {}
): Promise<JjLocalBookmarksResult> {
  return callRuntimeRpc<JjLocalBookmarksResult>(
    getActiveRuntimeTarget(context.settings),
    'jj.listLocalBookmarks',
    { worktree: selectorFor(context) },
    { timeoutMs: 15_000, signal: options.signal }
  )
}

export function listRuntimeJjRemotes(
  context: RuntimeGitContext,
  options: { signal?: AbortSignal } = {}
): Promise<JjRemoteListResult> {
  return callRuntimeRpc<JjRemoteListResult>(
    getActiveRuntimeTarget(context.settings),
    'jj.listRemotes',
    { worktree: selectorFor(context) },
    { timeoutMs: 15_000, signal: options.signal }
  )
}
