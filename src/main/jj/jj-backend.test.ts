import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDefaultExecutor, createJjBackend, JJ_MINIMUM_VERSION } from './jj-backend'
import { failureForProcess } from './jj-output-parsing'
import type { JjExecutor, JjProcessResult } from '../../shared/jj-types'

const success = (stdout: string | Buffer): JjProcessResult => ({
  code: 0,
  stdout,
  stderr: '',
  timedOut: false
})
const failure = (stderr: string, code = 1): JjProcessResult => ({
  code,
  stdout: '',
  stderr,
  timedOut: false
})

function requestExecutor(
  handler: (args: readonly string[]) => JjProcessResult | Promise<JjProcessResult>
): JjExecutor {
  return async ({ args }) => handler(args[0] === '--ignore-working-copy' ? args.slice(1) : args)
}

describe('jj backend contract', () => {
  it('classifies the real stale working-copy stderr as recoverable stale', () => {
    const result = failureForProcess(
      failure(
        'Error: The working copy is stale (not updated since operation 838e6b416165). Hint: Run `jj workspace update-stale` to update it. See https://docs.jj-vcs.dev/latest/working-copy/#stale-working-copy for more information.'
      ),
      'jj diff'
    )
    expect(result).toMatchObject({
      kind: 'stale',
      message: expect.stringContaining('working copy is stale')
    })
  })

  it('requires a real repository root and reports colocation', async () => {
    const calls: string[][] = []
    const backend = createJjBackend(
      { kind: 'native', cwd: '/repo' },
      {
        executor: async (request) => {
          calls.push([...request.args])
          if (request.args[0] === '--version') {
            return success(`jj ${JJ_MINIMUM_VERSION}\n`)
          }
          if (request.args[0] === '--ignore-working-copy' && request.args[1] === 'root') {
            return success('/repo\n')
          }
          return success('/repo/.git\n')
        }
      }
    )
    await expect(backend.detect()).resolves.toMatchObject({
      ok: true,
      version: JJ_MINIMUM_VERSION,
      root: '/repo',
      colocated: true,
      repositoryIdentity: '/repo/.git'
    })
    expect(calls).toEqual([
      ['--version'],
      ['--ignore-working-copy', 'root'],
      ['--ignore-working-copy', 'git', 'root']
    ])

    const unavailable = createJjBackend(
      { kind: 'native' },
      {
        executor: requestExecutor((args) =>
          args[0] === '--version'
            ? success(`jj ${JJ_MINIMUM_VERSION}\n`)
            : failure('not a jj repository')
        )
      }
    )
    await expect(unavailable.detect()).resolves.toMatchObject({ ok: false, kind: 'stale' })
  })

  it('rejects unsupported versions and missing jj without empty success', async () => {
    const old = createJjBackend(
      { kind: 'native' },
      { executor: requestExecutor(() => success('jj 0.43.1\n')) }
    )
    await expect(old.detect()).resolves.toMatchObject({ ok: false, kind: 'unsupported' })
    const missing = createJjBackend(
      { kind: 'native' },
      { executor: requestExecutor(() => failure('jj: command not found', 127)) }
    )
    await expect(missing.listWorkspaces()).resolves.toMatchObject({
      ok: false,
      kind: 'unavailable'
    })
  })

  it('creates a workspace with revision, option terminator, and quoted destination argv', async () => {
    const calls: readonly string[][] = []
    const backend = createJjBackend(
      { kind: 'native', cwd: '/repo' },
      {
        executor: async (request) => {
          ;(calls as string[][]).push([...request.args])
          return success('created')
        }
      }
    )
    await expect(
      backend.addWorkspace({
        destination: '-strange/with quote',
        name: 'feature name',
        revision: 'main@'
      })
    ).resolves.toEqual({ ok: true, destination: '-strange/with quote', name: 'feature name' })
    expect(calls).toEqual([
      [
        'workspace',
        'add',
        '--name',
        'feature name',
        '--revision',
        'main@',
        '--',
        '-strange/with quote'
      ]
    ])
  })

  it('attaches per-file stats from bounded jj git patches without invoking git', async () => {
    const calls: string[][] = []
    const backend = createJjBackend(
      { kind: 'native' },
      {
        executor: async (request) => {
          calls.push([...request.args])
          if (request.args[0] === 'log') {
            return success('parent\n')
          }
          if (request.args.includes('--template')) {
            return success('"src/file.txt"\tnull\tmodified\tfalse\tfalse\tfile\tfile\n')
          }
          return success(
            'diff --git a/src/file.txt b/src/file.txt\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n'
          )
        }
      }
    )
    const result = await backend.listChanges()
    if (!result.ok) {
      throw new Error(JSON.stringify(result))
    }
    expect(result).toMatchObject({
      ok: true,
      changes: [{ path: 'src/file.txt', stats: { added: 2, removed: 1 } }]
    })
    expect(calls.some((args) => args.includes('--git'))).toBe(true)
    expect(calls.some((args) => args[0] === 'git')).toBe(false)
  })

  it('parses C-quoted patch paths when attaching stats', async () => {
    const path = 'src/quote"file.txt'
    const backend = createJjBackend(
      { kind: 'native' },
      {
        executor: async ({ args }) => {
          if (args[0] === 'log') {
            return success('parent\n')
          }
          if (args.includes('--template')) {
            return success(`${JSON.stringify(path)}\tnull\tmodified\tfalse\tfalse\tfile\tfile\n`)
          }
          return success(
            `diff --git ${JSON.stringify(`a/${path}`)} ${JSON.stringify(`b/${path}`)}\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n`
          )
        }
      }
    )
    const result = await backend.listChanges()
    if (!result.ok) {
      throw new Error(JSON.stringify(result))
    }
    expect(result).toMatchObject({
      ok: true,
      changes: [{ path, stats: { added: 2, removed: 1 } }]
    })
  })

  it('omits binary and unavailable patch stats instead of reporting zero', async () => {
    const backend = createJjBackend(
      { kind: 'native' },
      {
        executor: async ({ args }) => {
          if (args[0] === 'log') {
            return success('parent\n')
          }
          if (args.includes('--template')) {
            return success('"binary.dat"\tnull\tmodified\tfalse\tfalse\tfile\tfile\n')
          }
          return success(
            'diff --git a/binary.dat b/binary.dat\\nBinary files a/binary.dat and b/binary.dat differ\\n'
          )
        }
      }
    )
    const result = await backend.listChanges()
    if (!result.ok) {
      throw new Error(JSON.stringify(result))
    }
    expect(result).toMatchObject({
      ok: true,
      changes: [{ path: 'binary.dat' }]
    })
    expect(result.changes[0]?.stats).toBeUndefined()
  })

  it('parses nullable roots, conflicts, and rename source paths', async () => {
    const backend = createJjBackend(
      { kind: 'native' },
      {
        executor: requestExecutor((args) => {
          if (args[0] === 'workspace') {
            return success('"default"\t"/repo"\n"old"\tnull\n')
          }
          return success(
            '"new name"\t"old name"\trenamed\tfalse\tfalse\n"conflict"\tnull\tmodified\ttrue\tfalse\n'
          )
        })
      }
    )
    await expect(backend.listWorkspaces()).resolves.toEqual({
      ok: true,
      workspaces: [
        { name: 'default', root: '/repo' },
        { name: 'old', root: null }
      ]
    })
    await expect(backend.listChanges()).resolves.toEqual({
      ok: true,
      comparison: 'current-change-vs-parents',
      changes: [
        { path: 'new name', originalPath: 'old name', status: 'renamed' },
        { path: 'conflict', status: 'conflicted' }
      ]
    })
  })

  it('preserves POSIX backslash filenames and quotes in filesets', async () => {
    const path = 'dir\\name/quote"file.txt'
    const calls: string[][] = []
    const backend = createJjBackend(
      { kind: 'native' },
      {
        executor: async (request) => {
          calls.push([...request.args])
          if (request.args[0] === 'diff') {
            return success(
              `{JSON.stringify(path)}\tnull\tmodified\tfalse\tfalse\tfile\tfile\n`.replace(
                '{JSON.stringify(path)}',
                JSON.stringify(path)
              )
            )
          }
          if (request.args[0] === 'log') {
            return success('parent\n')
          }
          return success(Buffer.from('content\n'))
        }
      }
    )
    await expect(backend.readFileDiff({ path })).resolves.toMatchObject({ ok: true, path })
    expect(calls.some((args) => args.includes(`file:${JSON.stringify(path)}`))).toBe(true)
  })

  it('reads binary bytes through the real default native executor', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'orca-jj-binary-'))
    try {
      const binary = Buffer.from([0, 1, 2, 127, 128, 255])
      const file = join(repo, 'data.bin')
      const { runProcess } = await import('../../shared/child-process/run-process')
      await runProcess({
        program: process.env.JJ_BINARY ?? 'jj',
        args: ['git', 'init', '--colocate', repo]
      })
      await writeFile(file, binary)
      await runProcess({
        program: process.env.JJ_BINARY ?? 'jj',
        args: ['file', 'track', 'data.bin'],
        cwd: repo
      })
      await runProcess({
        program: process.env.JJ_BINARY ?? 'jj',
        args: ['commit', '-m', 'binary'],
        cwd: repo
      })
      const executor = createDefaultExecutor({
        kind: 'native',
        cwd: repo,
        program: process.env.JJ_BINARY ?? 'jj'
      })
      const result = await executor({
        args: ['file', 'show', '--revision', '@', 'file:data.bin'],
        binary: true
      })
      expect(Buffer.isBuffer(result.stdout)).toBe(true)
      expect(result.stdout).toEqual(binary)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('reads current metadata and matches workspace name by root', async () => {
    const backend = createJjBackend(
      { kind: 'native', cwd: '/repo' },
      {
        executor: requestExecutor((args) => {
          if (args[0] === 'log') {
            return success(
              '"commit-full"\t"change-id"\t"description\\nbody"\ttrue\t[{"name":"main"}]\n'
            )
          }
          if (args[0] === 'root') {
            return success('/repo\n')
          }
          return success('"default"\t"/repo/"\n')
        })
      }
    )
    await expect(backend.getCurrentChangeMetadata()).resolves.toEqual({
      ok: true,
      metadata: {
        commitId: 'commit-full',
        changeId: 'change-id',
        description: `description
body`,
        bookmarks: [{ name: 'main', readOnly: true }],
        conflicted: true,
        workspaceName: 'default'
      }
    })
  })

  it('commits all explicitly and selected files with exact escaped filesets', async () => {
    const calls: string[][] = []
    const backend = createJjBackend(
      { kind: 'native', cwd: '/repo' },
      {
        executor: requestExecutor((args) => {
          calls.push([...args])
          if (args[0] === 'log') {
            return success('"commit-full"\t"change-id"\t""\tfalse\t[]\n')
          }
          if (args[0] === 'root') {
            return success('/repo\n')
          }
          if (args[0] === 'workspace') {
            return success('"default"\t"/repo"\n')
          }
          if (args[0] === 'diff') {
            return success('"new"\t"old"\trenamed\tfalse\tfalse\tfile\tfile\n')
          }
          return success('')
        })
      }
    )
    await expect(
      backend.commit({ expectedCommitId: 'commit-full', message: 'all', intent: { kind: 'all' } })
    ).resolves.toEqual({ ok: true })
    await expect(
      backend.commit({
        expectedCommitId: 'commit-full',
        message: 'selected',
        intent: { kind: 'selected', paths: ['old'] }
      })
    ).resolves.toEqual({ ok: true })
    expect(calls).toContainEqual(['commit', '-m', 'all'])
    expect(calls).toContainEqual(['commit', '-m', 'selected', '--', 'file:"new"', 'file:"old"'])
  })

  it('rechecks identity after selected diff validation and before dispatch', async () => {
    const calls: string[][] = []
    let metadataReads = 0
    const backend = createJjBackend(
      { kind: 'native', cwd: '/repo' },
      {
        executor: requestExecutor((args) => {
          calls.push([...args])
          if (args[0] === 'log') {
            metadataReads += 1
            return success(
              `"${metadataReads === 1 ? 'commit-full' : 'commit-changed'}"\t"change-id"\t""\tfalse\t[]\n`
            )
          }
          if (args[0] === 'root') {
            return success('/repo\n')
          }
          if (args[0] === 'workspace') {
            return success('"default"\t"/repo"\n')
          }
          if (args[0] === 'diff') {
            return success('"present"\tnull\tmodified\tfalse\tfalse\tfile\tfile\n')
          }
          return success('')
        })
      }
    )

    await expect(
      backend.commit({
        expectedCommitId: 'commit-full',
        message: 'selected',
        intent: { kind: 'selected', paths: ['present'] }
      })
    ).resolves.toMatchObject({ kind: 'stale' })
    const finalMetadataRead = calls.findLastIndex((args) => args[0] === 'log' && args.includes('@'))
    const diffRead = calls.findIndex((args) => args[0] === 'diff')
    expect(finalMetadataRead).toBeGreaterThan(diffRead)
    expect(calls.filter((args) => args[0] === 'commit')).toHaveLength(0)
  })

  it('rejects empty, stale, and unmatched selections before commit and preserves uncertain outcomes', async () => {
    const calls: string[][] = []
    const backend = createJjBackend(
      { kind: 'native', cwd: '/repo' },
      {
        executor: requestExecutor((args) => {
          calls.push([...args])
          if (args[0] === 'log') {
            return success('"commit-full"\t"change-id"\t""\tfalse\t[]\n')
          }
          if (args[0] === 'root') {
            return success('/repo\n')
          }
          if (args[0] === 'workspace') {
            return success('"default"\t"/repo"\n')
          }
          if (args[0] === 'diff') {
            return success('"present"\tnull\tmodified\tfalse\tfalse\tfile\tfile\n')
          }
          return { ...success(''), timedOut: true, code: null }
        })
      }
    )
    await expect(
      backend.commit({
        expectedCommitId: 'commit-full',
        message: 'empty',
        intent: { kind: 'selected', paths: [] }
      })
    ).resolves.toMatchObject({ kind: 'stale' })
    await expect(
      backend.commit({ expectedCommitId: 'old', message: 'stale', intent: { kind: 'all' } })
    ).resolves.toMatchObject({ kind: 'stale' })
    await expect(
      backend.commit({
        expectedCommitId: 'commit-full',
        message: 'missing',
        intent: { kind: 'selected', paths: ['missing'] }
      })
    ).resolves.toMatchObject({ kind: 'stale' })
    await expect(
      backend.commit({
        expectedCommitId: 'commit-full',
        message: 'timeout',
        intent: { kind: 'all' }
      })
    ).resolves.toMatchObject({ kind: 'uncertain', uncertain: true })
    expect(calls.filter((args) => args[0] === 'commit')).toHaveLength(1)
  })

  it('reads renamed files from source paths and exposes every merge parent', async () => {
    const calls: string[][] = []
    const backend = createJjBackend(
      { kind: 'native' },
      {
        executor: async (request) => {
          calls.push([...request.args])
          if (request.args[0] === 'diff') {
            return success('"new"\t"old"\trenamed\tfalse\tfalse\tfile\tfile\n')
          }
          if (request.args[0] === 'log') {
            return success('parent-a\nparent-b\n')
          }
          if (request.args[0] === 'file' && request.args[3] === '@') {
            return success(Buffer.from('new content'))
          }
          return success(Buffer.from('old content'))
        }
      }
    )
    const result = await backend.readFileDiff({ path: 'new' })
    expect(result).toMatchObject({
      ok: true,
      change: { originalPath: 'old', status: 'renamed' },
      parentDiffs: [{ parentRevision: 'parent-a' }, { parentRevision: 'parent-b' }]
    })
    expect(calls).toContainEqual(
      expect.arrayContaining(['diff', '--from', 'parent-a', '--to', '@'])
    )
    expect(calls).toContainEqual(
      expect.arrayContaining(['diff', '--from', 'parent-b', '--to', '@'])
    )
    expect(calls).toContainEqual(['file', 'show', '--revision', 'parent-a', 'file:"old"'])
    expect(calls).toContainEqual(['file', 'show', '--revision', 'parent-b', 'file:"old"'])
  })

  it('snapshots the target workspace before forgetting it from the owner workspace', async () => {
    const calls: { args: string[]; cwd?: string }[] = []
    const backend = createJjBackend(
      { kind: 'native', cwd: '/repo' },
      {
        executor: async ({ args, cwd }) => {
          calls.push({ args: [...args], cwd })
          return success('')
        }
      }
    )

    await expect(
      backend.removeWorkspace({
        name: 'feature',
        targetRoot: '/workspace/feature',
        ownerRoot: '/repo'
      })
    ).resolves.toEqual({ ok: true })

    expect(calls).toEqual([
      { args: ['status'], cwd: '/workspace/feature' },
      { args: ['workspace', 'forget', '--', 'feature'], cwd: '/repo' }
    ])
  })

  it('runs workspace update-stale with the supported jj 0.44 argv and preserves uncertain outcomes', async () => {
    const calls: string[][] = []
    const backend = createJjBackend(
      { kind: 'native', cwd: '/repo' },
      {
        executor: async ({ args }) => {
          calls.push([...args])
          return success('')
        }
      }
    )
    await expect(backend.updateWorkspaceStale()).resolves.toEqual({ ok: true })
    expect(calls).toEqual([['workspace', 'update-stale']])

    const uncertainBackend = createJjBackend(
      { kind: 'native', cwd: '/repo' },
      {
        executor: async () => ({ ...success(''), code: null, timedOut: true })
      }
    )
    await expect(uncertainBackend.updateWorkspaceStale()).resolves.toMatchObject({
      kind: 'uncertain',
      uncertain: true
    })
  })

  it('rejects an actual NUL in bookmark names before invoking jj', async () => {
    const calls: string[][] = []
    const backend = createJjBackend(
      { kind: 'native', cwd: '/repo' },
      {
        executor: async ({ args }) => {
          calls.push([...args])
          return success('')
        }
      }
    )
    await expect(
      backend.createBookmark({ expectedCommitId: 'commit-full', name: `bad\0name` })
    ).resolves.toMatchObject({ ok: false, kind: 'error' })
    expect(calls).toEqual([])
  })

  it('propagates native request cwd and cancellation to the approved process runner', async () => {
    const controller = new AbortController()
    const executor = createDefaultExecutor({ kind: 'native', cwd: '/target', program: 'jj' })
    controller.abort()
    const result = await executor({
      args: ['--version'],
      cwd: '/request',
      signal: controller.signal
    })
    expect(result.code).toBeNull()
  })

  it('builds WSL requests with request cwd and cancellation without shell-unsafe argv', async () => {
    const requests: string[][] = []
    const controller = new AbortController()
    const backend = createJjBackend(
      { kind: 'wsl', cwd: '/target', distro: 'Ubuntu' },
      {
        executor: async (request) => {
          requests.push([...request.args])
          expect(request.cwd).toBe('/request')
          expect(request.signal).toBe(controller.signal)
          return success('')
        }
      }
    )
    await backend.listWorkspaces()
    expect(requests).toHaveLength(1)
    controller.abort()
  })
})

describe('jj backend real repository', () => {
  it('detects colocated and non-colocated jj repositories with jj 0.44', async () => {
    const binary = process.env.JJ_BINARY ?? 'jj'
    for (const colocated of [true, false]) {
      const repo = await mkdtemp(join(tmpdir(), `orca-jj-${colocated ? 'co' : 'non'}-`))
      try {
        const run: JjExecutor = async (request) => {
          const { runProcess } = await import('../../shared/child-process/run-process')
          return runProcess({
            program: binary,
            args: request.args,
            cwd: request.cwd,
            signal: request.signal,
            outputEncoding: request.binary ? 'buffer' : 'utf8'
          })
        }
        await run({ args: ['git', 'init', colocated ? '--colocate' : '--no-colocate', repo] })
        const backend = createJjBackend({ kind: 'native', cwd: repo }, { executor: run })
        await expect(backend.detect()).resolves.toMatchObject({ ok: true, root: repo, colocated })
      } finally {
        await rm(repo, { recursive: true, force: true })
      }
    }
  })
})
