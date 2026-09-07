// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import type { DiffContent, FileContent } from './editor-panel-content-types'

const mocks = vi.hoisted(() => ({
  readRuntimeFileContent: vi.fn(),
  getRuntimeGitDiff: vi.fn(),
  getRuntimeGitBranchDiff: vi.fn(),
  readRuntimeJjFileDiff: vi.fn(),
  getConnectionId: vi.fn(),
  getConnectionIdForFile: vi.fn(),
  isWorktreeConnectionResolved: vi.fn(() => true),
  getState: vi.fn()
}))

vi.mock('@/runtime/runtime-file-client', () => ({
  getRuntimeFileReadScope: vi.fn(
    (
      settings: { activeRuntimeEnvironmentId?: string | null } | null | undefined,
      connectionId?: string
    ) => connectionId ?? settings?.activeRuntimeEnvironmentId ?? null
  ),
  readRuntimeFileContent: mocks.readRuntimeFileContent,
  subscribeRuntimeFileChanges: vi.fn()
}))

vi.mock('@/runtime/runtime-git-client', () => ({
  getRuntimeGitBranchDiff: mocks.getRuntimeGitBranchDiff,
  getRuntimeGitCommitDiff: vi.fn(),
  getRuntimeGitDiff: mocks.getRuntimeGitDiff,
  getRuntimeGitScope: vi.fn(() => null)
}))

vi.mock('@/runtime/runtime-jj-client', () => ({
  readRuntimeJjFileDiff: mocks.readRuntimeJjFileDiff
}))

vi.mock('@/lib/connection-context', () => ({
  getConnectionId: mocks.getConnectionId,
  getConnectionIdForFile: mocks.getConnectionIdForFile,
  isWorktreeConnectionResolved: mocks.isWorktreeConnectionResolved
}))

vi.mock('@/lib/runtime-workspace-file-route', () => ({
  findWorkspaceFileRoute: vi.fn(() => null)
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: mocks.getState
  }
}))

import { useEditorPanelContentState } from './useEditorPanelContentState'
import { getDiskBaselineSignature } from './diff-content-signature'
import { ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT } from './editor-autosave'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function dispatchExternalFileChange(file: OpenFile, worktreePath: string): void {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, {
        detail: {
          worktreeId: file.worktreeId,
          worktreePath,
          relativePath: file.relativePath
        }
      })
    )
  })
}

type ProbeProps = {
  activeFile: OpenFile | null
  openFiles: OpenFile[]
  gitStatusByWorktree?: Record<string, GitStatusEntry[]>
}

const authorizeExternalPath = vi.fn()
// Why: opening any liveTail tab arms useLocalLogTail's change subscription.
const onLocalLogTailChanged = vi.fn(() => () => {})
const fsApi = { authorizeExternalPath, onLocalLogTailChanged }
let latestFileContents: Record<string, FileContent> = {}
let latestDiffContents: Record<string, DiffContent> = {}
let latestReloadContent: (file: OpenFile) => void = () => {}
const EMPTY_GIT_STATUS_BY_WORKTREE: Record<string, GitStatusEntry[]> = {}

function HookProbe({
  activeFile,
  openFiles,
  gitStatusByWorktree = EMPTY_GIT_STATUS_BY_WORKTREE
}: ProbeProps): null {
  const state = useEditorPanelContentState({
    activeFile,
    isChangesMode: false,
    openFiles,
    gitStatusEntries: activeFile ? gitStatusByWorktree[activeFile.worktreeId] : undefined,
    editorViewMode: {}
  })
  latestFileContents = state.fileContents
  latestDiffContents = state.diffContents
  latestReloadContent = state.reloadContent
  return null
}

function createOpenFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: '/repo/file.ts',
    filePath: '/repo/file.ts',
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    isDirty: false,
    mode: 'edit',
    ...overrides
  }
}

describe('useEditorPanelContentState', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    latestFileContents = {}
    latestDiffContents = {}
    authorizeExternalPath.mockReset()
    authorizeExternalPath.mockResolvedValue(undefined)
    onLocalLogTailChanged.mockClear()
    ;(window as unknown as { api: unknown }).api = { fs: fsApi }
    mocks.readRuntimeFileContent.mockReset()
    mocks.getRuntimeGitDiff.mockReset()
    mocks.getRuntimeGitBranchDiff.mockReset()
    mocks.readRuntimeJjFileDiff.mockReset()
    mocks.getConnectionId.mockReset()
    mocks.getConnectionId.mockReturnValue(undefined)
    mocks.getConnectionIdForFile.mockReset()
    mocks.getConnectionIdForFile.mockReturnValue(undefined)
    mocks.isWorktreeConnectionResolved.mockReset()
    mocks.isWorktreeConnectionResolved.mockReturnValue(true)
    mocks.getState.mockReset()
    mocks.getState.mockReturnValue({
      settings: null,
      openFiles: [],
      setLastKnownDiskSignature: vi.fn()
    })
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    container = null
    root = null
  })

  it('starts a fresh file read for a forced reload instead of reusing the in-flight read', async () => {
    // A reload nonce on mount makes the lazy-load read and the forced reload
    // fire in the same effect flush, while the first read is still registered
    // in flight. The forced reload must delete that entry and start a new read.
    const activeFile = createOpenFile({ fileContentReloadNonce: 1 })
    const firstRead = createDeferred<FileContent>()
    const secondRead = createDeferred<FileContent>()
    mocks.readRuntimeFileContent
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(2))

    await act(async () => {
      secondRead.resolve({ content: 'fresh content', isBinary: false })
      await secondRead.promise
    })
    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('fresh content'))
  })

  it('ignores an older file read that resolves after a newer forced read', async () => {
    const activeFile = createOpenFile()
    const staleRead = createDeferred<FileContent>()
    const freshRead = createDeferred<FileContent>()
    mocks.readRuntimeFileContent
      .mockReturnValueOnce(staleRead.promise)
      .mockReturnValueOnce(freshRead.promise)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(1))

    dispatchExternalFileChange(activeFile, '/repo')
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(2))

    await act(async () => {
      freshRead.resolve({ content: 'fresh content', isBinary: false })
      await freshRead.promise
    })
    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('fresh content'))

    // The older read resolving last must not clobber the fresh content.
    await act(async () => {
      staleRead.resolve({ content: 'stale content', isBinary: false })
      await staleRead.promise
    })
    expect(latestFileContents[activeFile.id]?.content).toBe('fresh content')
  })

  it('keeps non-tab conflict-review file generations until the load resolves', async () => {
    const activeFile = createOpenFile({
      id: 'wt-1::conflict-review',
      filePath: '/repo',
      relativePath: 'Conflict Review',
      language: 'plaintext',
      mode: 'conflict-review',
      conflictReview: {
        source: 'live-summary',
        snapshotTimestamp: 123,
        entries: [{ path: 'src/conflict.ts', conflictKind: 'both_modified' }]
      }
    })
    const conflictRead = createDeferred<FileContent>()
    mocks.readRuntimeFileContent.mockReturnValueOnce(conflictRead.promise)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <HookProbe
          activeFile={activeFile}
          openFiles={[activeFile]}
          gitStatusByWorktree={{
            'wt-1': [
              {
                path: 'src/conflict.ts',
                status: 'modified',
                area: 'unstaged',
                conflictStatus: 'unresolved',
                conflictKind: 'both_modified'
              }
            ]
          }}
        />
      )
    })
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(1))

    await act(async () => {
      conflictRead.resolve({
        content: '<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> branch',
        isBinary: false
      })
      await conflictRead.promise
    })

    expect(latestFileContents['/repo/src/conflict.ts']?.content).toContain('incoming')
  })

  it('ignores an older file read after closing and reopening the same tab id', async () => {
    const activeFile = createOpenFile()
    const staleRead = createDeferred<FileContent>()
    const freshRead = createDeferred<FileContent>()
    mocks.readRuntimeFileContent
      .mockReturnValueOnce(staleRead.promise)
      .mockReturnValueOnce(freshRead.promise)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(1))

    await act(async () => {
      root?.render(<HookProbe activeFile={null} openFiles={[]} />)
    })
    expect(latestFileContents[activeFile.id]).toBeUndefined()

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(2))

    await act(async () => {
      freshRead.resolve({ content: 'fresh reopen content', isBinary: false })
      await freshRead.promise
    })
    await vi.waitFor(() =>
      expect(latestFileContents[activeFile.id]?.content).toBe('fresh reopen content')
    )

    await act(async () => {
      staleRead.resolve({ content: 'stale pre-close content', isBinary: false })
      await staleRead.promise
    })
    expect(latestFileContents[activeFile.id]?.content).toBe('fresh reopen content')
  })

  it('ignores an older diff read that resolves after a newer forced diff read', async () => {
    const activeFile = createOpenFile({
      id: 'wt-1::diff::unstaged::file.ts',
      mode: 'diff',
      diffSource: 'unstaged'
    })
    const staleDiff = createDeferred<DiffContent>()
    const freshDiff = createDeferred<DiffContent>()
    mocks.getRuntimeGitDiff
      .mockReturnValueOnce(staleDiff.promise)
      .mockReturnValueOnce(freshDiff.promise)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })
    await vi.waitFor(() => expect(mocks.getRuntimeGitDiff).toHaveBeenCalledTimes(1))

    dispatchExternalFileChange(activeFile, '/repo')
    await vi.waitFor(() => expect(mocks.getRuntimeGitDiff).toHaveBeenCalledTimes(2))

    await act(async () => {
      freshDiff.resolve({
        kind: 'text',
        originalContent: 'old',
        modifiedContent: 'fresh diff content',
        originalIsBinary: false,
        modifiedIsBinary: false
      })
      await freshDiff.promise
    })
    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]?.modifiedContent).toBe('fresh diff content')
    )

    await act(async () => {
      staleDiff.resolve({
        kind: 'text',
        originalContent: 'old',
        modifiedContent: 'stale diff content',
        originalIsBinary: false,
        modifiedIsBinary: false
      })
      await staleDiff.promise
    })
    expect(latestDiffContents[activeFile.id]?.modifiedContent).toBe('fresh diff content')
  })

  it('routes reloadContent for a diff tab to a forced diff refetch, not a file read', async () => {
    // Why: the changed-on-disk banner's "Reload from Disk" on an unstaged
    // diff tab must refetch the diff body — routing it to the file store
    // would leave the visible diff stale (and vice versa for edit tabs).
    const activeFile = createOpenFile({
      id: 'wt-1::diff::unstaged::file.ts',
      mode: 'diff',
      diffSource: 'unstaged'
    })
    mocks.getRuntimeGitDiff
      .mockResolvedValueOnce({
        kind: 'text',
        originalContent: 'old',
        modifiedContent: 'first diff content',
        originalIsBinary: false,
        modifiedIsBinary: false
      })
      .mockResolvedValueOnce({
        kind: 'text',
        originalContent: 'old',
        modifiedContent: 'reloaded diff content',
        originalIsBinary: false,
        modifiedIsBinary: false
      })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })
    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]?.modifiedContent).toBe('first diff content')
    )

    await act(async () => {
      latestReloadContent(activeFile)
    })

    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]?.modifiedContent).toBe('reloaded diff content')
    )
    expect(mocks.getRuntimeGitDiff).toHaveBeenCalledTimes(2)
    expect(mocks.readRuntimeFileContent).not.toHaveBeenCalled()
  })

  it('routes reloadContent for an edit tab to a forced file read, not a diff refetch', async () => {
    const activeFile = createOpenFile()
    mocks.readRuntimeFileContent
      .mockResolvedValueOnce({ content: 'old content', isBinary: false })
      .mockResolvedValueOnce({ content: 'reloaded content', isBinary: false })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })
    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('old content'))

    await act(async () => {
      latestReloadContent(activeFile)
    })

    await vi.waitFor(() =>
      expect(latestFileContents[activeFile.id]?.content).toBe('reloaded content')
    )
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(2)
    expect(mocks.getRuntimeGitDiff).not.toHaveBeenCalled()
  })

  it('stamps the disk baseline when a clean tab load resolves', async () => {
    const activeFile = createOpenFile()
    const setLastKnownDiskSignature = vi.fn()
    mocks.getState.mockReturnValue({
      settings: null,
      openFiles: [activeFile],
      setLastKnownDiskSignature
    })
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'disk content', isBinary: false })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() =>
      expect(setLastKnownDiskSignature).toHaveBeenCalledWith(
        activeFile.id,
        getDiskBaselineSignature('disk content')
      )
    )
  })

  it('keeps a dirty tab baseline untouched by content loads', async () => {
    // Why: a dirty tab's draft still derives from the OLD content — moving
    // the baseline on load would hide the conflict its restore check exists
    // to catch.
    const activeFile = createOpenFile({ isDirty: true })
    const setLastKnownDiskSignature = vi.fn()
    mocks.getState.mockReturnValue({
      settings: null,
      openFiles: [activeFile],
      setLastKnownDiskSignature
    })
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'disk content', isBinary: false })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('disk content'))
    expect(setLastKnownDiskSignature).not.toHaveBeenCalled()
  })
})
