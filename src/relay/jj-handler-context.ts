import { isAbsolute } from 'node:path'
import { runProcess } from '../shared/child-process/run-process'
import type { JjBackend, JjCommandRequest, JjExecutor } from '../shared/jj-types'
import { createJjBackend } from '../main/jj/jj-backend'
import type { RequestContext } from './dispatcher'

export const MAX_JJ_STRING_LENGTH = 8 * 1024
const MAX_JJ_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_JJ_RESULT_MESSAGE_LENGTH = 512

export type JjBackendFactory = (repoPath: string, signal?: AbortSignal) => JjBackend

export function backendForRequest(
  params: Record<string, unknown>,
  context: RequestContext,
  backendFactory: JjBackendFactory
): JjBackend {
  return backendFactory(requireRepoPath(params), context.signal)
}

export function createRelayJjBackend(repoPath: string, signal?: AbortSignal): JjBackend {
  const executor: JjExecutor = async (request: JjCommandRequest) => {
    const result = await runProcess({
      program: 'jj',
      args: request.args,
      cwd: request.cwd ?? repoPath,
      timeoutMs: request.timeoutMs,
      maxOutputBytes: request.maxOutputBytes,
      ...(request.binary ? { outputEncoding: 'buffer' as const } : {}),
      ...(signal ? { signal } : {})
    })
    return {
      ...result,
      ...(request.binary && result.stdoutBuffer ? { stdout: result.stdoutBuffer } : {})
    }
  }
  return createJjBackend({ kind: 'native', cwd: repoPath, program: 'jj' }, { executor })
}

export function requireRepoPath(params: Record<string, unknown>): string {
  const repoPath = params.repoPath
  if (
    typeof repoPath !== 'string' ||
    !repoPath ||
    repoPath.length > MAX_JJ_STRING_LENGTH ||
    repoPath.includes('\0') ||
    !isAbsolute(repoPath)
  ) {
    throw new Error('Invalid jj repository path.')
  }
  return repoPath
}

export function boundResult<T>(result: T): T {
  let bytes = 0
  try {
    bytes = Buffer.byteLength(JSON.stringify(result), 'utf8')
  } catch {
    return typedOverflowFailure() as T
  }
  return bytes <= MAX_JJ_RESPONSE_BYTES ? result : (typedOverflowFailure() as T)
}

function typedOverflowFailure(): {
  ok: false
  kind: 'error'
  message: string
} {
  return {
    ok: false,
    kind: 'error',
    message: `jj response exceeded the ${MAX_JJ_RESPONSE_BYTES} byte transport limit`.slice(
      0,
      MAX_JJ_RESULT_MESSAGE_LENGTH
    )
  }
}
