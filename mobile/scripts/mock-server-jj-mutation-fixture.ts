import type {
  JjBookmarkMutationInput,
  JjChange,
  JjCommitInput,
  JjDescribeInput,
  JjLocalBookmark,
  JjRemote
} from '../../src/shared/jj-types'

type Failure =
  | { ok: false; kind: 'unsupported'; message: string }
  | { ok: false; kind: 'uncertain'; uncertain: true; message: string }

export const initialJjChanges: JjChange[] = [
  { path: 'src/main.ts', status: 'modified', stats: { added: 4, removed: 1 } },
  { path: 'README.md', status: 'added', stats: { added: 8, removed: 0 } },
  { path: 'docs/plan.md', status: 'modified', stats: { added: 2, removed: 2 } }
]

export const jjFixture = {
  commitId: 'mock-jj-commit-001',
  description: 'Review mobile jj parity',
  localBookmarks: [
    { name: 'mobile-review', commitId: 'mock-jj-commit-001' },
    { name: 'main', commitId: 'mock-jj-main-000' }
  ] as JjLocalBookmark[],
  remotes: [{ name: 'origin', url: 'https://example.invalid/orca-mobile.git' }] as JjRemote[],
  changes: [...initialJjChanges],
  workspacePresent: true
}

export function resetMockJjState(): void {
  jjFixture.commitId = 'mock-jj-commit-001'
  jjFixture.description = 'Review mobile jj parity'
  jjFixture.localBookmarks = [
    { name: 'mobile-review', commitId: jjFixture.commitId },
    { name: 'main', commitId: 'mock-jj-main-000' }
  ]
  jjFixture.remotes = [{ name: 'origin', url: 'https://example.invalid/orca-mobile.git' }]
  jjFixture.changes = [...initialJjChanges]
  jjFixture.workspacePresent = true
}

export function configuredJjFailure(operation: string): Failure | null {
  const mode =
    process.env[`MOCK_JJ_${operation.toUpperCase()}_FAILURE`] ?? process.env.MOCK_JJ_FAILURE
  if (mode === 'unsupported') {
    return {
      ok: false,
      kind: 'unsupported',
      message: `${operation} is unsupported in this fixture`
    }
  }
  if (mode === 'uncertain') {
    return {
      ok: false,
      kind: 'uncertain',
      uncertain: true,
      message: `${operation} outcome is uncertain in this fixture`
    }
  }
  return null
}

export function expectedJjCommitFailure(expectedCommitId: unknown) {
  return expectedCommitId !== jjFixture.commitId
    ? {
        ok: false as const,
        kind: 'error' as const,
        message: `Expected ${jjFixture.commitId}; received ${String(expectedCommitId ?? '')}`
      }
    : null
}

export function describeJj(input: Partial<JjDescribeInput>) {
  const failure = configuredJjFailure('describe') ?? expectedJjCommitFailure(input.expectedCommitId)
  if (failure) {
    return failure
  }
  jjFixture.description = typeof input.message === 'string' ? input.message : jjFixture.description
  return { ok: true as const }
}

export function mutateJjBookmark(
  operation: 'createBookmark' | 'moveBookmark',
  input: Partial<JjBookmarkMutationInput>
) {
  const failure = configuredJjFailure(operation) ?? expectedJjCommitFailure(input.expectedCommitId)
  if (failure) {
    return failure
  }
  if (typeof input.name !== 'string' || input.name.length === 0) {
    return { ok: false as const, kind: 'error' as const, message: 'bookmark name is required' }
  }
  jjFixture.localBookmarks = jjFixture.localBookmarks.filter(
    (bookmark) => bookmark.name !== input.name
  )
  jjFixture.localBookmarks.push({ name: input.name, commitId: jjFixture.commitId })
  return { ok: true as const }
}

export function commitJj(input: Partial<JjCommitInput>) {
  const failure = configuredJjFailure('commit') ?? expectedJjCommitFailure(input.expectedCommitId)
  if (failure) {
    return failure
  }
  jjFixture.description = typeof input.message === 'string' ? input.message : jjFixture.description
  if (input.intent?.kind === 'selected' && Array.isArray(input.intent.paths)) {
    const selected = new Set(input.intent.paths)
    jjFixture.changes = jjFixture.changes.filter((change) => !selected.has(change.path))
  } else {
    jjFixture.changes = []
  }
  const previousCommitId = jjFixture.commitId
  jjFixture.commitId = `${jjFixture.commitId}-next`
  jjFixture.localBookmarks = jjFixture.localBookmarks.map((bookmark) =>
    bookmark.commitId === previousCommitId
      ? { ...bookmark, commitId: jjFixture.commitId }
      : bookmark
  )
  return { ok: true as const }
}

export function fakeJjRemoteOperation(operation: 'fetchRemote' | 'pushBookmark') {
  return configuredJjFailure(operation) ?? { ok: true as const }
}
