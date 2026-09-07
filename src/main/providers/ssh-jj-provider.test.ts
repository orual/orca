import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonRpcErrorCode } from '../ssh/relay-protocol'
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import {
  getSshJjProvider,
  getSshJjProviderGeneration,
  registerSshJjProvider,
  unregisterSshJjProvider
} from './ssh-jj-dispatch'
import { SshJjProvider, SSH_JJ_UNSUPPORTED_MESSAGE } from './ssh-jj-provider'

describe('SSH jj provider contract', () => {
  const connectionId = 'ssh-jj-test'

  afterEach(() => {
    unregisterSshJjProvider(connectionId)
  })

  it('registers the mux-bound provider and preserves typed request fields', async () => {
    const mux = {
      request: vi.fn(async () => ({ ok: true, workspaces: [] }))
    } as unknown as SshChannelMultiplexer
    const provider = new SshJjProvider(mux)
    const before = getSshJjProviderGeneration(connectionId)
    registerSshJjProvider(connectionId, provider)

    expect(getSshJjProvider(connectionId)).toBe(provider)
    await provider.readFileDiff(
      '/remote/repo',
      { path: 'src/file.ts', revision: '@' },
      { timeoutMs: 4000 }
    )
    await provider.updateWorkspaceStale('/remote/repo', { timeoutMs: 4000 })
    expect(mux.request).toHaveBeenCalledWith(
      'jj.readFileDiff',
      { repoPath: '/remote/repo', path: 'src/file.ts', revision: '@' },
      { timeoutMs: 4000 }
    )
    expect(getSshJjProviderGeneration(connectionId)).toBe(before + 1)
  })

  it('maps only method-not-found to explicit unsupported, preserving other failures', async () => {
    const missing = Object.assign(new Error('missing'), { code: JsonRpcErrorCode.MethodNotFound })
    const mux = {
      request: vi.fn().mockRejectedValueOnce(missing).mockRejectedValueOnce(new Error('lost'))
    } as unknown as SshChannelMultiplexer
    const provider = new SshJjProvider(mux)

    await expect(provider.detect('/remote/repo')).rejects.toThrow(SSH_JJ_UNSUPPORTED_MESSAGE)
    await expect(provider.listChanges('/remote/repo')).rejects.toThrow('lost')
  })
})
