import type { WebSocket } from 'ws'
import type { JjCurrentChangeMetadata, JjFileDiffInput } from '../../src/shared/jj-types'
import type { RuntimeWorktreePsSummary } from '../../src/shared/runtime-worktree-contracts'
import type { RpcResponse } from './mock-server-rpc-handlers'
import type { MockRepo } from './mobile-lag-scenario'
import {
  commitJj,
  describeJj,
  fakeJjRemoteOperation,
  jjFixture,
  mutateJjBookmark,
  resetMockJjState
} from './mock-server-jj-mutation-fixture'
import { handleMockJjWorkspaceRequest } from './mock-server-jj-workspace-fixture'

export { resetMockJjState }

export function isMockJjEnabled(): boolean {
  return process.env.MOCK_JJ === '1'
}

export const MOCK_JJ_REPO: MockRepo & { kind: 'jj'; addedAt: number } = {
  id: 'repo-jj',
  displayName: 'jj-mobile',
  path: '/tmp/orca-mobile-repro/jj-mobile',
  badgeColor: '#22c55e',
  connectionId: null,
  kind: 'jj',
  addedAt: 1_700_000_000_000
}

const JJ_ROOT = `${MOCK_JJ_REPO.path}/workspaces/mobile-review`
const JJ_WORKTREE_ID = `${MOCK_JJ_REPO.id}::${JJ_ROOT}`
const STALE_MESSAGE =
  'The working copy is stale (not updated since operation mock-operation). Hint: Run `jj workspace update-stale` to update it.'

export function createMockJjWorktree(name = 'mobile-review'): RuntimeWorktreePsSummary {
  const root = `${MOCK_JJ_REPO.path}/workspaces/${name}`
  const worktreeId = `${MOCK_JJ_REPO.id}::${root}`
  return {
    workspaceKind: 'jj',
    jjWorkspace: { name, root, rootResolved: true },
    worktreeId,
    repoId: MOCK_JJ_REPO.id,
    repo: MOCK_JJ_REPO.displayName,
    path: root,
    branch: '',
    isArchived: false,
    isMainWorktree: false,
    hasHostSidebarActivity: true,
    parentWorktreeId: null,
    childWorktreeIds: [],
    displayName: name,
    workspaceStatus: 'in-progress',
    sortOrder: Date.now(),
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    comment: 'Mock jj workspace for mobile parity validation',
    isPinned: false,
    isActive: true,
    unread: false,
    liveTerminalCount: 1,
    hasAttachedPty: true,
    lastOutputAt: Date.now(),
    preview: '$ jj status',
    status: 'active',
    agents: []
  }
}

function selectedWorktreeId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return JJ_WORKTREE_ID
  }
  return value.startsWith('id:') ? value.slice(3) : value
}

function worktreeProjection(value: unknown): RuntimeWorktreePsSummary & { id: string } {
  const worktreeId = selectedWorktreeId(value)
  const name = worktreeId.split('/').pop() || 'mobile-review'
  const base = createMockJjWorktree(name)
  return { ...base, id: worktreeId, worktreeId, path: `${MOCK_JJ_REPO.path}/workspaces/${name}` }
}

function metadata(): JjCurrentChangeMetadata {
  return {
    commitId: jjFixture.commitId,
    changeId: 'mock-jj-change-001',
    description: jjFixture.description,
    bookmarks: jjFixture.localBookmarks
      .filter((bookmark) => bookmark.commitId === jjFixture.commitId)
      .map((bookmark) => ({ name: bookmark.name, readOnly: true })),
    conflicted: false,
    workspaceName: 'mobile-review'
  }
}

function textDiff(path: string, parentRevision: string | undefined) {
  const parent = parentRevision ?? 'parent-a'
  const originalContent = `// ${path} at ${parent}\nexport const before = true\n`
  const modifiedContent = `// ${path} in ${jjFixture.commitId}\nexport const after = true\n`
  return {
    kind: 'text' as const,
    originalContent,
    modifiedContent,
    originalIsBinary: false as const,
    modifiedIsBinary: false as const
  }
}

function diffFor(input: JjFileDiffInput) {
  const change = jjFixture.changes.find((entry) => entry.path === input.path) ?? null
  const parentDiffs = ['parent-a', 'parent-b'].map((parentRevision) => ({
    parentRevision,
    diff: textDiff(input.path, parentRevision)
  }))
  return {
    ok: true as const,
    path: input.path,
    change,
    diff: textDiff(input.path, input.parentRevision),
    comparison: 'current-change-vs-parents' as const,
    parentDiffs
  }
}

type MockJjRequest = {
  id: string
  method: string
  params?: Record<string, unknown>
}
type Respond = (response: RpcResponse) => void
type Success = (id: string, result: unknown) => RpcResponse

export function handleMockJjRequest(
  request: MockJjRequest,
  respond: Respond,
  success: Success,
  _ws?: WebSocket
): boolean {
  if (!isMockJjEnabled()) {
    return false
  }

  if (request.method === 'worktree.show') {
    respond(success(request.id, { worktree: worktreeProjection(request.params?.worktree) }))
    return true
  }
  if (handleMockJjWorkspaceRequest(request, respond, success)) {
    return true
  }

  switch (request.method) {
    case 'jj.listLocalBookmarks':
      respond(
        success(request.id, {
          ok: true,
          bookmarks: jjFixture.localBookmarks.map((bookmark) => ({ ...bookmark }))
        })
      )
      return true

    case 'jj.listRemotes':
      respond(
        success(request.id, {
          ok: true,
          remotes: jjFixture.remotes.map((remote) => ({ ...remote }))
        })
      )
      return true

    case 'jj.describe': {
      const params = (request.params ?? {}) as Record<string, unknown>
      const result = describeJj(params)
      respond(success(request.id, result))
      return true
    }

    case 'jj.createBookmark':
    case 'jj.moveBookmark': {
      const params = (request.params ?? {}) as Record<string, unknown>
      const operation = request.method === 'jj.createBookmark' ? 'createBookmark' : 'moveBookmark'
      respond(success(request.id, mutateJjBookmark(operation, params)))
      return true
    }

    case 'jj.fetchRemote':
    case 'jj.pushBookmark': {
      const operation = request.method === 'jj.fetchRemote' ? 'fetchRemote' : 'pushBookmark'
      respond(success(request.id, fakeJjRemoteOperation(operation)))
      return true
    }

    case 'jj.listChanges':
      respond(
        success(request.id, {
          ok: true,
          comparison: 'current-change-vs-parents',
          changes: jjFixture.changes
        })
      )
      return true

    case 'jj.getCurrentChangeMetadata':
      respond(success(request.id, { ok: true, metadata: metadata() }))
      return true

    case 'jj.readFileDiff': {
      const params = request.params ?? {}
      respond(
        success(
          request.id,
          diffFor({
            path: String(params.path ?? 'src/main.ts'),
            ...(typeof params.revision === 'string' ? { revision: params.revision } : {}),
            ...(typeof params.parentRevision === 'string'
              ? { parentRevision: params.parentRevision }
              : {})
          })
        )
      )
      return true
    }

    case 'jj.commit': {
      const params = (request.params ?? {}) as import('../../src/shared/jj-types').JjCommitInput
      respond(success(request.id, commitJj(params)))
      return true
    }

    case 'jj.updateWorkspaceStale':
      respond(success(request.id, { ok: true }))
      return true

    case 'jj.mockStale':
      respond(
        success(request.id, {
          ok: false,
          kind: 'stale',
          message: STALE_MESSAGE
        })
      )
      return true

    default:
      return false
  }
}

export const mockJjWorktreeId = JJ_WORKTREE_ID
