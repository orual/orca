import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshFilesystemProvider } from './ssh-filesystem-provider'
import { JsonRpcErrorCode } from '../ssh/relay-protocol'

type MockMultiplexer = {
  request: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  onNotification: ReturnType<typeof vi.fn>
  onNotificationByMethod: ReturnType<typeof vi.fn>
  onDispose: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  isDisposed: ReturnType<typeof vi.fn>
  _methodHandlers: Map<string, Set<(params: Record<string, unknown>) => void>>
  _emitMethod: (method: string, params: Record<string, unknown>) => void
}

function createMockMux(): MockMultiplexer {
  const methodHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>()
  return {
    request: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    onNotification: vi.fn(),
    onNotificationByMethod: vi.fn(),
    onDispose: vi.fn(() => () => {}),
    dispose: vi.fn(),
    isDisposed: vi.fn().mockReturnValue(false),
    _methodHandlers: methodHandlers,
    _emitMethod: (method, params) => {
      for (const handler of methodHandlers.get(method) ?? []) {
        handler(params)
      }
    }
  }
}

describe('SshFilesystemProvider watch', () => {
  let mux: MockMultiplexer
  let provider: SshFilesystemProvider
  beforeEach(() => {
    mux = createMockMux()
    provider = new SshFilesystemProvider('conn-1', mux as never)
  })
  describe('watch', () => {
    it('shares an in-flight same-root watch setup across concurrent subscribers', async () => {
      let resolveWatch: () => void = () => {}
      mux.request.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveWatch = resolve
          })
      )
      const first = vi.fn()
      const second = vi.fn()

      const firstWatch = provider.watch('/home/user/project', first)
      const secondWatch = provider.watch('/home/user/project', second)

      expect(mux.request).toHaveBeenCalledTimes(1)
      resolveWatch()
      const [unsubFirst, unsubSecond] = await Promise.all([firstWatch, secondWatch])

      const notifHandler = mux.onNotification.mock.calls[0][0]
      const events = [{ kind: 'update', absolutePath: '/home/user/project/file.ts' }]
      notifHandler('fs.changed', { events })
      expect(first).toHaveBeenCalledWith(events)
      expect(second).toHaveBeenCalledWith(events)

      unsubFirst()
      expect(mux.notify).not.toHaveBeenCalledWith('fs.unwatch', { rootPath: '/home/user/project' })
      unsubSecond()
      expect(mux.notify).toHaveBeenCalledWith('fs.unwatch', { rootPath: '/home/user/project' })
    })

    it('does not retain a watch listener when fs.watch setup fails', async () => {
      mux.request.mockRejectedValueOnce(new Error('watch unavailable'))
      const first = vi.fn()
      await expect(provider.watch('/home/user/project', first)).rejects.toThrow('watch unavailable')

      const second = vi.fn()
      await provider.watch('/home/user/project', second)

      const notifHandler = mux.onNotification.mock.calls[0][0]
      const events = [{ kind: 'update', absolutePath: '/home/user/project/file.ts' }]
      notifHandler('fs.changed', { events })
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledWith(events)
    })

    it('does not forward sibling paths with matching prefixes', async () => {
      const callback = vi.fn()
      await provider.watch('/home/user/project', callback)

      const notifHandler = mux.onNotification.mock.calls[0][0]
      notifHandler('fs.changed', {
        events: [
          { kind: 'update', absolutePath: '/home/user/project-old/file.ts' },
          { kind: 'update', absolutePath: '/home/user/project2/file.ts' }
        ]
      })

      expect(callback).not.toHaveBeenCalled()
    })

    it('matches Windows and UNC watch roots case-insensitively', async () => {
      const driveCallback = vi.fn()
      const uncCallback = vi.fn()
      await provider.watch('C:\\Repo', driveCallback)
      await provider.watch('//Server/Share/Repo', uncCallback)

      const notifHandler = mux.onNotification.mock.calls[0][0]
      notifHandler('fs.changed', {
        events: [
          { kind: 'update', absolutePath: 'c:\\repo\\src\\file.ts' },
          { kind: 'update', absolutePath: '//server/share/repo/docs/readme.md' }
        ]
      })

      expect(driveCallback).toHaveBeenCalledWith([
        { kind: 'update', absolutePath: 'c:\\repo\\src\\file.ts' }
      ])
      expect(uncCallback).toHaveBeenCalledWith([
        { kind: 'update', absolutePath: '//server/share/repo/docs/readme.md' }
      ])
    })

    it('sends fs.unwatch when last listener unsubscribes', async () => {
      const callback = vi.fn()
      const unsub = await provider.watch('/home/user/project', callback)
      unsub()

      expect(mux.notify).toHaveBeenCalledWith('fs.unwatch', { rootPath: '/home/user/project' })
    })

    it('awaits acknowledged watcher teardown for destructive cleanup', async () => {
      const callback = vi.fn()
      await provider.watch('/home/user/project', callback)
      mux.request.mockClear()

      await provider.closeWatch('/home/user/project')

      expect(mux.request).toHaveBeenCalledWith('fs.unwatchAndWait', {
        rootPath: '/home/user/project'
      })
      const notifHandler = mux.onNotification.mock.calls[0][0]
      notifHandler('fs.changed', {
        events: [{ kind: 'update', absolutePath: '/home/user/project/file.ts' }]
      })
      expect(callback).not.toHaveBeenCalled()
    })

    it('fails destructive teardown closed on an older relay', async () => {
      const callback = vi.fn()
      await provider.watch('/home/user/project', callback)
      mux.request.mockRejectedValueOnce(
        Object.assign(new Error('Method not found'), { code: JsonRpcErrorCode.MethodNotFound })
      )

      await expect(provider.closeWatch('/home/user/project')).rejects.toThrow(
        'Reconnect the SSH target'
      )
      expect(mux.notify).not.toHaveBeenCalledWith('fs.unwatch', {
        rootPath: '/home/user/project'
      })
      const notifHandler = mux.onNotification.mock.calls[0][0]
      const events = [{ kind: 'update' as const, absolutePath: '/home/user/project/file.ts' }]
      notifHandler('fs.changed', { events })
      expect(callback).toHaveBeenCalledWith(events)
    })

    it('sends fs.unwatch for active roots when disposed', async () => {
      const callback = vi.fn()
      await provider.watch('/home/user/project', callback)

      provider.dispose()

      expect(mux.notify).toHaveBeenCalledWith('fs.unwatch', { rootPath: '/home/user/project' })
      const notifHandler = mux.onNotification.mock.calls[0][0]
      notifHandler('fs.changed', {
        events: [{ kind: 'update', absolutePath: '/home/user/project/file.ts' }]
      })
      expect(callback).not.toHaveBeenCalled()
    })

    it('unwatches when disposed while fs.watch setup is still resolving', async () => {
      let resolveWatch: () => void = () => {}
      mux.request.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveWatch = resolve
          })
      )
      const callback = vi.fn()
      const pendingWatch = provider.watch('/home/user/project', callback)

      provider.dispose()
      resolveWatch()

      await expect(pendingWatch).rejects.toThrow('SSH filesystem provider disposed')
      expect(mux.notify).toHaveBeenCalledWith('fs.unwatch', { rootPath: '/home/user/project' })
      const notifHandler = mux.onNotification.mock.calls[0][0]
      notifHandler('fs.changed', {
        events: [{ kind: 'update', absolutePath: '/home/user/project/file.ts' }]
      })
      expect(callback).not.toHaveBeenCalled()
    })

    it('does not send fs.unwatch while other roots are watched', async () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      const unsub1 = await provider.watch('/home/user/project-a', cb1)
      await provider.watch('/home/user/project-b', cb2)

      unsub1()
      expect(mux.notify).not.toHaveBeenCalledWith('fs.unwatch', {
        rootPath: '/home/user/project-b'
      })
    })
  })
})
