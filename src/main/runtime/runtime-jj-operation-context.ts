import type { RuntimeGitTarget } from './runtime-git-command-target'
import { requireRuntimeJjBackend, type RuntimeJjRoute } from './runtime-jj-command-target'

export type RuntimeJjRequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

export type RuntimeJjCommandHost = {
  resolveRuntimeGitTarget(selector: string): Promise<RuntimeGitTarget>
}

export async function runRuntimeJj<TResult>(
  host: RuntimeJjCommandHost,
  selector: string,
  options: RuntimeJjRequestOptions | undefined,
  operation: (route: RuntimeJjRoute, target: RuntimeGitTarget) => Promise<TResult>
): Promise<TResult> {
  const target = await host.resolveRuntimeGitTarget(selector)
  const route = requireRuntimeJjBackend(target, options?.signal)
  return operation(route, target)
}
