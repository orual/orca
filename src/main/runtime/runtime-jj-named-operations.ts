import type {
  JjChangesResult,
  JjCurrentChangeMetadataResult,
  JjDetection,
  JjLocalBookmarksResult,
  JjRemoteListResult,
  JjWorkspaceListResult
} from '../../shared/jj-types'
import {
  runRuntimeJj,
  type RuntimeJjCommandHost,
  type RuntimeJjRequestOptions
} from './runtime-jj-operation-context'

export function detectRuntimeJj(
  host: RuntimeJjCommandHost,
  selector: string,
  options?: RuntimeJjRequestOptions
): Promise<JjDetection> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.detect()
      : route.provider.detect(target.worktree.path, options)
  )
}

export function listRuntimeJjWorkspaces(
  host: RuntimeJjCommandHost,
  selector: string,
  options?: RuntimeJjRequestOptions
): Promise<JjWorkspaceListResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.listWorkspaces(options)
      : route.provider.listWorkspaces(target.worktree.path, options)
  )
}

export function listRuntimeJjChanges(
  host: RuntimeJjCommandHost,
  selector: string,
  options?: RuntimeJjRequestOptions
): Promise<JjChangesResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.listChanges()
      : route.provider.listChanges(target.worktree.path, options)
  )
}

export function getRuntimeJjCurrentChangeMetadata(
  host: RuntimeJjCommandHost,
  selector: string,
  options?: RuntimeJjRequestOptions
): Promise<JjCurrentChangeMetadataResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.getCurrentChangeMetadata()
      : route.provider.getCurrentChangeMetadata(target.worktree.path, options)
  )
}

export function listRuntimeJjLocalBookmarks(
  host: RuntimeJjCommandHost,
  selector: string,
  options?: RuntimeJjRequestOptions
): Promise<JjLocalBookmarksResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.listLocalBookmarks()
      : route.provider.listLocalBookmarks(target.worktree.path, options)
  )
}

export function listRuntimeJjRemotes(
  host: RuntimeJjCommandHost,
  selector: string,
  options?: RuntimeJjRequestOptions
): Promise<JjRemoteListResult> {
  return runRuntimeJj(host, selector, options, (route, target) =>
    route.kind === 'local'
      ? route.backend.listRemotes()
      : route.provider.listRemotes(target.worktree.path, options)
  )
}
