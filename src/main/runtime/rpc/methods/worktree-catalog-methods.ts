import { defineMethod, type RpcMethod } from '../core'
import { resolveWorktreeCatalogSnapshot } from '../worktree-catalog-snapshot'
import { supportsWorktreeVisibilitySourceDefaults } from '../worktree-visibility-client-capability'
import { jjListingOptionsForClient } from '../repo-jj-projection'
import {
  WorktreeDetectedListParams,
  WorktreeListParams,
  WorktreePsParams
} from './worktree-schemas'

export const WORKTREE_CATALOG_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'worktree.ps',
    params: WorktreePsParams,
    handler: async (params, context) => {
      const options = jjListingOptionsForClient(context)
      const visibilitySupported = supportsWorktreeVisibilitySourceDefaults(
        context,
        params.supportsWorktreeVisibilitySourceDefaults
      )
      const result = options
        ? await context.runtime.getWorktreePs(params.limit, visibilitySupported, options)
        : await context.runtime.getWorktreePs(params.limit, visibilitySupported)
      // Why: callers that never send the field get the byte-exact legacy response.
      return params.afterSnapshotId === undefined
        ? result
        : resolveWorktreeCatalogSnapshot(result, params.afterSnapshotId)
    }
  }),
  defineMethod({
    name: 'worktree.list',
    params: WorktreeListParams,
    handler: async (params, context) => {
      const options = jjListingOptionsForClient(context)
      const visibilitySupported = supportsWorktreeVisibilitySourceDefaults(context)
      return options
        ? context.runtime.listManagedWorktrees(
            params.repo,
            params.limit,
            visibilitySupported,
            options
          )
        : context.runtime.listManagedWorktrees(params.repo, params.limit, visibilitySupported)
    }
  }),
  defineMethod({
    name: 'worktree.listRetiredNames',
    params: WorktreeDetectedListParams,
    handler: async (params, context) => {
      const options = jjListingOptionsForClient(context)
      return options
        ? context.runtime.listRetiredWorktreeNames(params.repo, options)
        : context.runtime.listRetiredWorktreeNames(params.repo)
    }
  }),
  defineMethod({
    name: 'worktree.detectedList',
    params: WorktreeDetectedListParams,
    handler: async (params, context) => {
      const options = jjListingOptionsForClient(context)
      return options
        ? context.runtime.listDetectedManagedWorktrees(
            params.repo,
            undefined,
            supportsWorktreeVisibilitySourceDefaults(context),
            options
          )
        : context.runtime.listDetectedManagedWorktrees(
            params.repo,
            undefined,
            supportsWorktreeVisibilitySourceDefaults(context)
          )
    }
  })
]
