import type { ChildProcess } from 'node:child_process'
import { forceTerminateProcessTree, signalProcessTree } from './process-tree-termination'
import type { ProcessSpec } from './process-spec'

export const PROCESS_EXIT_GRACE_MS = 2_000
export const BARRIER_UNVERIFIED_EXIT_GRACE_MS = 10_000

type Exit = { code: number | null; signal: NodeJS.Signals | null }
export type TerminationLifecycle = {
  stopping: boolean
  exitedBeforeStopping: boolean
  attemptComplete: boolean
  verified: boolean
  initial: Promise<boolean> | undefined
  exit: Exit | null
  close: Exit | null
  error: Error | null
  graceTimer: ReturnType<typeof setTimeout> | undefined
  deadlineTimer: ReturnType<typeof setTimeout> | undefined
  stop: () => void
  onError: (error: Error) => void
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void
  onClose: (code: number | null, signal: NodeJS.Signals | null) => void
}

type Args = {
  child: ChildProcess
  spec: ProcessSpec
  terminate: (signal?: NodeJS.Signals) => void
  settle: (action: () => void) => void
  resolve: (code: number | null, signal: NodeJS.Signals | null) => void
  report: () => void
  reportIf: (condition: boolean) => void
}

export function terminateProcess(child: ChildProcess, signal?: NodeJS.Signals): void {
  try {
    child.kill(signal)
  } catch {
    /* already gone */
  }
}

export function createTerminationLifecycle(args: Args): TerminationLifecycle {
  const state: Omit<TerminationLifecycle, 'stop' | 'onError' | 'onExit' | 'onClose'> = {
    stopping: false,
    exitedBeforeStopping: false,
    attemptComplete: false,
    verified: false,
    initial: undefined as Promise<boolean> | undefined,
    exit: null as Exit | null,
    close: null as Exit | null,
    error: null as Error | null,
    graceTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    deadlineTimer: undefined as ReturnType<typeof setTimeout> | undefined
  }
  const signal = (killSignal?: NodeJS.Signals): Promise<boolean> =>
    (typeof args.spec.terminationBarrier === 'object'
      ? args.spec.terminationBarrier.signal(args.child, killSignal)
      : signalProcessTree(args.child, killSignal)
    ).catch(() => false)
  const force = (): Promise<boolean> =>
    (typeof args.spec.terminationBarrier === 'object'
      ? args.spec.terminationBarrier.force(args.child)
      : forceTerminateProcessTree(args.child)
    ).catch(() => false)
  const finish = (): void => {
    const root = state.close ?? state.exit
    if (state.error) {
      args.settle(() => {
        throw state.error
      })
      return
    }
    args.resolve(root?.code ?? null, root?.signal ?? null)
  }
  const resolveSafe = (): void => {
    const root = state.close ?? state.exit
    if (state.verified || (state.exitedBeforeStopping && root)) {
      finish()
      return
    }
    if (!state.attemptComplete) {
      return
    }
    state.deadlineTimer ??= setTimeout(finish, BARRIER_UNVERIFIED_EXIT_GRACE_MS)
    state.deadlineTimer.unref?.()
  }
  const escalate = (): void => {
    if (!args.spec.terminationBarrier) {
      args.terminate('SIGKILL')
      args.resolve(null, null)
      return
    }
    const initial = state.initial ?? Promise.resolve(false)
    if (process.platform === 'win32') {
      if (typeof args.spec.terminationBarrier === 'object') {
        void Promise.all([initial, force()]).then(([first, forced]) => {
          state.attemptComplete = true
          state.verified = first || forced
          args.reportIf(state.verified)
          if (!state.verified) {
            args.terminate('SIGKILL')
          }
          resolveSafe()
        })
      } else {
        void initial.then((verified) => {
          if (!verified) {
            args.terminate('SIGKILL')
          }
          state.attemptComplete = true
          state.verified = verified
          args.reportIf(verified)
          resolveSafe()
        })
      }
      return
    }
    void Promise.all([initial, force()]).then(([, forced]) => {
      state.attemptComplete = true
      state.verified = forced
      args.reportIf(forced)
      if (!forced) {
        args.terminate('SIGKILL')
      }
      resolveSafe()
    })
  }
  const stop = (): void => {
    if (state.stopping) {
      return
    }
    state.stopping = true
    if (args.spec.terminationBarrier) {
      state.initial ??= signal()
      if (process.platform === 'win32') {
        void state.initial.then((verified) => {
          if (!verified) {
            return
          }
          state.attemptComplete = true
          state.verified = true
          args.report()
          resolveSafe()
        })
      }
    } else {
      args.terminate()
    }
    state.graceTimer ??= setTimeout(escalate, PROCESS_EXIT_GRACE_MS)
    state.graceTimer.unref?.()
  }
  const onError = (error: Error): void => {
    args.reportIf(!args.child.pid)
    if (state.stopping) {
      state.error = error
      resolveSafe()
    } else {
      args.settle(() => {
        throw error
      })
    }
  }
  const onExit = (code: number | null, signalCode: NodeJS.Signals | null): void => {
    if (!state.stopping) {
      state.exitedBeforeStopping = true
    }
    state.exit = { code, signal: signalCode }
    if (state.stopping) {
      resolveSafe()
    }
  }
  const onClose = (code: number | null, signalCode: NodeJS.Signals | null): void => {
    args.report()
    if (!state.stopping) {
      state.exitedBeforeStopping = true
    }
    if (state.stopping) {
      state.close = { code, signal: signalCode }
      resolveSafe()
    } else {
      args.resolve(code, signalCode)
    }
  }
  return { ...state, stop, onError, onExit, onClose }
}
