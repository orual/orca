import { describe, expect, it, vi } from 'vitest'
import type { ExecutionHostId } from '../../../src/shared/execution-host'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  mergePendingJjWorktrees,
  requestJjWorktreeRemoval,
  resolveJjRemovalHostId
} from './jj-worktree-removal'
import type { Worktree } from '../worktree/workspace-list-sections'

const HOST_ID: ExecutionHostId = 'ssh:builder'
const WORKTREE_ID = 'repo-1::/workspaces/feature'
const PROOF = {
  hostId: HOST_ID,
  worktreeId: WORKTREE_ID,
  workspaceName: 'feature',
  targetRoot: '/workspaces/feature',
  ownerRoot: '/repo'
}

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    worktreeId: WORKTREE_ID,
    repoId: 'repo-1',
    hostId: HOST_ID,
    workspaceKind: 'jj',
    displayName: 'feature',
    repo: 'repo',
    path: '/workspaces/feature',
    ...overrides
  } as Worktree
}

function clientWith(response: unknown): RpcClient {
  return { sendRequest: vi.fn().mockResolvedValue(response) } as unknown as RpcClient
}

describe('requestJjWorktreeRemoval', () => {
  it.each(['forget', 'forget-and-delete', 'cleanup-only'] as const)(
    'sends the explicit %s mode with the execution host and no Git force flag',
    async (mode) => {
      const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: {} })
      const client = { sendRequest } as unknown as RpcClient

      await expect(
        requestJjWorktreeRemoval({ client, worktree: worktree(), hostId: HOST_ID, mode })
      ).resolves.toEqual({ kind: 'removed' })
      expect(sendRequest).toHaveBeenCalledWith('worktree.rm', {
        worktree: `id:${WORKTREE_ID}`,
        hostId: HOST_ID,
        jjRemoval: mode
      })
    }
  )

  it('retains only matching host-qualified cleanup proof as pending', async () => {
    const client = clientWith({ ok: true, result: { jjCleanupPending: PROOF } })

    await expect(
      requestJjWorktreeRemoval({
        client,
        worktree: worktree(),
        hostId: HOST_ID,
        mode: 'forget-and-delete'
      })
    ).resolves.toEqual({ kind: 'pending', proof: PROOF })
  })

  it.each([
    ['invalid proof', { jjCleanupPending: { ...PROOF, targetRoot: 4 } }],
    ['wrong host', { jjCleanupPending: { ...PROOF, hostId: 'local' } }],
    ['wrong workspace', { jjCleanupPending: { ...PROOF, worktreeId: 'other' } }]
  ])('rejects %s instead of retaining unsafe proof', async (_label, result) => {
    const client = clientWith({ ok: true, result })

    await expect(
      requestJjWorktreeRemoval({
        client,
        worktree: worktree(),
        hostId: HOST_ID,
        mode: 'forget-and-delete'
      })
    ).resolves.toMatchObject({ kind: 'rejected' })
  })

  it('classifies delivery-unknown transport failure without replaying the mutation', async () => {
    const sendRequest = vi
      .fn()
      .mockRejectedValue(markRpcDeliveryUnknown(new Error('Connection closed')))
    const client = { sendRequest } as unknown as RpcClient

    await expect(
      requestJjWorktreeRemoval({
        client,
        worktree: worktree(),
        hostId: HOST_ID,
        mode: 'forget-and-delete'
      })
    ).resolves.toEqual({ kind: 'uncertain', message: 'Connection closed' })
    expect(sendRequest).toHaveBeenCalledOnce()
  })

  it('classifies an acknowledged host rejection separately from uncertain delivery', async () => {
    const client = clientWith({
      ok: false,
      error: { code: 'cleanup_refused', message: 'Workspace is still registered.' }
    })

    await expect(
      requestJjWorktreeRemoval({
        client,
        worktree: worktree(),
        hostId: HOST_ID,
        mode: 'cleanup-only'
      })
    ).resolves.toEqual({ kind: 'rejected', message: 'Workspace is still registered.' })
  })
})

describe('mobile JJ cleanup identity handling', () => {
  it('resolves a normalized row host before the repository fallback', () => {
    expect(resolveJjRemovalHostId(worktree({ hostId: ' ssh:builder ' }), new Map())).toBe(HOST_ID)
    expect(
      resolveJjRemovalHostId(worktree({ hostId: undefined }), new Map([['repo-1', HOST_ID]]))
    ).toBe(HOST_ID)
    expect(resolveJjRemovalHostId(worktree({ hostId: undefined }), new Map())).toBeNull()
  })

  it('keeps a proof-backed row visible when the authoritative catalog temporarily omits it', () => {
    const retained = mergePendingJjWorktrees(
      [],
      new Map([
        ['ssh:builder|repo-1::/workspaces/feature', { worktree: worktree(), proof: PROOF }]
      ]),
      new Map()
    )

    expect(retained).toHaveLength(1)
    expect(retained[0]).toMatchObject({ worktreeId: WORKTREE_ID, hostId: HOST_ID })
  })
})
