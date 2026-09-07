import { describe, expect, it, vi } from 'vitest'
import type { ProcessSpec, ProcessResult } from '../../shared/child-process/process-spec'
import type * as RunProcessModule from '../../shared/child-process/run-process'

const runProcessMock = vi.hoisted(() => vi.fn())

vi.mock('../../shared/child-process/run-process', async (importOriginal) => {
  const actual = await importOriginal<typeof RunProcessModule>()
  runProcessMock.mockImplementation(async (spec: ProcessSpec): Promise<ProcessResult> => {
    if (spec.program !== 'wsl.exe') {
      return actual.runProcess(spec)
    }
    const command = spec.args?.at(-1)
    if (!command) {
      throw new Error('simulated WSL command was missing')
    }
    return actual.runProcess({
      ...spec,
      program: '/bin/sh',
      args: ['-lc', command]
    })
  })
  return { ...actual, runProcess: runProcessMock }
})

import { createDefaultExecutor } from './jj-backend'

describe('jj WSL default executor', () => {
  it('preserves a failing jj status while returning binary bytes', async () => {
    const executor = createDefaultExecutor({
      kind: 'wsl',
      cwd: '/tmp',
      distro: 'Ubuntu',
      program: 'sh'
    })
    const result = await executor({
      args: ['-c', 'printf "\\000\\377"; exit 7'],
      binary: true,
      maxOutputBytes: 32
    })
    expect(result.stdout).toEqual(Buffer.from([0, 255]))
    expect(result.code).toBe(7)
    expect(result.outputTruncated).not.toBe(true)
    expect(runProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'wsl.exe',
        args: expect.arrayContaining(['--exec', 'sh', '-lc']),
        outputEncoding: 'buffer'
      })
    )
    const request = runProcessMock.mock.calls[0]?.[0] as ProcessSpec
    expect(request.args?.at(-1)).toContain('ORCA_JJ_CAPTURE_FILE=$(mktemp)')
    expect(request.args?.at(-1)).toContain('head -c 32')
    expect(request.args?.at(-1)).toContain('_orca_jj_status=$?')
  })

  it('preserves cancellation provenance before starting the WSL process', async () => {
    const controller = new AbortController()
    controller.abort()
    const executor = createDefaultExecutor({ kind: 'wsl', cwd: '/tmp', program: 'jj' })
    const result = await executor({ args: ['--version'], signal: controller.signal })
    expect(result.cancelled).toBe(true)
    expect(runProcessMock).toHaveBeenCalled()
  })
})
