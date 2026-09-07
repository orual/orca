import { buildWindowsCmdShimCommandLine, isCmdInterpretedProgram } from './windows-command-line'
import type { SpawnOptions as NodeSpawnOptions } from 'node:child_process'
import type { ProcessSpec } from './process-spec'

export type ResolvedSpawn = { file: string; args: readonly string[]; options: NodeSpawnOptions }

export function resolveSpawn(spec: ProcessSpec, platform: NodeJS.Platform): ResolvedSpawn {
  const args = spec.args ?? []
  const base: NodeSpawnOptions = {
    cwd: spec.cwd,
    env: spec.env,
    stdio: spec.stdio ?? ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: spec.detached,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
    shell: false,
    ...(spec.terminationBarrier && platform !== 'win32' ? { detached: true } : {})
  }
  if (platform !== 'win32' || !isCmdInterpretedProgram(spec.program)) {
    return { file: spec.program, args, options: base }
  }
  const comSpec = spec.env?.ComSpec ?? process.env.ComSpec ?? 'cmd.exe'
  return {
    file: comSpec,
    args: [buildWindowsCmdShimCommandLine(spec.program, args)],
    options: { ...base, windowsVerbatimArguments: true }
  }
}
