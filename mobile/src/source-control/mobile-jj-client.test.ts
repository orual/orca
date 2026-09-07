import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  commitMobileJj,
  createMobileJjBookmark,
  describeMobileJj,
  fetchMobileJjRemote,
  jjSelector,
  listMobileJjChanges,
  listMobileJjLocalBookmarks,
  listMobileJjRemotes,
  moveMobileJjBookmark,
  pushMobileJjBookmark,
  readJjWorktreeKind,
  readMobileJjFileDiff,
  updateMobileJjWorkspaceStale
} from './mobile-jj-client'

function clientWith(sendRequest: RpcClient['sendRequest']): Pick<RpcClient, 'sendRequest'> {
  return { sendRequest }
}

describe('mobile jj client', () => {
  it('uses an id selector for reads and preserves parent context', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        ok: true,
        path: 'a.ts',
        diff: { kind: 'text', originalContent: '', modifiedContent: '' }
      }
    })
    await readMobileJjFileDiff(clientWith(sendRequest), 'host-wt', {
      path: 'a.ts',
      parentRevision: 'p1'
    })
    expect(sendRequest).toHaveBeenCalledWith(
      'jj.readFileDiff',
      { worktree: 'id:host-wt', path: 'a.ts', parentRevision: 'p1' },
      expect.any(Object)
    )
  })

  it('returns an uncertain commit result after a thrown transport failure and does not retry', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('socket closed'))
    await expect(
      commitMobileJj(clientWith(sendRequest), 'wt', {
        expectedCommitId: 'c1',
        message: 'msg',
        intent: { kind: 'all' }
      })
    ).resolves.toMatchObject({ ok: false, kind: 'uncertain', uncertain: true })
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps explicit method-not-found as unavailable rather than uncertain', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'method_not_found', message: 'missing' } })
    await expect(listMobileJjChanges(clientWith(sendRequest), 'wt')).rejects.toMatchObject({
      code: 'method_not_found'
    })
  })

  it('wraps every expanded read and mutation with the exact wire method and selector', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { ok: true } })
    const client = clientWith(sendRequest)
    await listMobileJjLocalBookmarks(client, 'wt')
    await listMobileJjRemotes(client, 'wt')
    await describeMobileJj(client, 'wt', { expectedCommitId: 'c1', message: 'description' })
    await createMobileJjBookmark(client, 'wt', { expectedCommitId: 'c1', name: 'feature/new' })
    await moveMobileJjBookmark(client, 'wt', { expectedCommitId: 'c1', name: 'feature/existing' })
    await fetchMobileJjRemote(client, 'wt', { remote: 'origin' })
    await pushMobileJjBookmark(client, 'wt', { remote: 'origin', bookmark: 'feature/existing' })
    await updateMobileJjWorkspaceStale(client, 'wt')
    expect(sendRequest.mock.calls.map(([method, params]) => [method, params])).toEqual([
      ['jj.listLocalBookmarks', { worktree: 'id:wt' }],
      ['jj.listRemotes', { worktree: 'id:wt' }],
      ['jj.describe', { worktree: 'id:wt', expectedCommitId: 'c1', message: 'description' }],
      ['jj.createBookmark', { worktree: 'id:wt', expectedCommitId: 'c1', name: 'feature/new' }],
      ['jj.moveBookmark', { worktree: 'id:wt', expectedCommitId: 'c1', name: 'feature/existing' }],
      ['jj.fetchRemote', { worktree: 'id:wt', remote: 'origin' }],
      ['jj.pushBookmark', { worktree: 'id:wt', remote: 'origin', bookmark: 'feature/existing' }],
      ['jj.updateWorkspaceStale', { worktree: 'id:wt' }]
    ])
  })

  it('preserves successful list payloads and surfaces RPC failures as typed errors', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        result: { ok: true, bookmarks: [{ name: 'main', commitId: 'c1' }] }
      })
      .mockResolvedValueOnce({
        ok: true,
        result: { ok: true, remotes: [{ name: 'origin', url: 'https://example.test/repo' }] }
      })
      .mockResolvedValueOnce({ ok: false, error: { code: 'method_not_found', message: 'missing' } })
    const client = clientWith(sendRequest)
    await expect(listMobileJjLocalBookmarks(client, 'wt')).resolves.toEqual({
      ok: true,
      bookmarks: [{ name: 'main', commitId: 'c1' }]
    })
    await expect(listMobileJjRemotes(client, 'wt')).resolves.toEqual({
      ok: true,
      remotes: [{ name: 'origin', url: 'https://example.test/repo' }]
    })
    await expect(
      describeMobileJj(client, 'wt', { expectedCommitId: 'c1', message: 'x' })
    ).rejects.toMatchObject({
      code: 'method_not_found'
    })
  })

  it('does not retry thrown failures for expanded mutations', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('transport closed'))
    const client = clientWith(sendRequest)
    await expect(
      createMobileJjBookmark(client, 'wt', { expectedCommitId: 'c1', name: 'feature/new' })
    ).resolves.toMatchObject({ ok: false, kind: 'uncertain', uncertain: true })
    await expect(fetchMobileJjRemote(client, 'wt', { remote: 'origin' })).resolves.toMatchObject({
      ok: false,
      kind: 'uncertain',
      uncertain: true
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('recognizes jj worktree projections without treating folders as jj', () => {
    expect(jjSelector('wt')).toBe('id:wt')
    expect(readJjWorktreeKind({ worktree: { workspaceKind: 'jj' } })).toBe('jj')
    expect(readJjWorktreeKind({ worktree: { workspaceKind: 'folder-workspace' } })).toBe('git')
  })
})
