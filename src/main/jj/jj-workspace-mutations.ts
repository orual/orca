import type {
  JjExecutor,
  JjProcessResult,
  JjWorkspaceAddInput,
  JjWorkspaceAddResult,
  JjWorkspaceRemoveInput,
  JjWorkspaceRemoveResult,
  JjWorkspaceStaleRecoveryResult
} from '../../shared/jj-types'
import { failureForProcess, failureForThrown, isSuccessful } from './jj-output-parsing'
import { JJ_COMMAND_TIMEOUT_MS, JJ_MAX_OUTPUT_BYTES } from './jj-operation-context'

export async function addWorkspace(
  run: JjExecutor,
  input: JjWorkspaceAddInput
): Promise<JjWorkspaceAddResult> {
  if (!input.destination) {
    return { ok: false, kind: 'error', message: 'A workspace destination is required.' }
  }
  try {
    const args = [
      'workspace',
      'add',
      ...(input.name ? ['--name', input.name] : []),
      ...(input.revision ? ['--revision', input.revision] : []),
      '--',
      input.destination
    ]
    const result = await run({
      args,
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    if (!isSuccessful(result)) {
      return failureForProcess(result, 'jj workspace add')
    }
    return { ok: true, destination: input.destination, ...(input.name ? { name: input.name } : {}) }
  } catch (error) {
    return failureForThrown(error, 'jj workspace add')
  }
}

export async function removeWorkspace(
  run: JjExecutor,
  input: JjWorkspaceRemoveInput
): Promise<JjWorkspaceRemoveResult> {
  if (!input.name || !input.targetRoot || !input.ownerRoot) {
    return {
      ok: false,
      kind: 'error',
      message: 'A workspace name, target root, and owner root are required.'
    }
  }
  let snapshot: JjProcessResult
  try {
    snapshot = await run({
      args: ['status'],
      cwd: input.targetRoot,
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
  } catch (error) {
    return {
      ok: false,
      kind: 'error',
      message: `jj workspace snapshot failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (!isSuccessful(snapshot)) {
    return failureForProcess(snapshot, 'jj workspace snapshot')
  }

  let forgotten: JjProcessResult
  try {
    forgotten = await run({
      args: ['workspace', 'forget', '--', input.name],
      cwd: input.ownerRoot,
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
  } catch (error) {
    return {
      ok: false,
      kind: 'uncertain',
      uncertain: true,
      message: `jj workspace forget outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (forgotten.timedOut || forgotten.cancelled || forgotten.code === null) {
    return {
      ok: false,
      kind: 'uncertain',
      uncertain: true,
      message: forgotten.cancelled
        ? 'jj workspace forget was cancelled after launch; outcome is uncertain.'
        : 'jj workspace forget timed out; outcome is uncertain.'
    }
  }
  if (!isSuccessful(forgotten)) {
    return failureForProcess(forgotten, 'jj workspace forget')
  }
  return { ok: true }
}

export async function updateWorkspaceStale(
  run: JjExecutor
): Promise<JjWorkspaceStaleRecoveryResult> {
  try {
    const result = await run({
      args: ['workspace', 'update-stale'],
      timeoutMs: JJ_COMMAND_TIMEOUT_MS,
      maxOutputBytes: JJ_MAX_OUTPUT_BYTES
    })
    if (result.timedOut || result.cancelled || result.code === null) {
      return {
        ok: false,
        kind: 'uncertain',
        uncertain: true,
        message: result.cancelled
          ? 'jj workspace recovery was cancelled after launch; outcome is uncertain.'
          : 'jj workspace recovery timed out; outcome is uncertain.'
      }
    }
    if (!isSuccessful(result)) {
      return failureForProcess(result, 'jj workspace update-stale')
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      kind: 'uncertain',
      uncertain: true,
      message: `jj workspace recovery outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
