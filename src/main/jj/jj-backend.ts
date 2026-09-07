import { runProcess } from '../../shared/child-process/run-process'
import {
  buildWslCapturedLoginShellCommand,
  buildWslExecArgs,
  quotePosixShell
} from '../../shared/wsl-login-shell-command'
import type { JjBackend, JjExecutor, JjExecutionTarget } from '../../shared/jj-types'
import { createJjOperations, JJ_MINIMUM_VERSION } from './jj-operations'

export async function createWslDirectory(
  distro: string,
  directory: string,
  cwd: string
): Promise<void> {
  const executor = createDefaultExecutor({ kind: 'wsl', distro, cwd, program: 'mkdir' })
  const result = await executor({ args: ['-p', '--', directory], timeoutMs: JJ_COMMAND_TIMEOUT_MS })
  if (result.code !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    throw new Error(stderr || `mkdir exited ${String(result.code)}`)
  }
}

export { JJ_MINIMUM_VERSION }
const JJ_COMMAND_TIMEOUT_MS = 30_000
const JJ_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const JJ_BINARY_CAPTURE_META = '__ORCA_JJ_BINARY_META__'
const JJ_BINARY_CAPTURE_OVERHEAD = 512

type JjBackendOptions = { executor?: JjExecutor }

export function createJjBackend(
  target: JjExecutionTarget,
  options: JjBackendOptions = {}
): JjBackend {
  const executor = options.executor ?? createDefaultExecutor(target)
  const run: JjExecutor = (request) =>
    executor({
      ...request,
      ...(target.kind === 'native' && target.cwd ? { cwd: request.cwd ?? target.cwd } : {}),
      timeoutMs: request.timeoutMs ?? JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: request.maxOutputBytes ?? JJ_MAX_OUTPUT_BYTES,
      ...(request.signal ? { signal: request.signal } : {})
    })
  return createJjOperations(run)
}

function buildWslBinaryCaptureCommand(command: string, maxOutputBytes: number): string {
  const outputFile = '$ORCA_JJ_CAPTURE_FILE'
  const maxBytes = String(maxOutputBytes)
  return [
    `ORCA_JJ_CAPTURE_FILE=$(mktemp) || exit 125`,
    `trap 'rm -f "$ORCA_JJ_CAPTURE_FILE"' EXIT`,
    `${command} >"${outputFile}"`,
    `_orca_jj_status=$?`,
    `_orca_jj_size=$(wc -c <"${outputFile}")`,
    `_orca_jj_truncated=0`,
    `if [ "$_orca_jj_size" -gt ${maxBytes} ]; then _orca_jj_truncated=1; fi`,
    `if [ -s "${outputFile}" ]; then head -c ${maxBytes} "${outputFile}" | base64 -w 0; fi`,
    `printf '\\n%s%s:%s\\n' '${JJ_BINARY_CAPTURE_META}' "$_orca_jj_status" "$_orca_jj_truncated"`,
    `exit "$_orca_jj_status"`
  ].join('\n')
}

function decodeWslBinaryCapture(value: string): {
  bytes: Buffer
  code: number | null
  truncated: boolean
} {
  const marker = value.lastIndexOf(`\n${JJ_BINARY_CAPTURE_META}`)
  if (marker === -1) {
    return { bytes: Buffer.alloc(0), code: null, truncated: false }
  }
  const [statusText, truncatedText] = value
    .slice(marker + JJ_BINARY_CAPTURE_META.length + 1)
    .trim()
    .split(':')
  const status = Number(statusText)
  return {
    bytes: Buffer.from(value.slice(0, marker), 'base64'),
    code: Number.isInteger(status) ? status : null,
    truncated: truncatedText === '1'
  }
}

export function createDefaultExecutor(target: JjExecutionTarget): JjExecutor {
  if (target.kind === 'native') {
    return async ({ args, cwd, timeoutMs, maxOutputBytes, binary, signal }) => {
      const result = await runProcess({
        program: target.program ?? 'jj',
        args,
        cwd: cwd ?? target.cwd,
        timeoutMs,
        maxOutputBytes,
        ...(binary ? { outputEncoding: 'buffer' as const } : {}),
        ...(signal ? { signal } : {})
      })
      return {
        ...result,
        ...(binary && result.stdoutBuffer ? { stdout: result.stdoutBuffer } : {})
      }
    }
  }
  return async ({ args, cwd, timeoutMs, maxOutputBytes, binary, signal }) => {
    const command = [quotePosixShell(target.program ?? 'jj'), ...args.map(quotePosixShell)].join(
      ' '
    )
    const guestCwd = cwd ?? target.cwd
    const guestCommand = guestCwd ? `cd ${quotePosixShell(guestCwd)} && ${command}` : command
    const captureCommand = binary
      ? buildWslBinaryCaptureCommand(guestCommand, maxOutputBytes ?? JJ_MAX_OUTPUT_BYTES)
      : guestCommand
    const captured = buildWslCapturedLoginShellCommand(captureCommand)
    const result = await runProcess({
      program: 'wsl.exe',
      args: buildWslExecArgs(target.distro, ['sh', '-lc', captured.command]),
      timeoutMs,
      maxOutputBytes: binary
        ? Math.ceil(((maxOutputBytes ?? JJ_MAX_OUTPUT_BYTES) * 4) / 3) + JJ_BINARY_CAPTURE_OVERHEAD
        : maxOutputBytes,
      ...(signal ? { signal } : {}),
      ...(binary ? { outputEncoding: 'buffer' as const } : {})
    })
    const rawStdout =
      binary && result.stdoutBuffer ? result.stdoutBuffer.toString('utf8') : result.stdout
    const stdout = captured.readStdout(rawStdout)
    if (stdout === null) {
      return { ...result, stdout: '', code: null }
    }
    if (!binary) {
      return { ...result, stdout }
    }
    const decoded = decodeWslBinaryCapture(stdout)
    return {
      ...result,
      stdout: decoded.bytes,
      ...(decoded.code === null ? { code: null } : { code: decoded.code }),
      ...(decoded.truncated ? { outputTruncated: true } : {})
    }
  }
}
