import type {
  JjExecutor,
  JjFailure,
  JjFileDiffInput,
  JjFileDiffResult,
  JjParentDiff
} from '../../shared/jj-types'
import { buildDiffResult } from '../git/source-control/diff-result'
import { listJjChangesWithParents, resolveJjParents } from './jj-change-listing'
import {
  bytesToDiffContent,
  failureForProcess,
  failureForThrown,
  isSuccessful,
  normalizeRepoPath
} from './jj-output-parsing'
import { JJ_COMMAND_TIMEOUT_MS, JJ_MAX_OUTPUT_BYTES } from './jj-operation-context'

type RawBytes = { bytes: Buffer; present: boolean }

export async function readFileDiff(
  run: JjExecutor,
  input: JjFileDiffInput
): Promise<JjFileDiffResult> {
  const path = normalizeRepoPath(input.path)
  if (!path) {
    return {
      ok: false,
      kind: 'stale',
      message: 'The jj file path is invalid or outside the workspace.'
    }
  }
  const revision = input.revision ?? '@'
  const fileset = `file:${JSON.stringify(path)}`
  try {
    const parentResult = input.parentRevision
      ? { revisions: [input.parentRevision] }
      : await resolveJjParents(run, revision)
    if ('ok' in parentResult) {
      return parentResult
    }
    const changesResult = await listJjChangesWithParents(run, revision, parentResult.revisions)
    if (!changesResult.ok) {
      return changesResult
    }
    const detailedChange = changesResult.changes.find((entry) => entry.change.path === path) ?? null
    if (!detailedChange) {
      return {
        ok: false,
        kind: 'stale',
        message: `The jj path is not in the current change: ${path}`
      }
    }
    const change = detailedChange.change
    const parentRevisions = parentResult.revisions
    const targetPresent = detailedChange.parentChanges.every((entry) => entry.targetPresent)
    const modified = await readSide(run, revision, fileset, targetPresent)
    if ('ok' in modified) {
      return modified
    }
    const parentDiffs: JjParentDiff[] = []
    for (const parentRevision of parentRevisions) {
      const parentChange = detailedChange.parentChanges.find(
        (entry) => entry.parentRevision === parentRevision
      )
      const originalPath = parentChange?.change.originalPath ?? path
      const originalFileset = `file:${JSON.stringify(originalPath)}`
      const original = await readSide(
        run,
        parentRevision,
        originalFileset,
        parentChange?.sourcePresent ?? true
      )
      if ('ok' in original) {
        return original
      }
      const originalContent = bytesToDiffContent(original.bytes, path)
      const modifiedContent = bytesToDiffContent(modified.bytes, path)
      const parentDiff = buildDiffResult(
        originalContent.content,
        modifiedContent.content,
        originalContent.binary,
        modifiedContent.binary,
        path
      )
      parentDiffs.push({ parentRevision, diff: parentDiff })
    }
    const firstDiff = parentDiffs[0]?.diff
    if (!firstDiff) {
      return { ok: false, kind: 'stale', message: `The jj revision has no parent for: ${path}` }
    }
    return {
      ok: true,
      path,
      change,
      diff:
        firstDiff.kind === 'binary' && change.status === 'deleted'
          ? { ...firstDiff, modifiedDeleted: true }
          : firstDiff,
      ...(parentDiffs.length > 1 ? { parentDiffs } : {}),
      comparison: 'current-change-vs-parents'
    }
  } catch (error) {
    return failureForThrown(error, 'jj file diff')
  }
}

async function readSide(
  run: JjExecutor,
  revision: string,
  fileset: string,
  present: boolean
): Promise<RawBytes | JjFailure> {
  if (!present) {
    return { bytes: Buffer.alloc(0), present: false }
  }
  const result = await run({
    args: ['file', 'show', '--revision', revision, fileset],
    binary: true,
    timeoutMs: JJ_COMMAND_TIMEOUT_MS,
    maxOutputBytes: JJ_MAX_OUTPUT_BYTES
  })
  if (!isSuccessful(result)) {
    return failureForProcess(result, 'jj file show')
  }
  const bytes =
    result.stdoutBuffer ??
    (Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout))
  return { bytes, present: true }
}
