import {
  spawn as nodeSpawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams
} from 'node:child_process'
import { resolveSpawn } from './spawn-resolution'
import { forceTerminateProcessTree, signalProcessTree } from './process-tree-termination'
import { attachProcessOutputListeners } from './process-output-listeners'
import {
  terminateProcess,
  PROCESS_EXIT_GRACE_MS,
  BARRIER_UNVERIFIED_EXIT_GRACE_MS
} from './process-termination-lifecycle'

import { createOutputSink } from './bounded-output-sink'
import { createChildTerminationReporter } from './child-termination-reporter'

export type {
  ChildProcessHandle,
  SpawnedProcess,
  ProcessSpec,
  ProcessTerminationBarrier,
  ProcessResult
} from './process-spec'
export { runProcessSync } from './run-process-sync'
export { DEFAULT_PROCESS_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_BYTES } from './process-spec'
import type { ProcessSpec, ProcessResult } from './process-spec'
import { DEFAULT_PROCESS_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_BYTES } from './process-spec'

export { resolveSpawn } from './spawn-resolution'

/**
 * Start a child process. Use for long-lived or streaming children.
 *
 * The caller owns the returned streams, including their `error` events — an
 * unhandled one is an uncaught exception that takes the main process down.
 * `runProcess` handles that for you; here it cannot, because a blanket handler
 * would also defeat callers that track and remove their own listeners.
 */
export function spawnProcess(spec: ProcessSpec): ChildProcessWithoutNullStreams {
  const resolved = resolveSpawn(spec, process.platform)
  return nodeSpawn(
    resolved.file,
    [...resolved.args],
    resolved.options
  ) as ChildProcessWithoutNullStreams
}

/**
 * Run a child process to completion and capture its output.
 *
 * Never rejects on a non-zero exit — the exit code is data. Rejects only when
 * the process could not be started at all.
 */
export function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  if (spec.signal?.aborted) {
    spec.onChildTerminated?.()
    return Promise.resolve({
      code: null,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      cancelled: true
    })
  }
  const maxOutputBytes = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

  return new Promise<ProcessResult>((resolve, reject) => {
    const terminationReporter = createChildTerminationReporter(spec.onChildTerminated)
    let child: ChildProcess
    try {
      child = spawnProcess(spec)
    } catch (error) {
      terminationReporter.report()
      reject(error)
      return
    }

    const stdout = createOutputSink(maxOutputBytes)
    const stderr = createOutputSink(maxOutputBytes)
    let timedOut = false
    let cancelled = false
    let settled = false
    let barrierStopping = false
    let barrierAttemptComplete = false
    let barrierTerminationVerified = false
    let initialBarrierTermination: Promise<boolean> | undefined
    let deferredExit: { code: number | null; signal: NodeJS.Signals | null } | null = null
    let deferredClose: { code: number | null; signal: NodeJS.Signals | null } | null = null
    let deferredError: Error | null = null
    let rootExitedBeforeBarrier = false

    const settle = (act: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      clearTimeout(graceTimer)
      clearTimeout(barrierDeadlineTimer)
      spec.signal?.removeEventListener('abort', onAbort)
      act()
    }

    attachProcessOutputListeners(child, stdout, stderr, spec)

    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let barrierDeadlineTimer: ReturnType<typeof setTimeout> | undefined
    const signalBarrierTree = (signal?: NodeJS.Signals): Promise<boolean> =>
      (typeof spec.terminationBarrier === 'object'
        ? spec.terminationBarrier.signal(child, signal)
        : signalProcessTree(child, signal)
      ).catch(() => false)
    const forceBarrierTree = (): Promise<boolean> =>
      (typeof spec.terminationBarrier === 'object'
        ? spec.terminationBarrier.force(child)
        : forceTerminateProcessTree(child)
      ).catch(() => false)

    const resolveFromClose = (code: number | null, signal: NodeJS.Signals | null): void =>
      settle(() =>
        resolve({
          code,
          signal,
          stdout: stdout.text(),
          stderr: stderr.text(),
          ...(spec.outputEncoding === 'buffer'
            ? { stdoutBuffer: stdout.buffer(), stderrBuffer: stderr.buffer() }
            : {}),
          timedOut,
          cancelled,
          outputTruncated: stdout.truncated() || stderr.truncated()
        })
      )

    const settleBarrierOutcome = (): void => {
      const rootExit = deferredClose ?? deferredExit
      if (deferredError) {
        settle(() => reject(deferredError))
        return
      }
      resolveFromClose(rootExit?.code ?? null, rootExit?.signal ?? null)
    }

    const resolveBarrierIfSafe = (): void => {
      const rootExit = deferredClose ?? deferredExit
      if (barrierTerminationVerified || (rootExitedBeforeBarrier && rootExit)) {
        settleBarrierOutcome()
        return
      }
      if (!barrierAttemptComplete) {
        return
      }
      // Why a second deadline: the tree survived every attempt and the root has
      // gone silent, so nothing else will ever settle this promise.
      barrierDeadlineTimer ??= setTimeout(settleBarrierOutcome, BARRIER_UNVERIFIED_EXIT_GRACE_MS)
      barrierDeadlineTimer.unref?.()
    }

    /**
     * Stop the child, then settle.
     *
     * Without a barrier, settle whether or not the child complies. With one, wait
     * for verified tree termination or a root exit first — a descendant can keep
     * `close` pending after the root exits, but failed verification must not let
     * callers mutate shared state — then settle on the deadline regardless.
     */
    const stopAndSettle = (): void => {
      if (spec.terminationBarrier) {
        barrierStopping = true
        initialBarrierTermination ??= signalBarrierTree()
        if (process.platform === 'win32') {
          void initialBarrierTermination.then((terminated) => {
            if (!terminated) {
              return
            }
            barrierAttemptComplete = true
            barrierTerminationVerified = true
            terminationReporter.report()
            resolveBarrierIfSafe()
          })
        }
      } else {
        terminateProcess(child)
      }
      graceTimer ??= setTimeout(() => {
        if (spec.terminationBarrier) {
          const initialTermination = initialBarrierTermination ?? Promise.resolve(false)
          if (process.platform === 'win32') {
            if (typeof spec.terminationBarrier === 'object') {
              void Promise.all([initialTermination, forceBarrierTree()]).then(
                ([initialTerminated, forceTerminated]) => {
                  barrierAttemptComplete = true
                  barrierTerminationVerified = initialTerminated || forceTerminated
                  terminationReporter.reportIf(barrierTerminationVerified)
                  if (!barrierTerminationVerified) {
                    // The barrier never confirmed the tree died, so the root
                    // would otherwise outlive the abort or timeout.
                    terminateProcess(child, 'SIGKILL')
                  }
                  resolveBarrierIfSafe()
                }
              )
              return
            }
            void initialTermination.then((terminated) => {
              if (!terminated) {
                terminateProcess(child, 'SIGKILL')
              }
              barrierAttemptComplete = true
              barrierTerminationVerified = terminated
              terminationReporter.reportIf(barrierTerminationVerified)
              resolveBarrierIfSafe()
            })
            return
          }
          void Promise.all([initialTermination, forceBarrierTree()]).then(
            ([_initialTerminated, forceTerminated]) => {
              barrierAttemptComplete = true
              barrierTerminationVerified = forceTerminated
              terminationReporter.reportIf(barrierTerminationVerified)
              if (!barrierTerminationVerified) {
                terminateProcess(child, 'SIGKILL')
              }
              resolveBarrierIfSafe()
            }
          )
          return
        }
        terminateProcess(child, 'SIGKILL')
        resolveFromClose(null, null)
      }, PROCESS_EXIT_GRACE_MS)
      graceTimer.unref?.()
    }

    const timer =
      spec.timeoutMs === null
        ? undefined
        : setTimeout(() => {
            timedOut = true
            stopAndSettle()
          }, spec.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS)
    timer?.unref?.()

    // Why the same escalation: an aborted caller has stopped waiting, so an
    // unkillable child must not keep the promise alive on their behalf either.
    const onAbort = (): void => {
      cancelled = true
      stopAndSettle()
    }
    spec.signal?.addEventListener('abort', onAbort, { once: true })
    // Why check after subscribing: a signal that was already aborted never
    // fires the event, so the child would otherwise run to its full timeout on
    // behalf of a caller who had already given up.
    if (spec.signal?.aborted) {
      onAbort()
    }

    child.once('error', (error) => {
      terminationReporter.reportIf(!child.pid)
      if (barrierStopping) {
        deferredError = error
        resolveBarrierIfSafe()
        return
      }
      settle(() => reject(error))
    })
    child.once('exit', (code, signal) => {
      if (!barrierStopping) {
        rootExitedBeforeBarrier = true
      }
      deferredExit = { code, signal }
      if (barrierStopping) {
        resolveBarrierIfSafe()
      }
    })
    child.once('close', (code, signal) => {
      terminationReporter.report()
      if (!barrierStopping) {
        rootExitedBeforeBarrier = true
      }
      if (barrierStopping) {
        deferredClose = { code, signal }
        resolveBarrierIfSafe()
        return
      }
      resolveFromClose(code, signal)
    })

    // Why close rather than leave open: a child that reads stdin (a hook
    // draining its payload, a CLI probing for a TTY) otherwise blocks until the
    // timeout instead of seeing EOF immediately.
    child.stdin?.end(spec.input)
  })
}
