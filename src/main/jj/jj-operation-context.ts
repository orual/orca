import type { JjFailure, JjProcessResult, JjUncertainFailure } from '../../shared/jj-types'
import { failureForProcess, isSuccessful } from './jj-output-parsing'

export const JJ_COMMAND_TIMEOUT_MS = 30_000
export const JJ_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
export const WORKSPACE_TEMPLATE =
  'self.name().escape_json() ++ "\t" ++ if(self.root(), json(self.root()), "null") ++ "\n"'
export const CURRENT_CHANGE_TEMPLATE =
  'json(commit_id) ++ "\t" ++ json(change_id) ++ "\t" ++ json(description) ++ "\t" ++ json(conflict) ++ "\t" ++ json(local_bookmarks) ++ "\n"'
export const LOCAL_BOOKMARK_TEMPLATE =
  'json(name) ++ "\t" ++ if(normal_target, json(normal_target.commit_id()), "null") ++ "\n"'

export type JjMutationResult = { ok: true } | JjFailure | JjUncertainFailure

export function mutationResult(result: JjProcessResult, operation: string): JjMutationResult {
  if (result.timedOut || result.cancelled || result.code === null) {
    return {
      ok: false,
      kind: 'uncertain',
      uncertain: true,
      message: result.cancelled
        ? `${operation} was cancelled after launch; outcome is uncertain.`
        : `${operation} timed out; outcome is uncertain.`
    }
  }
  if (!isSuccessful(result)) {
    return failureForProcess(result, operation)
  }
  return { ok: true }
}

export function uncertainMutation(operation: string, error: unknown): JjUncertainFailure {
  return {
    ok: false,
    kind: 'uncertain',
    uncertain: true,
    message: `${operation} outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`
  }
}
