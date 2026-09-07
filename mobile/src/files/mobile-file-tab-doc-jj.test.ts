import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { resolveMobileFileTabDoc } from './mobile-file-tab-doc'

describe('mobile jj file tabs', () => {
  it('reuses the diff document shape and sends parent revision', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        ok: true,
        path: 'src/a.ts',
        comparison: 'current-change-vs-parents',
        change: null,
        diff: { kind: 'text', originalContent: 'old\n', modifiedContent: 'new\n' },
        parentDiffs: [
          {
            parentRevision: 'p1',
            diff: { kind: 'text', originalContent: 'old\n', modifiedContent: 'new\n' }
          }
        ]
      }
    })
    const doc = await resolveMobileFileTabDoc(
      { sendRequest } as unknown as Pick<RpcClient, 'sendRequest'>,
      {
        worktreeId: 'wt',
        relativePath: 'src/a.ts',
        diffSource: 'jj',
        jjParentRevision: 'p1'
      }
    )
    expect(doc.kind).toBe('diff')
    expect(sendRequest).toHaveBeenCalledWith(
      'jj.readFileDiff',
      { worktree: 'id:wt', path: 'src/a.ts', parentRevision: 'p1' },
      expect.any(Object)
    )
  })
})
