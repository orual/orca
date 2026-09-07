import { spawnSync as nodeSpawnSync } from 'node:child_process'
import { DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_PROCESS_TIMEOUT_MS } from './process-spec'
import type { ProcessResult, ProcessSpec } from './process-spec'
import { resolveSpawn } from './spawn-resolution'

/** Synchronous process execution for CLI entry points and teardown paths. */
export function runProcessSync(spec: ProcessSpec): ProcessResult {
  const resolved = resolveSpawn(spec, process.platform)
  const result = nodeSpawnSync(resolved.file, [...resolved.args], {
    ...resolved.options,
    input: spec.input,
    timeout: spec.timeoutMs === null ? undefined : (spec.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS),
    maxBuffer: spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    encoding: 'buffer'
  })
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') {
    throw result.error
  }
  return {
    code: result.status,
    signal: result.signal,
    stdout: Buffer.from(result.stdout ?? '').toString('utf8'),
    stderr: Buffer.from(result.stderr ?? '').toString('utf8'),
    outputTruncated: false,
    timedOut: (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
  }
}
