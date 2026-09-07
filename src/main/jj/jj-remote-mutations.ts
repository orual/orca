import type {
  JjExecutor,
  JjRemoteFetchInput,
  JjRemoteFetchResult,
  JjRemotePushInput,
  JjRemotePushResult
} from '../../shared/jj-types'
import {
  JJ_COMMAND_TIMEOUT_MS,
  JJ_MAX_OUTPUT_BYTES,
  mutationResult,
  uncertainMutation
} from './jj-operation-context'

export async function fetchRemote(
  run: JjExecutor,
  input: JjRemoteFetchInput
): Promise<JjRemoteFetchResult> {
  if (!input.remote || input.remote.includes('\0') || input.remote.startsWith('-')) {
    return { ok: false, kind: 'error', message: 'A valid jj remote is required.' }
  }
  try {
    const result = await run({
      args: ['--ignore-working-copy', 'git', 'fetch', '--remote', input.remote],
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    return mutationResult(result, 'jj git fetch')
  } catch (error) {
    return uncertainMutation('jj git fetch', error)
  }
}

export async function pushBookmark(
  run: JjExecutor,
  input: JjRemotePushInput
): Promise<JjRemotePushResult> {
  if (
    !input.remote ||
    !input.bookmark ||
    input.remote.includes('\0') ||
    input.bookmark.includes('\0') ||
    input.remote.startsWith('-') ||
    input.bookmark.startsWith('-')
  ) {
    return { ok: false, kind: 'error', message: 'A valid jj remote and bookmark are required.' }
  }
  try {
    const result = await run({
      args: [
        '--ignore-working-copy',
        'git',
        'push',
        '--remote',
        input.remote,
        '--bookmark',
        `exact:${input.bookmark}`
      ],
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    return mutationResult(result, 'jj git push')
  } catch (error) {
    return uncertainMutation('jj git push', error)
  }
}
