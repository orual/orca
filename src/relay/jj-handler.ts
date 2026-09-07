import type { RelayDispatcher, RequestContext } from './dispatcher'
import { registerJjHandlers } from './jj-handler-registration'
import { createRelayJjBackend, type JjBackendFactory } from './jj-handler-context'
import * as namedHandlers from './jj-named-handlers'
import { readFileDiff } from './jj-read-handlers'
import * as mutationHandlers from './jj-mutation-handlers'

export type { JjBackendFactory } from './jj-handler-context'

export class JjHandler {
  constructor(
    dispatcher: RelayDispatcher,
    private readonly backendFactory: JjBackendFactory = createRelayJjBackend
  ) {
    registerJjHandlers(dispatcher, {
      detect: (params, context) => this.named(namedHandlers.detect, params, context),
      listWorkspaces: (params, context) =>
        this.named(namedHandlers.listWorkspaces, params, context),
      addWorkspace: (params, context) =>
        this.mutation(mutationHandlers.addWorkspace, params, context),
      removeWorkspace: (params, context) =>
        this.mutation(mutationHandlers.removeWorkspace, params, context),
      listChanges: (params, context) => this.named(namedHandlers.listChanges, params, context),
      readFileDiff: (params, context) => readFileDiff(params, context, this.backendFactory),
      getCurrentChangeMetadata: (params, context) =>
        this.named(namedHandlers.getCurrentChangeMetadata, params, context),
      listLocalBookmarks: (params, context) =>
        this.named(namedHandlers.listLocalBookmarks, params, context),
      listRemotes: (params, context) => this.named(namedHandlers.listRemotes, params, context),
      fetchRemote: (params, context) =>
        this.mutation(mutationHandlers.fetchRemote, params, context),
      pushBookmark: (params, context) =>
        this.mutation(mutationHandlers.pushBookmark, params, context),
      describe: (params, context) => this.mutation(mutationHandlers.describe, params, context),
      createBookmark: (params, context) =>
        this.mutation(mutationHandlers.createBookmark, params, context),
      moveBookmark: (params, context) =>
        this.mutation(mutationHandlers.moveBookmark, params, context),
      commit: (params, context) => this.mutation(mutationHandlers.commit, params, context),
      updateWorkspaceStale: (params, context) =>
        this.mutation(mutationHandlers.updateWorkspaceStale, params, context)
    })
  }

  private named(
    operation: (
      params: Record<string, unknown>,
      context: RequestContext,
      backendFactory: JjBackendFactory
    ) => Promise<unknown>,
    params: Record<string, unknown>,
    context: RequestContext
  ): Promise<unknown> {
    return operation(params, context, this.backendFactory)
  }

  private mutation(
    operation: (
      params: Record<string, unknown>,
      context: RequestContext,
      backendFactory: JjBackendFactory
    ) => Promise<unknown>,
    params: Record<string, unknown>,
    context: RequestContext
  ): Promise<unknown> {
    return operation(params, context, this.backendFactory)
  }
}
