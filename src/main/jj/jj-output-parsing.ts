import type { JjChange, JjFailure, JjProcessResult } from '../../shared/jj-types'
import { isBinaryBuffer } from '../../shared/binary-buffer'
import { PREVIEWABLE_BINARY_MIME_TYPES } from '../git/source-control/previewable-binary-mime-types'

export const JJ_MINIMUM_VERSION = '0.44.0'

export function parseChanges(output: string): JjChange[] {
  return parseChangesWithPresence(output).map(({ change }) => change)
}

export type JjChangeWithPresence = {
  change: JjChange
  sourcePresent: boolean
  targetPresent: boolean
}

export function parseChangesWithPresence(output: string): JjChangeWithPresence[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t')
      const path = JSON.parse(fields[0] ?? 'null')
      const conflicted = fields[3] === 'true' || fields[4] === 'true'
      if (typeof path !== 'string') {
        throw new Error('invalid jj diff path')
      }
      const originalPath = fields[1] === 'null' ? undefined : JSON.parse(fields[1] ?? 'null')
      if (originalPath !== undefined && typeof originalPath !== 'string') {
        throw new Error('invalid jj original path')
      }
      const sourceType = fields[5] ?? ''
      const targetType = fields[6] ?? ''
      return {
        change: {
          path,
          ...(originalPath !== undefined ? { originalPath } : {}),
          status: conflicted ? 'conflicted' : mapChangeStatus(fields[2] ?? '')
        },
        sourcePresent: sourceType !== '',
        targetPresent: targetType !== ''
      }
    })
}

export function normalizeRepoPath(value: string): string | null {
  if (!value || value.startsWith('/') || (value.length >= 3 && /^[A-Za-z]:\//.test(value))) {
    return null
  }
  const segments = value.split('/')
  return segments.some((segment) => !segment || segment === '..' || segment === '.') ? null : value
}

export function bytesToDiffContent(
  bytes: Buffer,
  path: string
): { content: string; binary: boolean } {
  const binary = isBinaryBuffer(bytes)
  if (!binary) {
    return { content: bytes.toString('utf8'), binary: false }
  }
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.')).toLowerCase() : ''
  const mimeType = PREVIEWABLE_BINARY_MIME_TYPES[extension]
  return { content: mimeType ? bytes.toString('base64') : '', binary: true }
}

export function isSuccessful(result: JjProcessResult): boolean {
  return result.code === 0 && !result.timedOut && !result.outputTruncated
}

export function text(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value
}

function mapChangeStatus(value: string): JjChange['status'] {
  if (
    value === 'modified' ||
    value === 'added' ||
    value === 'removed' ||
    value === 'copied' ||
    value === 'renamed'
  ) {
    return value === 'removed' ? 'deleted' : value
  }
  throw new Error(`Unknown jj diff status: ${value}`)
}

export function parseJjVersion(
  output: string
): { version: string; major: number; minor: number; patch: number } | null {
  const match = /^jj\s+(\d+)\.(\d+)\.(\d+)(?:[-+][^\s]+)?/m.exec(output.trim())
  if (!match) {
    return null
  }
  return {
    version: `${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  }
}

export function compareVersion(
  version: { major: number; minor: number; patch: number },
  minimum: [number, number, number]
): number {
  return version.major - minimum[0] || version.minor - minimum[1] || version.patch - minimum[2]
}

export function failureForProcess(result: JjProcessResult, operation: string): JjFailure {
  const stderr = text(result.stderr).trim()
  if (result.cancelled) {
    return { ok: false, kind: 'cancelled', message: `${operation} was cancelled.` }
  }
  const message = stderr || `${operation} exited with code ${result.code ?? 'unknown'}.`
  const lower = message.toLowerCase()
  const kind: JjFailure['kind'] =
    result.code === 127 ||
    lower.includes('command not found') ||
    lower.includes('no such file or directory')
      ? 'unavailable'
      : lower.includes('not a jj repository') ||
          lower.includes('there is no jj repo') ||
          lower.includes('workspace is stale') ||
          lower.includes('working copy is stale')
        ? 'stale'
        : 'error'
  return { ok: false, kind, message, ...(stderr ? { stderr } : {}) }
}

export function failureForThrown(error: unknown, operation: string): JjFailure {
  if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
    return {
      ok: false,
      kind: 'unavailable',
      message: 'jj is not installed or could not be started.'
    }
  }
  return {
    ok: false,
    kind: 'error',
    message: `${operation} failed: ${error instanceof Error ? error.message : String(error)}`
  }
}
