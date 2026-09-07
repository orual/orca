import type { ChildProcess } from 'node:child_process'
import type { ProcessSpec } from './process-spec'
import type { createOutputSink } from './bounded-output-sink'
type OutputSink = ReturnType<typeof createOutputSink>

export function attachProcessOutputListeners(
  child: ChildProcess,
  stdout: OutputSink,
  stderr: OutputSink,
  spec: ProcessSpec
): void {
  child.stdout?.on('data', (chunk: Buffer | string) => stdout.write(chunk))
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr.write(chunk)
    if (typeof spec.terminationBarrier === 'object') {
      spec.terminationBarrier.observeStderr?.(chunk)
    }
  })
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream?.on('error', () => {})
  }
}
