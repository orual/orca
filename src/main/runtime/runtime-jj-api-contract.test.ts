import { afterEach, describe, expect, it, vi } from 'vitest'

const { runProcessMock } = vi.hoisted(() => ({
  runProcessMock: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '', timedOut: false })
}))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: runProcessMock }))

import { JJ_METHODS } from './rpc/methods/jj'
import { RuntimeJjCommands, normalizeWorkspaceAddInput } from './orca-runtime-jj'
import { unregisterSshJjProvider } from '../providers/ssh-jj-dispatch'
import type { RuntimeGitTarget } from './runtime-git-command-target'
import { requireRuntimeJjBackend } from './runtime-jj-command-target'
import type { JjWorkspaceAddInput } from '../../shared/jj-types'
import type { RuntimeJjRoute } from './runtime-jj-command-target'

const RPC_TO_RUNTIME_COMMAND = {
  'jj.detect': 'detectRuntimeJj',
  'jj.listWorkspaces': 'listRuntimeJjWorkspaces',
  'jj.addWorkspace': 'addRuntimeJjWorkspace',
  'jj.removeWorkspace': 'removeRuntimeJjWorkspace',
  'jj.listChanges': 'listRuntimeJjChanges',
  'jj.readFileDiff': 'readRuntimeJjFileDiff',
  'jj.getCurrentChangeMetadata': 'getRuntimeJjCurrentChangeMetadata',
  'jj.listLocalBookmarks': 'listRuntimeJjLocalBookmarks',
  'jj.listRemotes': 'listRuntimeJjRemotes',
  'jj.fetchRemote': 'fetchRuntimeJjRemote',
  'jj.pushBookmark': 'pushRuntimeJjBookmark',
  'jj.describe': 'describeRuntimeJjCurrentChange',
  'jj.createBookmark': 'createRuntimeJjBookmark',
  'jj.moveBookmark': 'moveRuntimeJjBookmark',
  'jj.commit': 'commitRuntimeJj',
  'jj.updateWorkspaceStale': 'updateRuntimeJjWorkspaceStale'
} as const satisfies Record<string, keyof RuntimeJjCommands>

const worktree = (path: string) =>
  ({ id: 'wt-1', repoId: 'repo-1', path, git: {} }) as RuntimeGitTarget['worktree']

function target(
  path: string,
  executionHostId: RuntimeGitTarget['executionHostId'] = 'local',
  localGitOptions?: RuntimeGitTarget['localGitOptions']
): RuntimeGitTarget {
  return {
    worktree: worktree(path),
    executionHostId,
    ...(localGitOptions ? { localGitOptions } : {})
  }
}

afterEach(() => {
  unregisterSshJjProvider('jj-contract-ssh')
})

describe('runtime jj API contract', () => {
  it('keeps every registered jj RPC paired with one public runtime command', () => {
    const commands = new RuntimeJjCommands({
      resolveRuntimeGitTarget: async () => {
        throw new Error('not called')
      }
    })
    const registeredMethods = JJ_METHODS.map((method) => method.name).sort()

    expect(registeredMethods).toEqual(Object.keys(RPC_TO_RUNTIME_COMMAND).sort())
    for (const commandName of Object.values(RPC_TO_RUNTIME_COMMAND)) {
      expect(commands[commandName]).toBeTypeOf('function')
    }
  })

  it.each([
    [
      'native',
      { kind: 'local', backend: {} as never, target: 'native' } as RuntimeJjRoute,
      'C:\\new'
    ],
    [
      'ssh',
      { kind: 'ssh', connectionId: 'jj-contract-ssh', provider: {} as never } as RuntimeJjRoute,
      '/remote/new'
    ]
  ])('preserves %s destination identity', (_label, route, destination) => {
    const input: JjWorkspaceAddInput = { destination }
    expect(normalizeWorkspaceAddInput(input, route)).toEqual(input)
  })

  it('maps a same-distro WSL UNC destination to guest space', () => {
    const route = {
      kind: 'local',
      backend: {} as never,
      target: 'wsl',
      wslDistro: 'Ubuntu'
    } as RuntimeJjRoute
    expect(
      normalizeWorkspaceAddInput(
        { destination: String.raw`\\wsl.localhost\Ubuntu\home\me\new` },
        route
      )
    ).toMatchObject({ destination: '/home/me/new' })
  })

  it('rejects cross-distro and unmappable WSL destinations', () => {
    const route = {
      kind: 'local',
      backend: {} as never,
      target: 'wsl',
      wslDistro: 'Ubuntu'
    } as RuntimeJjRoute
    expect(() =>
      normalizeWorkspaceAddInput(
        { destination: String.raw`\\wsl.localhost\Debian\home\me\new` },
        route
      )
    ).toThrow('jj_workspace_destination_distro_mismatch')
    expect(() =>
      normalizeWorkspaceAddInput({ destination: String.raw`\\server\share\new` }, route)
    ).toThrow('jj_workspace_destination_unmappable')
  })

  it('routes runtime listing, detection, and removal through the selected WSL distro', async () => {
    const responses = [
      '"feature"\t"/workspace/feature"\n',
      'jj 0.44.0',
      '/repo',
      '/repo/.git',
      'Working copy changes:\n',
      ''
    ]
    let responseIndex = 0
    runProcessMock.mockImplementation(async (spec: { args: string[] }) => {
      const command = spec.args.at(-1) ?? ''
      const begin = /__ORCA_WSL_CAPTURE_BEGIN_[a-z0-9]+__/.exec(command)?.[0] ?? ''
      const end = /__ORCA_WSL_CAPTURE_END_[a-z0-9]+__/.exec(command)?.[0] ?? ''
      const payload = responses[responseIndex++] ?? ''
      return {
        code: 0,
        stdout: `${begin}${payload}${end}`,
        stderr: '',
        timedOut: false
      }
    })
    const command = new RuntimeJjCommands({
      resolveRuntimeGitTarget: async () =>
        target(String.raw`C:\repo`, 'local', { wslDistro: 'Ubuntu' })
    })

    const listing = await command.listRuntimeJjWorkspaces('wt-1')
    expect(listing).toEqual({
      ok: true,
      workspaces: [{ name: 'feature', root: '/workspace/feature' }]
    })
    await expect(command.detectRuntimeJj('wt-1')).resolves.toMatchObject({
      ok: true,
      version: '0.44.0',
      root: '/repo',
      colocated: true
    })
    await expect(
      command.removeRuntimeJjWorkspace('wt-1', {
        name: 'feature',
        targetRoot: '/workspace/feature',
        ownerRoot: '/repo'
      })
    ).resolves.toEqual({ ok: true })

    expect(runProcessMock).toHaveBeenCalledTimes(6)
    for (const [spec] of runProcessMock.mock.calls) {
      expect(spec).toMatchObject({
        program: 'wsl.exe',
        args: expect.arrayContaining(['-d', 'Ubuntu', '--exec', 'sh', '-lc'])
      })
    }
    const commands = runProcessMock.mock.calls.map(([spec]) => spec.args.at(-1) as string)
    expect(commands[0]).toMatch(/'workspace'.*'list'/s)
    expect(commands[1]).toMatch(/'--version'/)
    expect(commands[2]).toMatch(/'--ignore-working-copy'.*'root'/s)
    expect(commands[3]).toMatch(/'--ignore-working-copy'.*'git'.*'root'/s)
    expect(commands[4]).toMatch(/cd .*workspace\/feature.*'jj'.*'status'/s)
    expect(commands[5]).toMatch(/cd .*repo.*'jj'.*'workspace'.*'forget'/s)
  })

  it('preserves a POSIX filename containing a backslash', () => {
    const route = {
      kind: 'local',
      backend: {} as never,
      target: 'native'
    } as RuntimeJjRoute
    expect(normalizeWorkspaceAddInput({ destination: '/tmp/name\\with-backslash' }, route)).toEqual(
      {
        destination: '/tmp/name\\with-backslash'
      }
    )
  })

  it.each([
    ['native', target('/repo')],
    ['wsl', target(String.raw`C:\repo`, 'local', { wslDistro: 'Ubuntu' })]
  ] as const)(
    'forwards runtime cancellation to the %s executor',
    async (_label, resolvedTarget) => {
      runProcessMock.mockClear()
      const controller = new AbortController()
      controller.abort()
      const route = requireRuntimeJjBackend(resolvedTarget, controller.signal)
      if (route.kind !== 'local') {
        throw new Error('expected local route')
      }
      await route.backend.listWorkspaces()
      expect(runProcessMock).toHaveBeenCalledWith(
        expect.objectContaining({ signal: controller.signal })
      )
    }
  )
})
