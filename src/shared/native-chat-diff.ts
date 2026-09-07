import { decodeGitCQuotedPath } from './git-cquoted-path'

export type NativeChatDiffLineKind = 'add' | 'del' | 'context' | 'meta'

export type NativeChatDiffLine = {
  kind: NativeChatDiffLineKind
  text: string
}

const EDIT_TOOL_NAMES = new Set(['Edit', 'MultiEdit', 'Write', 'str_replace', 'apply_patch'])
const MAX_DIFF_CHARS = 32_000
const DEFAULT_MAX_DIFF_LINES = 120
const DIFF_TRUNCATED_LINE: NativeChatDiffLine = {
  kind: 'meta',
  text: '… diff truncated …'
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/
// Lines that open a new file section, so any hunk before them has ended.
const FILE_SECTION_START =
  /^(?:diff |index |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename |copy |Binary files )/
// Markdown thematic break or YAML document separator, not a marker.
const BARE_RULE = /^(?:-{3,}|\+{3,})$/

type DiffStructure = {
  /** Lines that are structure rather than content, so they never count as add/del. */
  metaIndices: Set<number>
  /** The text carries a hunk header or `diff --git`, so it is provably a diff. */
  isStructuredDiff: boolean
}

/**
 * Locates the `--- <old>` / `+++ <new>` file headers. A bare `---`/`+++` prefix
 * is not enough to spot one: a removed line whose content began with `--`
 * (SQL/Lua `-- comment`, C `--i`) is emitted as `---<content>`. Real headers
 * always come as an adjacent pair and never appear inside a hunk.
 */
function scanDiffStructure(lines: string[]): DiffStructure {
  const metaIndices = new Set<number>()
  let isStructuredDiff = false
  let inHunk = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.startsWith('@@')) {
      inHunk = true
      isStructuredDiff ||= HUNK_HEADER.test(line)
      continue
    }
    if (FILE_SECTION_START.test(line)) {
      inHunk = false
      isStructuredDiff ||= line.startsWith('diff --git ')
      continue
    }
    // Only marker lines can be a header or a rule; skip context and prose early.
    if (inHunk || !(line.startsWith('-') || line.startsWith('+'))) {
      continue
    }
    if (BARE_RULE.test(line)) {
      metaIndices.add(index)
      continue
    }
    if (line.startsWith('--- ') && (lines[index + 1] ?? '').startsWith('+++ ')) {
      metaIndices.add(index)
      metaIndices.add(index + 1)
      index += 1
    }
  }
  return { metaIndices, isStructuredDiff }
}

function toLines(value: unknown, maxLines: number): { lines: string[]; truncated: boolean } {
  if (typeof value !== 'string') {
    return { lines: [], truncated: false }
  }
  const clipped = value.slice(0, MAX_DIFF_CHARS)
  const lines = clipped.split('\n', maxLines + 1)
  const truncated = value.length > MAX_DIFF_CHARS || lines.length > maxLines
  const bounded = lines.slice(0, maxLines)
  if (!truncated && bounded.at(-1) === '') {
    bounded.pop()
  }
  return { lines: bounded, truncated }
}

function patchTextFromToolInput(value: Record<string, unknown>): string | null {
  if (typeof value.patch === 'string') {
    return value.patch
  }
  if (typeof value.diff === 'string') {
    return value.diff
  }
  if (!Array.isArray(value.changes)) {
    return null
  }
  const sections = value.changes.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const change = entry as Record<string, unknown>
    if (typeof change.diff !== 'string') {
      return []
    }
    const path = typeof change.path === 'string' ? change.path : 'file'
    const kind =
      typeof change.kind === 'object' && change.kind !== null
        ? (change.kind as Record<string, unknown>)
        : null
    const nextPath = kind && typeof kind.move_path === 'string' ? kind.move_path : path
    return [`--- ${path}\n+++ ${nextPath}\n${change.diff}`]
  })
  return sections.length > 0 ? sections.join('\n') : null
}

export function diffFromToolCall(
  name: string,
  input: unknown,
  maxLines = DEFAULT_MAX_DIFF_LINES
): NativeChatDiffLine[] | null {
  if (!EDIT_TOOL_NAMES.has(name) || typeof input !== 'object' || input === null) {
    return null
  }
  const value = input as Record<string, unknown>
  const patchText = patchTextFromToolInput(value)
  if (patchText !== null) {
    return diffFromText(patchText, maxLines)
  }
  const oldLines = toLines(value.old_string ?? value.oldString ?? value.old, maxLines)
  const newLines = toLines(
    value.new_string ?? value.newString ?? value.new ?? value.content ?? value.file_text,
    maxLines
  )
  const deleted = oldLines.lines.map((text): NativeChatDiffLine => ({ kind: 'del', text }))
  const added = newLines.lines.map((text): NativeChatDiffLine => ({ kind: 'add', text }))
  if (deleted.length === 0 && added.length === 0) {
    return null
  }
  const path = value.file_path ?? value.path
  const prefix: NativeChatDiffLine[] =
    typeof path === 'string' ? [{ kind: 'meta', text: path }] : []
  const combined = [...prefix, ...deleted, ...added]
  const truncated = oldLines.truncated || newLines.truncated || combined.length > maxLines
  return truncated ? [...combined.slice(0, maxLines - 1), DIFF_TRUNCATED_LINE] : combined
}

export function countUnifiedDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  let inHunk = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) {
      continue
    }
    if (line.startsWith('+')) {
      additions += 1
    } else if (line.startsWith('-')) {
      deletions += 1
    }
  }
  return { additions, deletions }
}

export type UnifiedDiffFileStats = {
  path: string
  originalPath?: string
  additions: number
  deletions: number
}

export function parseUnifiedDiffFileStats(diff: string): UnifiedDiffFileStats[] {
  const sections: UnifiedDiffFileStats[] = []
  let sectionStart = -1
  const lines = diff.split(/\r?\n/)
  for (let index = 0; index <= lines.length; index += 1) {
    const line = lines[index]
    if (line?.startsWith('diff --git ')) {
      if (sectionStart !== -1) {
        const parsed = parseUnifiedDiffFileStatsSection(lines.slice(sectionStart, index))
        if (parsed) {
          sections.push(parsed)
        }
      }
      sectionStart = index
    }
  }
  if (sectionStart !== -1) {
    const parsed = parseUnifiedDiffFileStatsSection(lines.slice(sectionStart))
    if (parsed) {
      sections.push(parsed)
    }
  }
  return sections
}

function parseUnifiedDiffFileStatsSection(lines: string[]): UnifiedDiffFileStats | null {
  const header = lines[0]
  if (!header) {
    return null
  }
  const headerPaths = parseGitDiffHeaderPaths(header)
  if (!headerPaths) {
    return null
  }
  const oldPath = decodeGitDiffHeaderPath(headerPaths[0], 'a/')
  const newPath = decodeGitDiffHeaderPath(headerPaths[1], 'b/')
  if (!oldPath || !newPath || lines.some((line) => line.startsWith('Binary files '))) {
    return null
  }
  const renameFrom = lines.find((line) => line.startsWith('rename from '))
  const renameTo = lines.find((line) => line.startsWith('rename to '))
  const path = renameTo ? renameTo.slice('rename to '.length) : newPath
  const originalPath = renameFrom ? renameFrom.slice('rename from '.length) : oldPath
  if (path === '/dev/null' || !lines.some((line) => line.startsWith('@@'))) {
    return null
  }
  const counts = countUnifiedDiffLines(lines.join('\n'))
  return {
    path,
    ...(originalPath !== path && originalPath !== '/dev/null' ? { originalPath } : {}),
    additions: counts.additions,
    deletions: counts.deletions
  }
}

function parseGitDiffHeaderPaths(header: string): [string, string] | null {
  const value = header.slice('diff --git '.length)
  if (value.startsWith('"')) {
    const firstEnd = findCQuotedEnd(value)
    if (firstEnd === -1) {
      return null
    }
    const secondStart = value.indexOf('"', firstEnd + 1)
    if (secondStart === -1) {
      return null
    }
    const secondEnd = findCQuotedEnd(value, secondStart)
    if (secondEnd === -1) {
      return null
    }
    return [value.slice(0, firstEnd + 1), value.slice(secondStart, secondEnd + 1)]
  }
  const separator = value.indexOf(' b/')
  if (separator === -1) {
    return null
  }
  return [value.slice(0, separator), value.slice(separator + 1)]
}

function findCQuotedEnd(value: string, start = 0): number {
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] !== '"') {
      continue
    }
    let backslashes = 0
    for (let previous = index - 1; previous >= start && value[previous] === '\\'; previous -= 1) {
      backslashes += 1
    }
    if (backslashes % 2 === 0) {
      return index
    }
  }
  return -1
}

function decodeGitDiffHeaderPath(value: string, prefix: string): string {
  const decoded = decodeGitCQuotedPath(value)
  return decoded.startsWith(prefix) ? decoded.slice(prefix.length) : decoded
}

export function diffFromText(
  text: string,
  maxLines = DEFAULT_MAX_DIFF_LINES
): NativeChatDiffLine[] | null {
  if (text.length === 0) {
    return null
  }
  const bounded = toLines(text, maxLines)
  const { metaIndices, isStructuredDiff } = scanDiffStructure(bounded.lines)
  let added = 0
  let removed = 0
  const lines = bounded.lines.map((line, index): NativeChatDiffLine => {
    if (
      metaIndices.has(index) ||
      line.startsWith('@@') ||
      line.startsWith('diff ') ||
      line.startsWith('index ')
    ) {
      return { kind: 'meta', text: line }
    }
    if (line.startsWith('+')) {
      added += 1
      return { kind: 'add', text: line.slice(1) }
    }
    if (line.startsWith('-')) {
      removed += 1
      return { kind: 'del', text: line.slice(1) }
    }
    return { kind: 'context', text: line }
  })
  // Proven diff text renders a single-line change; without that proof, two
  // markers guard against colouring prose that merely opens a line with `-`.
  if (added + removed < (isStructuredDiff ? 1 : 2)) {
    return null
  }
  return bounded.truncated ? [...lines.slice(0, maxLines - 1), DIFF_TRUNCATED_LINE] : lines
}
