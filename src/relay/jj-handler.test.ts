import { describe, expect, it, vi } from 'vitest'
import type {
  JjBackend,
  JjBookmarkMutationResult,
  JjChangesResult,
  JjDetection,
  JjCommitResult,
  JjCurrentChangeMetadataResult,
  JjDescribeResult,
  JjFileDiffResult,
  JjLocalBookmarksResult,
  JjWorkspaceAddResult,
  JjWorkspaceListResult,
  JjWorkspaceStaleRecoveryResult
} from '../shared/jj-types'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import { JjHandler } from './jj-handler'

type RegisteredHandler = (
  params: Record<string, unknown>,
  context: RequestContext
) => Promise<unknown>

function createDispatcher(): {
  dispatcher: RelayDispatcher
  handlers: Map<string, RegisteredHandler>
} {
  const handlers = new Map<string, RegisteredHandler>()
  return {
    dispatcher: {
      onRequest: (method: string, handler: RegisteredHandler) => handlers.set(method, handler)
    } as unknown as RelayDispatcher,
    handlers
  }
}

function context(signal?: AbortSignal): RequestContext {
  return { clientId: 1, isStale: () => signal?.aborted ?? false, signal }
}

function backend(): JjBackend {
  return {
    detect: vi.fn(async (): Promise<JjDetection> => ({
      ok: true,
      version: '0.44.0',
      major: 0,
      minor: 44,
      patch: 0,
      root: '/repo',
      colocated: false
    })),
    listWorkspaces: vi.fn(async (): Promise<JjWorkspaceListResult> => ({
      ok: true,
      workspaces: []
    })),
    addWorkspace: vi.fn(async (input): Promise<JjWorkspaceAddResult> => ({
      ok: true,
      destination: input.destination
    })),
    removeWorkspace: vi.fn(async () => ({ ok: true as const })),
    listChanges: vi.fn(async (): Promise<JjChangesResult> => ({
      ok: true,
      comparison: 'current-change-vs-parents',
      changes: []
    })),
    readFileDiff: vi.fn(async (input): Promise<JjFileDiffResult> => ({
      ok: false,
      kind: 'stale',
      message: `missing ${input.path}`
    })),
    getCurrentChangeMetadata: vi.fn(async (): Promise<JjCurrentChangeMetadataResult> => ({
      ok: true,
      metadata: {
        commitId: 'commit-id',
        changeId: 'change-id',
        description: '',
        bookmarks: [],
        conflicted: false,
        workspaceName: 'default'
      }
    })),
    listLocalBookmarks: vi.fn(async (): Promise<JjLocalBookmarksResult> => ({
      ok: true,
      bookmarks: []
    })),
    listRemotes: vi.fn(async () => ({ ok: true as const, remotes: [] })),
    fetchRemote: vi.fn(async () => ({ ok: true as const })),
    pushBookmark: vi.fn(async () => ({ ok: true as const })),
    describe: vi.fn(async (): Promise<JjDescribeResult> => ({ ok: true })),
    createBookmark: vi.fn(async (): Promise<JjBookmarkMutationResult> => ({ ok: true })),
    moveBookmark: vi.fn(async (): Promise<JjBookmarkMutationResult> => ({ ok: true })),
    commit: vi.fn(async (): Promise<JjCommitResult> => ({ ok: true })),
    updateWorkspaceStale: vi.fn(async (): Promise<JjWorkspaceStaleRecoveryResult> => ({ ok: true }))
  }
}

describe('relay jj domain-operation registration', () => {
  it('registers typed methods and forwards validated direct fields and cancellation', async () => {
    const { dispatcher, handlers } = createDispatcher()
    const signal = new AbortController().signal
    const value = backend()
    new JjHandler(dispatcher, () => value)

    expect([...handlers.keys()]).toEqual([
      'jj.detect',
      'jj.listWorkspaces',
      'jj.addWorkspace',
      'jj.removeWorkspace',
      'jj.listChanges',
      'jj.readFileDiff',
      'jj.getCurrentChangeMetadata',
      'jj.listLocalBookmarks',
      'jj.listRemotes',
      'jj.fetchRemote',
      'jj.pushBookmark',
      'jj.describe',
      'jj.createBookmark',
      'jj.moveBookmark',
      'jj.commit',
      'jj.updateWorkspaceStale'
    ])
    await handlers.get('jj.addWorkspace')?.(
      { repoPath: '/repo', destination: '/repo-feature', name: 'feature', revision: 'main@' },
      context(signal)
    )
    expect(value.addWorkspace).toHaveBeenCalledWith({
      destination: '/repo-feature',
      name: 'feature',
      revision: 'main@'
    })
  })

  it('rejects traversal and non-absolute repository paths before the backend', async () => {
    const { dispatcher } = createDispatcher()
    const value = backend()
    new JjHandler(dispatcher, () => value)
    const { handlers } = createDispatcher()
    new JjHandler(
      {
        onRequest: (method: string, callback: RegisteredHandler) => handlers.set(method, callback)
      } as unknown as RelayDispatcher,
      () => value
    )

    await expect(
      handlers.get('jj.detect')?.({ repoPath: 'relative/repo' }, context())
    ).rejects.toThrow('Invalid jj repository path')
    await expect(
      handlers.get('jj.readFileDiff')?.({ repoPath: '/repo', path: '../secret' }, context())
    ).rejects.toThrow('Invalid jj file diff path')
    expect(value.detect).not.toHaveBeenCalled()
  })

  it('rejects actual NUL bytes in describe and bookmark inputs before the backend', async () => {
    const { dispatcher, handlers } = createDispatcher()
    const value = backend()
    new JjHandler(dispatcher, () => value)

    await expect(
      handlers.get('jj.describe')?.(
        { repoPath: '/repo', expectedCommitId: 'commit-id', message: `bad\0message` },
        context()
      )
    ).rejects.toThrow('Invalid jj describe metadata or message')
    await expect(
      handlers.get('jj.createBookmark')?.(
        { repoPath: '/repo', expectedCommitId: 'commit-id', name: `bad\0name` },
        context()
      )
    ).rejects.toThrow('Invalid jj bookmark metadata or name')
    expect(value.describe).not.toHaveBeenCalled()
    expect(value.createBookmark).not.toHaveBeenCalled()
  })

  it('accepts a nested typed input object for additive compatibility', async () => {
    const { dispatcher, handlers } = createDispatcher()
    const value = backend()
    new JjHandler(dispatcher, () => value)
    await handlers.get('jj.readFileDiff')?.(
      { repoPath: '/repo', input: { path: 'src/file.ts', revision: '@' } },
      context()
    )
    expect(value.readFileDiff).toHaveBeenCalledWith({ path: 'src/file.ts', revision: '@' })
  })
})
