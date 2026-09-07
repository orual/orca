import type { JjBackend } from '../../shared/jj-types'
import { createDefaultExecutor, createJjBackend } from '../jj/jj-backend'
import { requireSshJjProvider } from '../providers/ssh-jj-dispatch'
import type { SshJjProvider } from '../providers/ssh-jj-provider'
import { ExecutionHostNotDispatchableError } from '../providers/execution-host-provider-dispatch'
import { LOCAL_EXECUTION_HOST_ID, parseExecutionHostId } from '../../shared/execution-host'
import type { GitRuntimeOptions } from '../git/git-runtime-options'
import { toWslExecutionSpace } from '../../shared/wsl-paths'
import type { RuntimeGitTarget } from './runtime-git-command-target'

export type RuntimeJjRoute =
  | { kind: 'local'; backend: JjBackend; target: 'native' | 'wsl'; wslDistro?: string }
  | { kind: 'ssh'; connectionId: string; provider: SshJjProvider }

export function requireRuntimeJjBackend(
  target: RuntimeGitTarget,
  signal?: AbortSignal
): RuntimeJjRoute {
  const route = parseExecutionHostId(target.executionHostId)
  if (!route) {
    throw new Error(`Cannot route jj work: ${target.executionHostId}`)
  }
  switch (route.kind) {
    case 'local': {
      const options = localJjOptionsForTarget(target)
      const executionTarget = options.wslDistro
        ? {
            kind: 'wsl' as const,
            cwd: toWslExecutionSpace(target.worktree.path),
            distro: options.wslDistro
          }
        : { kind: 'native' as const, cwd: target.worktree.path }
      const defaultExecutor = createDefaultExecutor(executionTarget)
      const backend = createJjBackend(executionTarget, {
        executor: (request) =>
          defaultExecutor({
            ...request,
            ...(request.signal || !signal ? {} : { signal })
          })
      })
      return {
        kind: 'local',
        backend,
        target: options.wslDistro ? 'wsl' : 'native',
        ...(options.wslDistro ? { wslDistro: options.wslDistro } : {})
      }
    }
    case 'ssh':
      return {
        kind: 'ssh',
        connectionId: route.targetId,
        provider: requireSshJjProvider(route.targetId)
      }
    case 'runtime':
      throw new ExecutionHostNotDispatchableError(route.id)
  }
}

export function localJjOptionsForTarget(target: RuntimeGitTarget): GitRuntimeOptions {
  return target.executionHostId === LOCAL_EXECUTION_HOST_ID ? (target.localGitOptions ?? {}) : {}
}
