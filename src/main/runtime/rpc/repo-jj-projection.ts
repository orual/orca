import { JJ_REPO_KIND_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import type { Repo } from '../../../shared/repo-types'
import type { RuntimeWorktreeListingOptions } from '../runtime-managed-worktree-queries'
import type { RpcContext } from './core'

export function clientCanObserveJjRepos(context: Pick<RpcContext, 'clientCapabilities'>): boolean {
  return context.clientCapabilities?.includes(JJ_REPO_KIND_RUNTIME_CAPABILITY) === true
}

export function projectJjReposForClient<T extends Repo>(
  repos: readonly T[],
  context: Pick<RpcContext, 'clientCapabilities'>
): T[] {
  return clientCanObserveJjRepos(context) ? [...repos] : repos.filter((repo) => repo.kind !== 'jj')
}

/** Internal runtime projection; never derived from RPC input or persisted state. */
export function jjListingOptionsForClient(
  context: Pick<RpcContext, 'clientCapabilities'>
): RuntimeWorktreeListingOptions | undefined {
  return clientCanObserveJjRepos(context) ? undefined : { excludeRepoKinds: ['jj'] }
}
