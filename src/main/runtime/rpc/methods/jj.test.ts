import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { ALL_RPC_METHODS } from './index'

function runtime(): OrcaRuntimeService {
  return {
    getRuntimeId: vi.fn().mockReturnValue('test-runtime'),
    detectRuntimeJj: vi.fn().mockResolvedValue({ ok: true, version: '0.44.0' }),
    updateRuntimeJjWorkspaceStale: vi.fn().mockResolvedValue({ ok: true }),
    listRuntimeJjWorkspaces: vi.fn().mockResolvedValue({ ok: true, workspaces: [] }),
    addRuntimeJjWorkspace: vi.fn().mockResolvedValue({ ok: true, destination: '/tmp/new' }),
    removeRuntimeJjWorkspace: vi.fn().mockResolvedValue({ ok: true }),
    listRuntimeJjChanges: vi
      .fn()
      .mockResolvedValue({ ok: true, comparison: 'current-change-vs-parents', changes: [] }),
    readRuntimeJjFileDiff: vi.fn().mockResolvedValue({
      ok: true,
      path: 'src/a.ts',
      change: null,
      comparison: 'current-change-vs-parents',
      diff: {}
    }),
    getRuntimeJjCurrentChangeMetadata: vi.fn().mockResolvedValue({
      ok: true,
      metadata: {
        commitId: 'commit-id',
        changeId: 'change-id',
        description: '',
        bookmarks: [],
        conflicted: false,
        workspaceName: 'default'
      }
    }),
    listRuntimeJjLocalBookmarks: vi.fn().mockResolvedValue({ ok: true, bookmarks: [] }),
    describeRuntimeJjCurrentChange: vi.fn().mockResolvedValue({ ok: true }),
    createRuntimeJjBookmark: vi.fn().mockResolvedValue({ ok: true }),
    moveRuntimeJjBookmark: vi.fn().mockResolvedValue({ ok: true }),
    commitRuntimeJj: vi.fn().mockResolvedValue({ ok: true })
  } as unknown as OrcaRuntimeService
}

describe('jj runtime RPC methods', () => {
  it('registers all jj methods', () => {
    const names = new Set(ALL_RPC_METHODS.map((method) => method.name))
    expect([...names].filter((name) => name.startsWith('jj.'))).toEqual([
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
  })

  it('forwards validated operation inputs and signal context', async () => {
    const host = runtime()
    const signal = new AbortController().signal
    const dispatcher = new RpcDispatcher({ runtime: host, methods: ALL_RPC_METHODS })
    const context = { signal }
    await dispatcher.dispatch(
      {
        id: '1',
        authToken: 'test',
        method: 'jj.addWorkspace',
        params: { worktree: 'id:wt', destination: '/tmp/new', name: 'new', revision: '@' }
      },
      context
    )
    expect(host.addRuntimeJjWorkspace).toHaveBeenCalledWith(
      'id:wt',
      { destination: '/tmp/new', name: 'new', revision: '@' },
      { signal }
    )
  })

  it('rejects unsafe file paths before dispatch', async () => {
    const host = runtime()
    const dispatcher = new RpcDispatcher({ runtime: host, methods: ALL_RPC_METHODS })
    const response = await dispatcher.dispatch(
      {
        id: '2',
        authToken: 'test',
        method: 'jj.readFileDiff',
        params: { worktree: 'id:wt', path: '../secret' }
      },
      {}
    )
    expect(response.ok).toBe(false)
    expect(host.readRuntimeJjFileDiff).not.toHaveBeenCalled()
  })

  it('rejects actual NUL bytes in describe and bookmark RPC params', async () => {
    const dispatcher = new RpcDispatcher({ runtime: runtime(), methods: ALL_RPC_METHODS })
    const describeResponse = await dispatcher.dispatch(
      {
        id: 'nul-describe',
        authToken: 'test',
        method: 'jj.describe',
        params: { worktree: 'id:wt', expectedCommitId: 'commit-id', message: `bad\0message` }
      },
      {}
    )
    const bookmarkResponse = await dispatcher.dispatch(
      {
        id: 'nul-bookmark',
        authToken: 'test',
        method: 'jj.createBookmark',
        params: { worktree: 'id:wt', expectedCommitId: 'commit-id', name: `bad\0name` }
      },
      {}
    )
    expect(describeResponse.ok).toBe(false)
    expect(bookmarkResponse.ok).toBe(false)
    if (!describeResponse.ok && !bookmarkResponse.ok) {
      expect(describeResponse.error.message).toContain('Message contains NUL')
      expect(bookmarkResponse.error.message).toContain('Value contains NUL')
    }
  })

  it('keeps unknown methods explicitly unsupported', async () => {
    const dispatcher = new RpcDispatcher({ runtime: runtime(), methods: ALL_RPC_METHODS })
    const response = await dispatcher.dispatch(
      { id: '3', authToken: 'test', method: 'jj.future', params: {} },
      {}
    )
    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error.code).toBe('method_not_found')
    }
  })
})
