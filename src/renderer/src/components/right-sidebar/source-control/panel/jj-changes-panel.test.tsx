// @vitest-environment happy-dom

import { act } from 'react'
import { fireEvent } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isJjWorkspaceStaleFailure } from '../../../../../../shared/jj-types'
import type { JjCommitResult, JjCurrentChangeMetadata } from '../../../../../../shared/jj-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { JjChangesPanel } from './jj-changes-panel'

const mocks = vi.hoisted(() => ({
  model: null as null | Record<string, unknown>,
  openFile: vi.fn(),
  notifyEditorExternalFileChange: vi.fn(),
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
  confirm: vi.fn().mockResolvedValue(true)
}))

vi.mock('./use-jj-changes-panel-state', () => ({
  useJjChangesPanelState: () => mocks.model
}))
vi.mock('@/store', () => ({
  useAppStore: <T,>(selector: (state: { openFile: typeof mocks.openFile }) => T): T =>
    selector({ openFile: mocks.openFile })
}))
vi.mock('../../../editor/editor-autosave', () => ({
  notifyEditorExternalFileChange: mocks.notifyEditorExternalFileChange
}))
vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => mocks.confirm
}))

beforeEach(() => {
  Object.assign(window, { api: { ui: { writeClipboardText: mocks.writeClipboardText } } })
})

const metadata: JjCurrentChangeMetadata = {
  commitId: 'commit-full-1',
  changeId: 'change-abc',
  description: 'Existing jj description',
  bookmarks: [{ name: 'feature/demo', readOnly: true }],
  conflicted: false,
  workspaceName: 'default'
}

function changes(
  ...paths: string[]
): { path: string; status: 'modified'; stats?: { added: number; removed: number } }[] {
  return paths.map((path) => ({ path, status: 'modified' }))
}

function createModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: { status: 'ready', changes: changes('src/one.ts', 'src/two.ts'), error: null },
    metadata,
    metadataContextKey: 'wt-1::/repo/wt::::',
    metadataStatus: 'ready',
    metadataError: null,
    localBookmarks: [],
    bookmarksStatus: 'ready',
    bookmarksError: null,
    commitError: null,
    isCommitting: false,
    mutationError: null,
    isMutating: false,
    staleRecoveryError: null,
    isRecoveringStaleWorkspace: false,
    canRecoverStaleWorkspace: false,
    recoverStaleWorkspace: vi.fn().mockResolvedValue({ ok: true }),
    context: { worktreeId: 'wt-1', worktreePath: '/repo/wt' },
    contextKey: 'wt-1::/repo/wt::::',
    refresh: vi.fn().mockResolvedValue(undefined),
    readDiff: vi.fn(),
    commit: vi.fn().mockResolvedValue({ ok: true } satisfies JjCommitResult),
    describe: vi.fn().mockResolvedValue({ ok: true }),
    createBookmark: vi.fn().mockResolvedValue({ ok: true }),
    moveBookmark: vi.fn().mockResolvedValue({ ok: true }),
    listRemotes: vi.fn().mockResolvedValue({
      ok: true,
      remotes: [{ name: 'origin', url: 'https://example.test/orca.git' }]
    }),
    fetchRemote: vi.fn().mockResolvedValue({ ok: true }),
    pushBookmark: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.model = createModel()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderPanel(): void {
  act(() => {
    root.render(
      <TooltipProvider>
        <JjChangesPanel worktreeId="wt-1" worktreePath="/repo/wt" />
      </TooltipProvider>
    )
  })
}

function button(label: string): HTMLButtonElement {
  const buttons = [
    ...container.querySelectorAll('button'),
    ...document.body.querySelectorAll('button')
  ]
  const match = buttons.find(
    (entry) =>
      entry.getAttribute('aria-label') === label ||
      (entry.getAttribute('aria-label')?.includes(label) && entry.hasAttribute('data-slot')) ||
      entry.textContent?.includes(label)
  )
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${label}`)
  }
  return match
}

async function openActionMenu(): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(button('More Jujutsu actions'), { button: 0 })
    await Promise.resolve()
  })
}

function menuitem(label: string): HTMLDivElement {
  const items = [...document.body.querySelectorAll('[role="menuitem"]')]
  const match = items.find((entry) => entry.textContent?.includes(label))
  if (!(match instanceof HTMLDivElement)) {
    throw new Error(`Missing menuitem: ${label}`)
  }
  return match
}

function remoteSubmitButton(label: 'Fetch' | 'Push bookmark'): HTMLButtonElement {
  const submit = [...document.body.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === label
  )
  if (!(submit instanceof HTMLButtonElement)) {
    throw new Error(`Missing remote submit button: ${label}`)
  }
  return submit
}

function selectItem(label: string): HTMLDivElement {
  const item = [...document.body.querySelectorAll('[role="option"]')].find((entry) =>
    entry.textContent?.includes(label)
  )
  if (!(item instanceof HTMLDivElement)) {
    throw new Error(`Missing select option: ${label}`)
  }
  return item
}

function textarea(): HTMLTextAreaElement {
  const field = container.querySelector('textarea')
  if (!(field instanceof HTMLTextAreaElement)) {
    throw new Error('Missing description or commit message textarea')
  }
  return field
}

function bookmarkTrigger(): HTMLButtonElement {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Manage local bookmarks"]'
  )
  if (!trigger) {
    throw new Error('Missing bookmark trigger')
  }
  return trigger
}

describe('JjChangesPanel commit surface', () => {
  it('renders per-file diff line counts from the backend change payload', () => {
    mocks.model = createModel({
      state: {
        status: 'ready',
        changes: [{ path: 'src/one.ts', status: 'modified', stats: { added: 2, removed: 1 } }],
        error: null
      }
    })
    renderPanel()

    expect(container.textContent).toContain('+2 -1')
    expect(container.textContent).toContain('one.ts')
    expect(container.textContent).toContain('src')
  })

  it('renders workspace pointer, change ID, description, bookmark, and clean metadata', () => {
    mocks.model = createModel({
      state: { status: 'ready', changes: [], error: null },
      metadata: { ...metadata, conflicted: true }
    })
    renderPanel()

    expect(container.textContent).toContain('default@')
    expect(container.textContent).toContain('Change ID')
    expect(container.textContent).toContain('change-abc')
    expect(container.textContent).toContain('Commit ID')
    expect(container.textContent).toContain('commit-full-')
    expect(container.textContent).not.toContain('commit-full-1')
    expect(container.querySelector('[title="change-abc"]')?.textContent).toBe('change-abc')
    expect(container.querySelector('[title="commit-full-1"]')?.textContent).toBe('commit-full-')
    fireEvent.click(button('Copy Change ID'))
    fireEvent.click(button('Copy Commit ID'))
    expect(mocks.writeClipboardText).toHaveBeenNthCalledWith(1, 'change-abc')
    expect(mocks.writeClipboardText).toHaveBeenNthCalledWith(2, 'commit-full-1')
    expect(textarea().value).toBe('Existing jj description')
    expect(container.textContent).not.toContain('No description')
    expect(container.textContent).not.toContain('Uses the full current commit ID')
    expect(container.textContent).not.toContain('Save description')
    expect(container.querySelector('[title="Read-only bookmark"]')).toBeNull()
    expect(container.textContent).toContain('Conflict')
    expect(container.textContent).toContain('No Jujutsu changes')
  })

  it('dispatches Describe from the shared textarea without automatic mutation on edit', async () => {
    const describe = vi.fn().mockResolvedValue({ ok: true })
    mocks.model = createModel({ describe })
    renderPanel()

    expect(textarea().value).toBe('Existing jj description')
    fireEvent.change(textarea(), { target: { value: 'Updated description' } })
    expect(describe).not.toHaveBeenCalled()

    await act(async () => {
      await openActionMenu()
      menuitem('Describe').click()
      await Promise.resolve()
    })
    expect(describe).toHaveBeenCalledWith({
      expectedCommitId: 'commit-full-1',
      message: 'Updated description'
    })
  })

  it('allows Describe to clear the current description', async () => {
    const describe = vi.fn().mockResolvedValue({ ok: true })
    mocks.model = createModel({ describe })
    renderPanel()

    fireEvent.change(textarea(), { target: { value: '' } })
    await openActionMenu()
    expect(menuitem('Describe').getAttribute('data-disabled')).toBeNull()
    await act(async () => {
      menuitem('Describe').click()
      await Promise.resolve()
    })
    expect(describe).toHaveBeenCalledWith({ expectedCommitId: 'commit-full-1', message: '' })
  })

  it('retains the description while current workspace metadata is unavailable', () => {
    renderPanel()
    expect(textarea().value).toBe('Existing jj description')

    mocks.model = createModel({ metadata: null, metadataStatus: 'loading' })
    renderPanel()
    expect(textarea().value).toBe('Existing jj description')

    mocks.model = createModel({
      metadata: { ...metadata, description: 'Refreshed description' }
    })
    renderPanel()
    expect(textarea().value).toBe('Refreshed description')
  })

  it('preserves a dirty description draft when polled metadata changes', () => {
    renderPanel()
    fireEvent.change(textarea(), { target: { value: 'Keep this draft' } })

    mocks.model = createModel({
      metadata: { ...metadata, description: 'Updated by jj poll' }
    })
    renderPanel()

    expect(textarea().value).toBe('Keep this draft')
  })

  it('fetches only the explicitly selected remote from the split menu', async () => {
    const fetchRemote = vi.fn().mockResolvedValue({ ok: true })
    const listRemotes = vi.fn().mockResolvedValue({
      ok: true,
      remotes: [
        { name: 'origin', url: 'https://example.test/orca.git' },
        { name: 'upstream', url: 'https://example.test/upstream.git' }
      ]
    })
    mocks.model = createModel({ listRemotes, fetchRemote })
    renderPanel()

    await openActionMenu()
    await act(async () => {
      menuitem('Fetch bookmarks').click()
      await Promise.resolve()
    })
    expect(await Promise.resolve(document.body.textContent)).toContain('Choose one remote to fetch')
    expect(remoteSubmitButton('Fetch').disabled).toBe(true)

    fireEvent.click(button('Remote'))
    await act(async () => {})
    selectItem('upstream').click()
    await act(async () => {})
    expect(remoteSubmitButton('Fetch').disabled).toBe(false)
    remoteSubmitButton('Fetch').click()
    await act(async () => {})

    expect(fetchRemote).toHaveBeenCalledWith({ remote: 'upstream' })
    expect(fetchRemote).not.toHaveBeenCalledWith({ remote: 'origin' })
  })

  it('requires explicit remote and bookmark selection plus confirmation before push', async () => {
    const pushBookmark = vi.fn().mockResolvedValue({ ok: true })
    const listRemotes = vi.fn().mockResolvedValue({
      ok: true,
      remotes: [{ name: 'origin', url: 'https://example.test/orca.git' }]
    })
    mocks.model = createModel({
      localBookmarks: [{ name: 'feature/demo', commitId: 'commit-full-1' }],
      listRemotes,
      pushBookmark
    })
    renderPanel()

    await openActionMenu()
    await act(async () => {
      menuitem('Push bookmark').click()
      await Promise.resolve()
    })
    expect(remoteSubmitButton('Push bookmark').disabled).toBe(true)

    fireEvent.click(button('Remote'))
    await act(async () => {})
    selectItem('origin').click()
    await act(async () => {})
    expect(remoteSubmitButton('Push bookmark').disabled).toBe(true)

    fireEvent.click(button('Bookmark'))
    await act(async () => {})
    selectItem('feature/demo').click()
    await act(async () => {})
    remoteSubmitButton('Push bookmark').click()
    await act(async () => {})

    expect(mocks.confirm).toHaveBeenCalledWith({
      title: 'Push bookmark?',
      description: 'Push the exact bookmark "feature/demo" to remote "origin"?',
      confirmLabel: 'Push'
    })
    expect(pushBookmark).toHaveBeenCalledWith({ remote: 'origin', bookmark: 'feature/demo' })
  })

  it('does not replay a remote operation after an uncertain outcome', async () => {
    const uncertain = {
      ok: false,
      kind: 'uncertain',
      uncertain: true,
      message: 'The host disconnected after jj fetch started.'
    }
    const fetchRemote = vi.fn().mockResolvedValue(uncertain)
    const listRemotes = vi.fn().mockResolvedValue({
      ok: true,
      remotes: [{ name: 'origin', url: 'https://example.test/orca.git' }]
    })
    mocks.model = createModel({ listRemotes, fetchRemote })
    renderPanel()

    await openActionMenu()
    await act(async () => {
      menuitem('Fetch bookmarks').click()
      await Promise.resolve()
    })
    fireEvent.click(button('Remote'))
    await act(async () => {})
    selectItem('origin').click()
    await act(async () => {})
    remoteSubmitButton('Fetch').click()
    await act(async () => {})
    expect(fetchRemote).toHaveBeenCalledOnce()
    mocks.model = createModel({
      listRemotes,
      fetchRemote,
      remoteError: uncertain
    })
    renderPanel()

    await openActionMenu()
    expect(menuitem('Fetch bookmarks').hasAttribute('data-disabled')).toBe(true)
    expect(container.textContent).not.toContain('Remote operation outcome uncertain')
  })

  it('opens pointer-adjacent bookmark controls and dispatches create and move', async () => {
    const createBookmark = vi.fn().mockResolvedValue({ ok: true })
    const moveBookmark = vi.fn().mockResolvedValue({ ok: true })
    mocks.model = createModel({
      createBookmark,
      moveBookmark,
      localBookmarks: [{ name: 'feature/demo', commitId: 'other-commit' }]
    })
    renderPanel()

    expect(bookmarkTrigger().parentElement?.textContent).toContain('default@')
    expect(container.querySelector('[title="Read-only bookmark"]')).toBeNull()
    fireEvent.click(bookmarkTrigger())
    expect(document.body.textContent).toContain('Local bookmarks')

    const nameInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="New local bookmark name"]'
    )
    expect(nameInput).not.toBeNull()
    fireEvent.change(nameInput!, { target: { value: 'feature/new' } })
    await act(async () => {
      button('Create bookmark').click()
      await Promise.resolve()
    })
    expect(createBookmark).toHaveBeenCalledWith({
      expectedCommitId: 'commit-full-1',
      name: 'feature/new'
    })

    const moveSelect = document.body.querySelector<HTMLButtonElement>(
      '[data-slot="select-trigger"]'
    )
    expect(moveSelect).not.toBeNull()
    expect(moveSelect?.textContent).toContain('feature/demo')
    await act(async () => {
      button('Move to current').click()
      await Promise.resolve()
    })
    expect(moveBookmark).toHaveBeenCalledWith({
      expectedCommitId: 'commit-full-1',
      name: 'feature/demo'
    })
  })

  it('keeps all and selected intents distinct and reports explorer reload paths after success', async () => {
    const commit = vi.fn().mockResolvedValue({ ok: true } satisfies JjCommitResult)
    mocks.model = createModel({ commit })
    renderPanel()

    const checks = [...container.querySelectorAll('[data-slot="checkbox"]')]
    expect(checks).toHaveLength(2)
    act(() => {
      if (checks[0]) {
        fireEvent.click(checks[0])
      }
      fireEvent.change(textarea(), { target: { value: 'typed message' } })
    })
    await act(async () => {
      await openActionMenu()
      menuitem('Commit selected').click()
      await Promise.resolve()
    })

    expect(commit).toHaveBeenCalledWith({
      expectedCommitId: 'commit-full-1',
      message: 'typed message',
      intent: { kind: 'selected', paths: ['src/one.ts'] }
    })
    expect(mocks.notifyEditorExternalFileChange).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      worktreePath: '/repo/wt',
      relativePath: 'src/one.ts'
    })

    commit.mockClear()
    await act(async () => {
      button('Commit all').click()
      await Promise.resolve()
    })
    expect(commit).toHaveBeenCalledWith({
      expectedCommitId: 'commit-full-1',
      message: 'typed message',
      intent: { kind: 'all' }
    })
    expect(mocks.notifyEditorExternalFileChange).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      worktreePath: '/repo/wt',
      relativePath: 'src/two.ts'
    })
  })

  it('offers one routed workspace update only for the exact stale working-copy error', async () => {
    const recoverStaleWorkspace = vi.fn().mockResolvedValue({ ok: true })
    const staleFailure = {
      kind: 'stale' as const,
      message:
        'Error: The working copy is stale (not updated since operation 838e6b416165). Hint: Run `jj workspace update-stale` to update it. See https://docs.jj-vcs.dev/latest/working-copy/#stale-working-copy for more information.'
    }
    mocks.model = createModel({
      state: {
        status: 'error',
        changes: [],
        kind: staleFailure.kind,
        error: staleFailure.message
      },
      metadataStatus: 'error',
      metadataError: null,
      metadata: null,
      canRecoverStaleWorkspace: isJjWorkspaceStaleFailure(staleFailure),
      recoverStaleWorkspace
    })
    renderPanel()
    expect(container.textContent).toContain('Sync the recorded workspace state')
    expect(button('Update workspace').disabled).toBe(false)
    expect(container.textContent).not.toContain('Retry')

    await act(async () => {
      button('Update workspace').click()
      await Promise.resolve()
    })
    expect(recoverStaleWorkspace).toHaveBeenCalledOnce()

    mocks.model = createModel({
      state: {
        status: 'error',
        changes: [],
        kind: 'stale',
        error: 'There is no jj repo in the current directory.'
      },
      metadataStatus: 'error',
      metadataError: 'There is no jj repo in the current directory.'
    })
    renderPanel()
    expect(container.textContent).toContain('Retry')
    expect(container.textContent).not.toContain('Update workspace')
  })

  it('disables commit while workspace recovery is uncertain', () => {
    const recoverStaleWorkspace = vi.fn()
    mocks.model = createModel({
      canRecoverStaleWorkspace: true,
      staleRecoveryError: {
        ok: false,
        kind: 'uncertain',
        uncertain: true,
        message: 'The host disconnected after update-stale started.'
      },
      recoverStaleWorkspace
    })
    renderPanel()
    expect(button('Commit all').disabled).toBe(true)
    expect(container.textContent).toContain('Workspace update outcome uncertain')
    expect(container.textContent).toContain('Reconcile the workspace before committing again.')
  })

  it('retains typed draft on ordinary and uncertain failures without replaying uncertain commit', async () => {
    const ordinaryFailure = {
      ok: false,
      kind: 'error',
      message: 'jj rejected the commit'
    } satisfies JjCommitResult
    const uncertainFailure = {
      ok: false,
      kind: 'uncertain',
      uncertain: true,
      message: 'The host disconnected after jj commit started.'
    } satisfies JjCommitResult
    const commit = vi
      .fn()
      .mockResolvedValueOnce(ordinaryFailure)
      .mockResolvedValueOnce(uncertainFailure)
    mocks.model = createModel({ commit })
    renderPanel()

    act(() => {
      fireEvent.change(textarea(), { target: { value: 'keep this draft' } })
    })
    await act(async () => {
      button('Commit all').click()
      await Promise.resolve()
    })
    mocks.model = createModel({ commit, commitError: ordinaryFailure })
    renderPanel()
    expect(textarea().value).toBe('keep this draft')
    expect(container.textContent).toContain('jj rejected the commit')

    await act(async () => {
      button('Commit all').click()
      await Promise.resolve()
    })
    mocks.model = createModel({ commit, commitError: uncertainFailure })
    renderPanel()
    expect(textarea().value).toBe('keep this draft')
    expect(container.textContent).toContain('Commit outcome uncertain')
    expect(container.textContent).toContain('Reconcile the workspace before committing again.')
    expect(button('Commit all').disabled).toBe(true)
    await act(async () => {
      button('Commit all').click()
      await Promise.resolve()
    })
    expect(commit).toHaveBeenCalledTimes(2)
  })
})
