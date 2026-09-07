import type { JjChange, JjChangesResult, JjExecutor, JjFailure } from '../../shared/jj-types'
import { parseUnifiedDiffFileStats } from '../../shared/native-chat-diff'
import {
  failureForProcess,
  failureForThrown,
  isSuccessful,
  parseChangesWithPresence,
  text
} from './jj-output-parsing'
import type { JjChangeWithPresence } from './jj-output-parsing'

const JJ_COMMAND_TIMEOUT_MS = 30_000
const JJ_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const CHANGE_TEMPLATE =
  'json(self.path()) ++ "\t" ++ if(self.status() == "renamed", json(self.source().path()), "null") ++ "\t" ++ self.status() ++ "\t" ++ self.source().conflict() ++ "\t" ++ self.target().conflict() ++ "\t" ++ self.source().file_type() ++ "\t" ++ self.target().file_type() ++ "\n"'

export type JjParentChange = {
  parentRevision: string
  change: JjChange
  sourcePresent: boolean
  targetPresent: boolean
}

export type JjDetailedChange = {
  change: JjChange
  parentChanges: JjParentChange[]
}

export type JjDetailedChangesResult =
  | { ok: true; comparison: 'current-change-vs-parents'; changes: JjDetailedChange[] }
  | JjFailure

export async function listJjChanges(run: JjExecutor, revision = '@'): Promise<JjChangesResult> {
  const result = await listJjChangesWithParents(run, revision)
  if (!result.ok) {
    return result
  }
  return {
    ok: true,
    comparison: result.comparison,
    changes: result.changes.map(({ change }) => change)
  }
}

export async function listJjChangesWithParents(
  run: JjExecutor,
  revision = '@',
  parentRevision?: string | readonly string[]
): Promise<JjDetailedChangesResult> {
  try {
    const parentResult = parentRevision
      ? { revisions: Array.isArray(parentRevision) ? [...parentRevision] : [parentRevision] }
      : await resolveJjParents(run, revision)
    if ('ok' in parentResult) {
      return parentResult
    }
    const revisions = parentResult.revisions.length ? parentResult.revisions : [revision]
    const details = new Map<string, JjDetailedChange>()
    for (const parent of revisions) {
      const result = await listJjChangesAgainstParent(run, parent, revision)
      if (!result.ok) {
        return result
      }
      for (const entry of result.changes) {
        const detail = details.get(entry.change.path)
        if (detail) {
          detail.parentChanges.push({ ...entry, parentRevision: parent })
          // A merge has multiple valid parent comparisons; do not present their counts as one diff.
          detail.change.stats = undefined
        } else {
          details.set(entry.change.path, {
            change: { ...entry.change },
            parentChanges: [{ ...entry, parentRevision: parent }]
          })
        }
      }
    }
    return { ok: true, comparison: 'current-change-vs-parents', changes: [...details.values()] }
  } catch (error) {
    return failureForThrown(error, 'jj diff')
  }
}

export async function resolveJjParents(
  run: JjExecutor,
  revision: string
): Promise<{ revisions: string[] } | JjFailure> {
  const result = await run({
    args: [
      'log',
      '--no-graph',
      '--template',
      'commit_id ++ "\\n"',
      '--revisions',
      `parents(${revision})`
    ],
    timeoutMs: JJ_COMMAND_TIMEOUT_MS,
    maxOutputBytes: JJ_MAX_OUTPUT_BYTES
  })
  if (!isSuccessful(result)) {
    return failureForProcess(result, 'jj parent resolution')
  }
  return {
    revisions: text(result.stdout)
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
  }
}

async function listJjChangesAgainstParent(
  run: JjExecutor,
  parentRevision: string,
  revision: string
): Promise<{ ok: true; changes: JjChangeWithPresence[] } | JjFailure> {
  const result = await run({
    args: ['diff', '--from', parentRevision, '--to', revision, '--template', CHANGE_TEMPLATE],
    timeoutMs: JJ_COMMAND_TIMEOUT_MS,
    maxOutputBytes: JJ_MAX_OUTPUT_BYTES
  })
  if (!isSuccessful(result)) {
    return failureForProcess(result, 'jj diff')
  }
  const changes = parseChangesWithPresence(text(result.stdout))
  const patch = await run({
    args: ['diff', '--git', '--from', parentRevision, '--to', revision],
    timeoutMs: JJ_COMMAND_TIMEOUT_MS,
    maxOutputBytes: JJ_MAX_OUTPUT_BYTES
  })
  if (isSuccessful(patch)) {
    const statsByPath = new Map(
      parseUnifiedDiffFileStats(text(patch.stdout)).map((stats) => [stats.path, stats])
    )
    for (const entry of changes) {
      const stats = statsByPath.get(entry.change.path)
      if (stats) {
        entry.change.stats = { added: stats.additions, removed: stats.deletions }
      }
    }
  }
  return { ok: true, changes }
}
