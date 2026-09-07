import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WebSocket } from 'ws'
import {
  handleMockJjRequest,
  isMockJjEnabled,
  mockJjWorktreeId,
  resetMockJjState
} from '../scripts/mock-server-jj-state'
import type { RpcResponse } from '../scripts/mock-server-rpc-handlers'

type Request = { id: string; method: string; params?: Record<string, unknown> }

function callMockJj(method: string, params?: Record<string, unknown>): RpcResponse {
  let response: RpcResponse | undefined
  const request: Request = { id: `jj-${method}`, method, ...(params ? { params } : {}) }
  const owned = handleMockJjRequest(
    request,
    (next) => {
      response = next as RpcResponse
    },
    (id, result) => ({ id, ok: true, result, _meta: { runtimeId: 'mock-runtime' } }),
    {} as WebSocket
  )
  expect(owned).toBe(true)
  expect(response).toBeDefined()
  return response!
}

describe('mock server jj fixture', () => {
  const previousMockJj = process.env.MOCK_JJ

  beforeEach(() => {
    process.env.MOCK_JJ = '1'
    delete process.env.MOCK_JJ_FAILURE
    delete process.env.MOCK_JJ_DESCRIBE_FAILURE
    delete process.env.MOCK_JJ_CREATEBOOKMARK_FAILURE
    delete process.env.MOCK_JJ_MOVEBOOKMARK_FAILURE
    delete process.env.MOCK_JJ_FETCHREMOTE_FAILURE
    delete process.env.MOCK_JJ_PUSHBOOKMARK_FAILURE
    delete process.env.MOCK_JJ_COMMIT_FAILURE
    resetMockJjState()
  })

  afterEach(() => {
    if (previousMockJj === undefined) {
      delete process.env.MOCK_JJ
    } else {
      process.env.MOCK_JJ = previousMockJj
    }
  })

  it('serves a jj worktree and contract-complete source-control reads', () => {
    expect(isMockJjEnabled()).toBe(true)
    expect(
      callMockJj('worktree.show', { worktree: `id:${mockJjWorktreeId}` }).result
    ).toMatchObject({
      worktree: {
        workspaceKind: 'jj',
        branch: '',
        jjWorkspace: { name: 'mobile-review', rootResolved: true }
      }
    })
    expect(
      callMockJj('jj.listChanges', { worktree: `id:${mockJjWorktreeId}` }).result
    ).toMatchObject({
      ok: true,
      comparison: 'current-change-vs-parents',
      changes: expect.arrayContaining([
        expect.objectContaining({ path: 'src/main.ts', status: 'modified' })
      ])
    })
    expect(callMockJj('jj.getCurrentChangeMetadata').result).toMatchObject({
      ok: true,
      metadata: {
        description: 'Review mobile jj parity',
        workspaceName: 'mobile-review',
        conflicted: false
      }
    })
    expect(
      callMockJj('jj.readFileDiff', { path: 'src/main.ts', parentRevision: 'parent-b' }).result
    ).toMatchObject({
      ok: true,
      path: 'src/main.ts',
      comparison: 'current-change-vs-parents',
      parentDiffs: expect.arrayContaining([expect.objectContaining({ parentRevision: 'parent-b' })])
    })
  })

  it('supports selected commits while retaining unselected edits', () => {
    const before = callMockJj('jj.getCurrentChangeMetadata').result as {
      metadata: { commitId: string }
    }
    expect(
      callMockJj('jj.commit', {
        expectedCommitId: before.metadata.commitId,
        message: 'Partial commit',
        intent: { kind: 'selected', paths: ['src/main.ts'] }
      }).result
    ).toEqual({ ok: true })
    expect(callMockJj('jj.listChanges').result).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({ path: 'README.md' }),
        expect.objectContaining({ path: 'docs/plan.md' })
      ])
    })
    expect(callMockJj('jj.listChanges').result).not.toMatchObject({
      changes: expect.arrayContaining([expect.objectContaining({ path: 'src/main.ts' })])
    })
  })

  it('mutates descriptions, local bookmarks, and safely exercises fake remotes', () => {
    const metadata = callMockJj('jj.getCurrentChangeMetadata').result as {
      metadata: { commitId: string }
    }
    expect(
      callMockJj('jj.describe', {
        expectedCommitId: metadata.metadata.commitId,
        message: 'Updated'
      }).result
    ).toEqual({ ok: true })
    expect(
      callMockJj('jj.createBookmark', {
        expectedCommitId: metadata.metadata.commitId,
        name: 'feature/mobile'
      }).result
    ).toEqual({ ok: true })
    expect(callMockJj('jj.listLocalBookmarks').result).toMatchObject({
      bookmarks: expect.arrayContaining([
        { name: 'feature/mobile', commitId: metadata.metadata.commitId }
      ])
    })
    expect(callMockJj('jj.listRemotes').result).toMatchObject({ remotes: [{ name: 'origin' }] })
    expect(callMockJj('jj.fetchRemote', { remote: 'origin' }).result).toEqual({ ok: true })
    expect(
      callMockJj('jj.pushBookmark', { remote: 'origin', bookmark: 'feature/mobile' }).result
    ).toEqual({ ok: true })
  })

  it('exposes unsupported and uncertain failure fixtures without mutating state', () => {
    process.env.MOCK_JJ_DESCRIBE_FAILURE = 'unsupported'
    expect(
      callMockJj('jj.describe', { expectedCommitId: 'mock-jj-commit-001', message: 'nope' }).result
    ).toMatchObject({ ok: false, kind: 'unsupported' })
    process.env.MOCK_JJ_FETCHREMOTE_FAILURE = 'uncertain'
    expect(callMockJj('jj.fetchRemote', { remote: 'origin' }).result).toMatchObject({
      ok: false,
      kind: 'uncertain',
      uncertain: true
    })
  })

  it('requires explicit jj removal and models forget/delete/cleanup-only', () => {
    expect(callMockJj('worktree.rm', { worktree: `id:${mockJjWorktreeId}` }).result).toMatchObject({
      removed: false,
      ok: false
    })
    expect(
      callMockJj('worktree.rm', { worktree: `id:${mockJjWorktreeId}`, jjRemoval: 'forget' }).result
    ).toEqual({ removed: true, ok: true })
    expect(callMockJj('jj.listWorkspaces').result).toMatchObject({ workspaces: [] })
    resetMockJjState()
    expect(callMockJj('worktree.rm', { jjRemoval: 'forget-and-delete' }).result).toMatchObject({
      removed: true,
      ok: true
    })
    resetMockJjState()
    expect(callMockJj('worktree.rm', { jjRemoval: 'cleanup-only' }).result).toMatchObject({
      removed: true,
      ok: true
    })
  })

  it('commits with the expected revision and clears the fixture changes', () => {
    const before = callMockJj('jj.getCurrentChangeMetadata').result as {
      metadata: { commitId: string }
    }
    expect(
      callMockJj('jj.commit', {
        expectedCommitId: before.metadata.commitId,
        message: 'Validated on Android',
        intent: { kind: 'all' }
      }).result
    ).toEqual({ ok: true })
    expect(callMockJj('jj.listChanges').result).toMatchObject({ ok: true, changes: [] })
    expect(callMockJj('jj.getCurrentChangeMetadata').result).toMatchObject({
      ok: true,
      metadata: { description: 'Validated on Android' }
    })
    expect(callMockJj('jj.updateWorkspaceStale').result).toEqual({ ok: true })
  })
})
