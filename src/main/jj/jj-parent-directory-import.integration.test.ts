import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { scanNestedRepos } from '../project-groups/nested-repo-discovery'
import { listJjWorkspacesForRepo, buildJjWorktreeInfos } from './jj-workspace-catalog'
import type { JjExecutor } from '../../shared/jj-types'
import type { Repo } from '../../shared/repo-types'

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

async function runJj(args: string[], cwd?: string): Promise<void> {
  const result = await fixtureRun({ args, cwd })
  if (result.code !== 0) {
    throw new Error(`jj ${args.join(' ')} failed: ${String(result.stderr)}`)
  }
}

describe('real jj parent-directory import acceptance', () => {
  it(
    'imports linked siblings as one project and catalogs every root',
    { timeout: 30_000 },
    async () => {
      const fixture = await mkdtemp(join(tmpdir(), 'orca-jj-parent-import-'))
      const dataDir = await mkdtemp(join(tmpdir(), 'orca-jj-parent-profile-'))
      try {
        const scanRoot = join(fixture, 'spren-project')
        const spren = join(scanRoot, 'spren')
        const epic = join(scanRoot, 'epic')
        const task = join(scanRoot, 'task')
        const atproto = join(scanRoot, 'atproto-crdt')
        const outside = join(fixture, 'orca', 'workspaces', 'spren', 'review')
        await mkdir(scanRoot, { recursive: true })
        await mkdir(atproto, { recursive: true })
        await mkdir(join(fixture, 'orca', 'workspaces', 'spren'), { recursive: true })
        await writeFile(join(atproto, 'README.md'), 'distinct repository')
        await runJj(['git', 'init', '--colocate', atproto])
        await runJj(['git', 'init', '--colocate', spren])
        await runJj(['workspace', 'add', '--name', 'epic', '--', epic], spren)
        await runJj(['workspace', 'add', '--name', 'task', '--', task], spren)
        await runJj(['workspace', 'add', '--name', 'review', '--', outside], spren)

        const scan = await scanNestedRepos({ path: scanRoot })
        expect(scan.selectedPath).toBe(scanRoot)
        expect(scan.repos.map((entry) => entry.path)).toEqual([atproto, epic, spren, task].sort())
        expect(
          scan.repos.filter((entry) => entry.kind === 'jj').map((entry) => entry.path)
        ).toEqual([atproto, epic, spren, task].sort())

        const ownerProbe = await (async () => {
          const probe = await import('../ipc/repos/local-repo-registration')
          return probe.probeLocalJjRepo(epic, true)
        })()
        expect(ownerProbe).toMatchObject({ kind: 'jj', ownerRoot: spren })

        const imported: Repo[] = []
        const groups: { id: string; name: string; parentPath: string | null }[] = []
        const store = {
          getRepos: () => imported,
          addRepo: vi.fn((repo: Repo) => imported.push(repo)),
          getSettings: () => ({
            workspaceDir: join(fixture, 'orca', 'workspaces'),
            nestWorkspaces: true,
            workspaceDirHistory: [],
            worktreeVisibilityDefaults: {}
          }),
          getAllWorktreeMeta: () => ({}),
          getAllWorktreeLineage: () => ({}),
          createProjectGroup: vi.fn((input: { name: string; parentPath?: string | null }) => {
            const group = {
              id: `group-${groups.length + 1}`,
              name: input.name,
              parentPath: input.parentPath ?? null,
              parentGroupId: null,
              createdFrom: 'folder-scan' as const,
              tabOrder: groups.length,
              isCollapsed: false,
              color: null,
              createdAt: 1,
              updatedAt: 1
            }
            groups.push(group)
            return group
          }),
          deleteProjectGroup: vi.fn(),
          moveProjectToGroup: vi.fn(),
          getProjectHostSetups: () => [],
          updateProjectHostSetup: vi.fn()
        }

        const handlers = new Map<string, (...args: unknown[]) => unknown>()
        vi.doMock('electron', () => ({
          ipcMain: {
            handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
              handlers.set(channel, handler)
            }
          }
        }))
        const { registerNestedRepoImportHandler } =
          await import('./../ipc/repos/nested-repo-import-handler')
        registerNestedRepoImportHandler(
          { isDestroyed: () => false, webContents: { send: vi.fn() } } as never,
          store as never
        )
        const importedResult = (await handlers.get('projectGroups:importNested')!(null, {
          parentPath: scanRoot,
          groupName: 'spren-project',
          projectPaths: scan.repos.map((entry) => entry.path),
          mode: 'group'
        })) as {
          importedCount: number
          alreadyKnownCount: number
          failedCount: number
          projects: { path: string; projectId?: string; status: string }[]
        }

        expect(importedResult).toMatchObject({
          importedCount: 2,
          alreadyKnownCount: 2,
          failedCount: 0
        })
        expect(imported).toHaveLength(2)
        expect(imported.map((repo) => repo.path)).toEqual([atproto, spren])
        expect(imported.filter((repo) => repo.kind === 'jj')).toHaveLength(2)
        expect(groups).toHaveLength(1)
        const jjProjectId = imported.find((repo) => repo.path === spren)?.id
        expect(
          importedResult.projects
            .filter((project) => project.path === epic || project.path === task)
            .map((project) => project.projectId)
        ).toEqual([jjProjectId, jjProjectId])
        expect(importedResult.projects.find((project) => project.path === spren)?.projectId).toBe(
          jjProjectId
        )
        expect(importedResult.projects.some((project) => project.path === outside)).toBe(false)

        const jjRepo = imported.find((repo) => repo.path === spren)
        if (!jjRepo) {
          throw new Error('Expected imported jj project')
        }
        const catalog = await listJjWorkspacesForRepo(jjRepo)
        expect(catalog).toMatchObject({ ok: true, complete: true })
        if (!catalog.ok) {
          throw new Error(catalog.message)
        }
        expect(catalog.workspaces.map((workspace) => workspace.root).sort()).toEqual(
          [spren, epic, task, outside].sort()
        )
        const rows = buildJjWorktreeInfos(store as never, jjRepo, catalog)
        expect(rows.map((row) => row.path).sort()).toEqual([spren, epic, task, outside].sort())
        expect(rows.every((row) => row.jjWorkspace?.rootResolved === true)).toBe(true)
      } finally {
        await rm(fixture, { recursive: true, force: true })
        await rm(dataDir, { recursive: true, force: true })
      }
    }
  )
})
