import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createJjBackend } from './jj-backend'
import type { JjExecutor } from '../../shared/jj-types'

const binary = process.env.JJ_BINARY ?? 'jj'

async function fixtureRun(request: Parameters<JjExecutor>[0]) {
  const { runProcess } = await import('../../shared/child-process/run-process')
  return runProcess({
    program: binary,
    args: request.args,
    cwd: request.cwd,
    signal: request.signal,
    outputEncoding: request.binary ? 'buffer' : 'utf8'
  })
}

async function createRepo(prefix: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), prefix))
  const init = await fixtureRun({ args: ['git', 'init', '--colocate', repo] })
  if (init.code !== 0) {
    await rm(repo, { recursive: true, force: true })
    throw new Error(`jj ${binary} fixture unavailable: ${String(init.stderr)}`)
  }
  return repo
}

describe('jj 0.44 real fixtures', () => {
  it('reports one backing identity and every root from a linked workspace', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'orca-jj-grouping-'))
    const owner = join(parent, 'spren')
    const sibling = join(parent, 'task-j')
    try {
      const init = await fixtureRun({ args: ['git', 'init', '--no-colocate', owner] })
      expect(init.code).toBe(0)
      const added = await fixtureRun({
        args: ['workspace', 'add', '--name', 'task-j', sibling],
        cwd: owner
      })
      expect(added.code).toBe(0)
      const ownerBackend = createJjBackend({ kind: 'native', cwd: owner }, { executor: fixtureRun })
      const siblingBackend = createJjBackend(
        { kind: 'native', cwd: sibling },
        { executor: fixtureRun }
      )
      const rewritten = await fixtureRun({
        args: ['describe', '-r', 'task-j@', '-m', 'rewritten from another workspace'],
        cwd: owner
      })
      expect(rewritten.code).toBe(0)
      const ownerDetection = await ownerBackend.detect()
      const siblingDetection = await siblingBackend.detect()
      expect(ownerDetection.ok).toBe(true)
      expect(siblingDetection.ok).toBe(true)
      if (!ownerDetection.ok || !siblingDetection.ok) {
        throw new Error('Expected both fixture workspaces to be detected')
      }
      expect(ownerDetection.repositoryIdentity).toBeTruthy()
      expect(siblingDetection.repositoryIdentity).toBe(ownerDetection.repositoryIdentity)
      const listing = await siblingBackend.listWorkspaces()
      expect(listing).toMatchObject({
        ok: true,
        workspaces: expect.arrayContaining([
          expect.objectContaining({ root: owner }),
          expect.objectContaining({ name: 'task-j', root: sibling })
        ])
      })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('classifies a real non-repository as stale', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'orca-jj-nonrepo-'))
    try {
      const backend = createJjBackend({ kind: 'native', cwd }, { executor: fixtureRun })
      await expect(backend.detect()).resolves.toMatchObject({ ok: false, kind: 'stale' })
      await expect(backend.detect()).resolves.toMatchObject({
        message: expect.stringContaining('There is no jj repo')
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('reports actual jj rename output for a selected revision', async () => {
    const repo = await createRepo('orca-jj-rename-')
    try {
      await writeFile(join(repo, 'old.txt'), 'rename me')
      await fixtureRun({ args: ['file', 'track', 'old.txt'], cwd: repo })
      await fixtureRun({ args: ['commit', '-m', 'base'], cwd: repo })
      await rename(join(repo, 'old.txt'), join(repo, 'new.txt'))
      await fixtureRun({ args: ['commit', '-m', 'rename'], cwd: repo })
      const revision = String(
        (
          await fixtureRun({
            args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
            cwd: repo
          })
        ).stdout
      ).trim()
      const backend = createJjBackend({ kind: 'native', cwd: repo }, { executor: fixtureRun })
      await expect(backend.readFileDiff({ path: 'new.txt', revision })).resolves.toMatchObject({
        ok: true,
        change: { path: 'new.txt', originalPath: 'old.txt', status: 'renamed' }
      })
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('returns real per-file stats and omits unavailable binary or pure-rename stats', async () => {
    const repo = await createRepo('orca-jj-line-stats-')
    try {
      await writeFile(join(repo, 'modified.txt'), 'old line\n')
      await writeFile(join(repo, 'deleted.txt'), 'remove me\n')
      await writeFile(join(repo, 'rename-old.txt'), 'rename me\n')
      await writeFile(join(repo, 'binary.dat'), Buffer.from([0, 1, 2, 127, 128, 255]))
      await fixtureRun({
        args: ['file', 'track', 'modified.txt', 'deleted.txt', 'rename-old.txt', 'binary.dat'],
        cwd: repo
      })
      await fixtureRun({ args: ['commit', '-m', 'base'], cwd: repo })

      await writeFile(join(repo, 'modified.txt'), 'new line\nextra line\n')
      await writeFile(join(repo, 'added.txt'), 'first\nsecond\n')
      await fixtureRun({ args: ['file', 'track', 'added.txt'], cwd: repo })
      await rm(join(repo, 'deleted.txt'))
      await rename(join(repo, 'rename-old.txt'), join(repo, 'rename-new.txt'))
      await writeFile(join(repo, 'binary.dat'), Buffer.from([0, 1, 2, 127, 128, 255, 0]))

      const backend = createJjBackend({ kind: 'native', cwd: repo }, { executor: fixtureRun })
      const result = await backend.listChanges()
      expect(result).toMatchObject({ ok: true })
      if (!result.ok) {
        throw new Error(JSON.stringify(result))
      }
      expect(result.changes).toEqual(
        expect.arrayContaining([
          { path: 'modified.txt', status: 'modified', stats: { added: 2, removed: 1 } },
          { path: 'added.txt', status: 'added', stats: { added: 2, removed: 0 } },
          { path: 'deleted.txt', status: 'deleted', stats: { added: 0, removed: 1 } },
          { path: 'rename-new.txt', originalPath: 'rename-old.txt', status: 'renamed' },
          { path: 'binary.dat', status: 'modified' }
        ])
      )
      expect(
        result.changes.find((change) => change.path === 'rename-new.txt')?.stats
      ).toBeUndefined()
      expect(result.changes.find((change) => change.path === 'binary.dat')?.stats).toBeUndefined()
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('reports both parents and conflict status for a real merge', async () => {
    const repo = await createRepo('orca-jj-merge-')
    try {
      await writeFile(join(repo, 'conflict.txt'), 'base')
      await fixtureRun({ args: ['file', 'track', 'conflict.txt'], cwd: repo })
      await fixtureRun({ args: ['commit', '-m', 'base'], cwd: repo })
      const base = String(
        (
          await fixtureRun({
            args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
            cwd: repo
          })
        ).stdout
      ).trim()
      await fixtureRun({ args: ['new', base], cwd: repo })
      await writeFile(join(repo, 'conflict.txt'), 'left')
      await fixtureRun({ args: ['commit', '-m', 'left'], cwd: repo })
      const left = String(
        (
          await fixtureRun({
            args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
            cwd: repo
          })
        ).stdout
      ).trim()
      await fixtureRun({ args: ['new', base], cwd: repo })
      await writeFile(join(repo, 'conflict.txt'), 'right')
      await fixtureRun({ args: ['commit', '-m', 'right'], cwd: repo })
      const right = String(
        (
          await fixtureRun({
            args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
            cwd: repo
          })
        ).stdout
      ).trim()
      await fixtureRun({ args: ['new', left, right], cwd: repo })
      const backend = createJjBackend({ kind: 'native', cwd: repo }, { executor: fixtureRun })
      await expect(backend.listChanges()).resolves.toMatchObject({
        ok: true,
        changes: [{ path: 'conflict.txt', status: 'conflicted' }]
      })
      const diff = await backend.readFileDiff({ path: 'conflict.txt' })
      expect(diff).toMatchObject({
        ok: true,
        parentDiffs: expect.arrayContaining([
          { parentRevision: left, diff: expect.any(Object) },
          { parentRevision: right, diff: expect.any(Object) }
        ])
      })
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('reads asymmetric merge file presence independently for each parent', async () => {
    const repo = await createRepo('orca-jj-asymmetric-')
    try {
      await fixtureRun({ args: ['commit', '-m', 'base'], cwd: repo })
      const base = String(
        (
          await fixtureRun({
            args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
            cwd: repo
          })
        ).stdout
      ).trim()
      await fixtureRun({ args: ['new', base], cwd: repo })
      await writeFile(join(repo, 'asymmetric.txt'), 'left')
      await fixtureRun({ args: ['file', 'track', 'asymmetric.txt'], cwd: repo })
      await fixtureRun({ args: ['commit', '-m', 'left'], cwd: repo })
      const left = String(
        (
          await fixtureRun({
            args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
            cwd: repo
          })
        ).stdout
      ).trim()
      await fixtureRun({ args: ['new', base], cwd: repo })
      await fixtureRun({ args: ['commit', '-m', 'right'], cwd: repo })
      const right = String(
        (
          await fixtureRun({
            args: ['log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
            cwd: repo
          })
        ).stdout
      ).trim()
      await fixtureRun({ args: ['new', left, right], cwd: repo })
      await writeFile(join(repo, 'asymmetric.txt'), 'merged')
      const backend = createJjBackend({ kind: 'native', cwd: repo }, { executor: fixtureRun })
      const diff = await backend.readFileDiff({ path: 'asymmetric.txt' })
      expect(diff).toMatchObject({ ok: true })
      if (!diff.ok || !diff.parentDiffs) {
        throw new Error('Expected asymmetric merge parent diffs')
      }
      expect(diff.parentDiffs.find((entry) => entry.parentRevision === left)).toMatchObject({
        diff: { kind: 'text', originalContent: 'left', modifiedContent: 'merged' }
      })
      expect(diff.parentDiffs.find((entry) => entry.parentRevision === right)).toMatchObject({
        diff: { kind: 'text', originalContent: '', modifiedContent: 'merged' }
      })
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('roundtrips real workspace, change, metadata, bookmark listing, and mutations', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'orca-jj-roundtrip-'))
    const repo = join(parent, 'owner')
    const linked = join(parent, 'linked')
    try {
      const init = await fixtureRun({ args: ['git', 'init', '--colocate', repo] })
      expect(init.code).toBe(0)
      await writeFile(join(repo, 'tracked.txt'), 'base\n')
      expect((await fixtureRun({ args: ['file', 'track', 'tracked.txt'], cwd: repo })).code).toBe(0)
      expect((await fixtureRun({ args: ['commit', '-m', 'base'], cwd: repo })).code).toBe(0)
      const backend = createJjBackend({ kind: 'native', cwd: repo }, { executor: fixtureRun })
      const commitId = String(
        (await fixtureRun({ args: ['log', '-r', '@', '--no-graph', '-T', 'commit_id'], cwd: repo }))
          .stdout
      ).trim()

      await expect(
        backend.addWorkspace({ destination: linked, name: 'linked' })
      ).resolves.toMatchObject({
        ok: true,
        destination: linked,
        name: 'linked'
      })
      await expect(backend.listWorkspaces()).resolves.toMatchObject({
        ok: true,
        workspaces: expect.arrayContaining([
          { name: 'default', root: repo },
          { name: 'linked', root: linked }
        ])
      })
      await expect(backend.getCurrentChangeMetadata()).resolves.toMatchObject({
        ok: true,
        metadata: {
          commitId,
          description: '',
          bookmarks: [],
          conflicted: false,
          workspaceName: 'default'
        }
      })

      await expect(
        backend.describe({ expectedCommitId: commitId, message: 'real description\nsecond line' })
      ).resolves.toEqual({ ok: true })
      const describedCommitId = String(
        (await fixtureRun({ args: ['log', '-r', '@', '--no-graph', '-T', 'commit_id'], cwd: repo }))
          .stdout
      ).trim()
      await expect(backend.getCurrentChangeMetadata()).resolves.toMatchObject({
        ok: true,
        metadata: { commitId: describedCommitId, description: 'real description\nsecond line\n' }
      })
      await expect(
        backend.createBookmark({ expectedCommitId: describedCommitId, name: 'roundtrip' })
      ).resolves.toEqual({ ok: true })
      await expect(backend.listLocalBookmarks()).resolves.toMatchObject({
        ok: true,
        bookmarks: [{ name: 'roundtrip', commitId: describedCommitId }]
      })
      await expect(backend.getCurrentChangeMetadata()).resolves.toMatchObject({
        ok: true,
        metadata: { bookmarks: [{ name: 'roundtrip', readOnly: true }] }
      })

      expect((await fixtureRun({ args: ['new', '@'], cwd: repo })).code).toBe(0)
      await writeFile(join(repo, 'tracked.txt'), 'changed\n')
      await expect(backend.listChanges()).resolves.toMatchObject({
        ok: true,
        changes: [{ path: 'tracked.txt', status: 'modified' }]
      })
      const refreshed = await backend.getCurrentChangeMetadata()
      expect(refreshed).toMatchObject({ ok: true })
      if (!refreshed.ok) {
        throw new Error(JSON.stringify(refreshed))
      }
      const refreshedCommitId = refreshed.metadata.commitId
      await expect(
        backend.moveBookmark({ expectedCommitId: refreshedCommitId, name: 'roundtrip' })
      ).resolves.toEqual({ ok: true })
      await expect(backend.listLocalBookmarks()).resolves.toMatchObject({
        ok: true,
        bookmarks: [{ name: 'roundtrip', commitId: refreshedCommitId }]
      })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
