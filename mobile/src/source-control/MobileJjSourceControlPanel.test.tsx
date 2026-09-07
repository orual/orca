import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  JjChange,
  JjCurrentChangeMetadata,
  JjFileDiffResult
} from '../../../src/shared/jj-types'
import type { MobileJjSourceControlState } from './use-mobile-jj-source-control-state'
import { MobileJjSourceControlPanel } from './MobileJjSourceControlPanel'
import { FileReader } from '../session/MobileSessionFileReader'

const mocks = vi.hoisted(() => ({
  state: null as MobileJjSourceControlState | null,
  back: vi.fn()
}))

vi.mock('./use-mobile-jj-source-control-state', () => ({
  useMobileJjSourceControlState: () => mocks.state
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: mocks.back }) }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  RefreshCw: 'RefreshCw',
  RotateCcw: 'RotateCcw',
  ActivityIndicator: 'ActivityIndicator',
  Copy: 'Copy',
  MessageSquare: 'MessageSquare',
  Send: 'Send',
  Plus: 'Plus',
  X: 'X',
  Bookmark: 'Bookmark',
  MoveRight: 'MoveRight',
  Download: 'Download',
  Upload: 'Upload',
  MoreHorizontal: 'MoreHorizontal',
  Edit3: 'Edit3',
  Trash2: 'Trash2'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({
    visible,
    children,
    onClose
  }: {
    visible: boolean
    children: unknown
    onClose?: () => void
  }) => (visible ? createElement('BottomDrawer', { onClose }, children) : null)
}))
vi.mock('../components/ConfirmModal', () => ({
  ConfirmModal: ({
    visible,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel
  }: {
    visible: boolean
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    onConfirm: () => void
    onCancel: () => void
  }) =>
    visible
      ? createElement(
          'ConfirmModal',
          { title, message },
          createElement(
            'Pressable',
            { accessibilityLabel: cancelLabel, onPress: onCancel },
            cancelLabel
          ),
          createElement(
            'Pressable',
            { accessibilityLabel: confirmLabel, onPress: onConfirm },
            confirmLabel
          )
        )
      : null
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Platform: {
    OS: 'web',
    select: (values: { web?: unknown; default?: unknown }) => values.web ?? values.default
  },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }))

const metadata: JjCurrentChangeMetadata = {
  commitId: 'commit-full-123456789',
  changeId: 'change-abc',
  description: 'Draft change description',
  bookmarks: [{ name: 'feature/demo', readOnly: true }],
  conflicted: true,
  workspaceName: 'workspace-one'
}
const changes: JjChange[] = [
  { path: 'src/one.ts', status: 'modified', stats: { added: 2, removed: 1 } },
  { path: 'src/two.ts', status: 'added', stats: { added: 4, removed: 0 } }
]
const textDiff = (originalContent: string, modifiedContent: string) => ({
  kind: 'text' as const,
  originalContent,
  modifiedContent,
  originalIsBinary: false as const,
  modifiedIsBinary: false as const
})
function readyDiff(path = 'src/one.ts'): Extract<JjFileDiffResult, { ok: true }> {
  return {
    ok: true,
    path,
    change: changes[0] ?? null,
    diff: textDiff('old line\n', 'new visible line\n'),
    parentDiffs: [
      { parentRevision: 'parent-left', diff: textDiff('left\n', 'new visible line\n') },
      { parentRevision: 'parent-right', diff: textDiff('right\n', 'new visible line\n') }
    ],
    comparison: 'current-change-vs-parents'
  }
}
function baseState(
  overrides: Partial<MobileJjSourceControlState> = {}
): MobileJjSourceControlState {
  return {
    client: null,
    localBookmarks: [{ name: 'feature/demo', commitId: 'commit-full-123456789', isRemote: false }],
    remotes: [{ name: 'origin', url: 'https://example.test/repo' }],
    metadataError: null,
    localBookmarksError: null,
    remoteError: null,
    listLocalBookmarks: vi
      .fn()
      .mockResolvedValue({ ok: true, bookmarks: [{ name: 'feature/demo' }] }),
    describe: vi.fn().mockResolvedValue({ ok: true }),
    createBookmark: vi.fn().mockResolvedValue({ ok: true }),
    moveBookmark: vi.fn().mockResolvedValue({ ok: true }),
    listRemotes: vi.fn().mockResolvedValue({
      ok: true,
      remotes: [{ name: 'origin', url: 'https://example.test/repo' }]
    }),
    fetchRemote: vi.fn().mockResolvedValue({ ok: true }),
    pushBookmark: vi.fn().mockResolvedValue({ ok: true }),
    connState: 'connected',
    forceReconnect: vi.fn(),
    screenState: { kind: 'ready', changes, metadata },
    diffState: { kind: 'idle' },
    busyAction: null,
    selectedPaths: [],
    setSelectedPaths: vi.fn(),
    commitMessage: '',
    setCommitMessage: vi.fn(),
    refresh: vi.fn().mockResolvedValue(true),
    readDiff: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ ok: true }),
    updateStale: vi.fn().mockResolvedValue({ ok: true }),
    mutationUncertain: false,
    mutationError: null,
    ...overrides
  }
}

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.clearAllMocks()
  mocks.state = baseState()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

async function render(): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(
      createElement(MobileJjSourceControlPanel, {
        hostId: 'host-1',
        worktreeId: 'wt-1',
        name: 'Mobile workspace'
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
  return renderer as ReactTestRenderer
}
function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}
function pressable(label: string): ReactTestInstance {
  const node = renderer?.root.findAll(
    (entry) => entry.type === 'Pressable' && entry.props.accessibilityLabel === label
  )[0]
  if (!node) {
    throw new Error(`Missing pressable ${label}`)
  }
  return node
}
function button(text: string): ReactTestInstance {
  const node = renderer?.root.findAll(
    (entry) => entry.type === 'Pressable' && textContent(entry).includes(text)
  )[0]
  if (!node) {
    throw new Error(`Missing button ${text}`)
  }
  return node
}
function updateState(next: Partial<MobileJjSourceControlState>) {
  mocks.state = baseState({ ...mocks.state, ...next })
  act(() => {
    renderer?.update(
      createElement(MobileJjSourceControlPanel, {
        hostId: 'host-1',
        worktreeId: 'wt-1',
        name: 'Mobile workspace'
      })
    )
  })
}

describe('MobileJjSourceControlPanel', () => {
  it('renders jj metadata, read-only bookmarks, conflict state, and file stats', async () => {
    await render()
    const tree = textContent(renderer!.root)
    expect(tree).toContain('Draft change description')
    expect(tree).toContain('Change change-abc · Commit commit-full-')
    expect(tree).toContain('Workspace: workspace-one')
    expect(tree).toContain('Read-only bookmarks: feature/demo')
    expect(tree).toContain('Conflicts need resolution before commit.')
    expect(tree).toContain('Changed files (2)')
    expect(tree).toContain('+2 -1')
  })

  it('keeps Commit All primary and dispatches every other jj action from the picker', async () => {
    const commit = vi.fn().mockResolvedValue({ ok: true })
    const describe = vi.fn().mockResolvedValue({ ok: true })
    const fetchRemote = vi.fn().mockResolvedValue({ ok: true })
    const pushBookmark = vi.fn().mockResolvedValue({ ok: true })
    mocks.state = baseState({
      commit,
      describe,
      fetchRemote,
      pushBookmark,
      commitMessage: 'save draft',
      selectedPaths: ['src/one.ts']
    })
    await render()
    expect(
      renderer!.root.findAll(
        (entry) => entry.type === 'Pressable' && textContent(entry).includes('Commit Selected')
      )
    ).toHaveLength(0)
    expect(
      renderer!.root.findAll(
        (entry) => entry.type === 'Pressable' && textContent(entry).includes('Fetch')
      )
    ).toHaveLength(0)
    expect(
      renderer!.root.findAll(
        (entry) => entry.type === 'Pressable' && textContent(entry).includes('Push')
      )
    ).toHaveLength(0)
    await act(async () => {
      pressable('Commit all jj changes').props.onPress()
      await Promise.resolve()
    })
    expect(commit).toHaveBeenCalledWith({ kind: 'all' })
    await act(async () => {
      pressable('Open jj source control actions').props.onPress()
    })
    expect(textContent(renderer!.root)).toContain('Commit Selected')
    expect(textContent(renderer!.root)).toContain('Describe')
    expect(textContent(renderer!.root)).toContain('Fetch')
    expect(textContent(renderer!.root)).toContain('Push')
    const action = (label: string) =>
      renderer!.root
        .findAll((entry) => entry.type === 'Pressable' && textContent(entry).includes(label))
        .at(-1)!
    await act(async () => {
      action('Commit Selected').props.onPress()
      await Promise.resolve()
    })
    expect(commit).toHaveBeenCalledWith({ kind: 'selected', paths: ['src/one.ts'] })
    await act(async () => {
      pressable('Open jj source control actions').props.onPress()
    })
    await act(async () => {
      action('Describe').props.onPress()
      await Promise.resolve()
    })
    expect(describe).toHaveBeenCalledWith('save draft')
  })

  it('renders the composer before files and describes the current draft', async () => {
    const describe = vi.fn().mockResolvedValue({ ok: true })
    mocks.state = baseState({ commitMessage: 'draft text', describe })
    await render()
    const tree = textContent(renderer!.root)
    expect(tree.indexOf('Description or commit message')).toBeLessThan(
      tree.indexOf('Changed files')
    )
    await act(async () => {
      pressable('Open jj source control actions').props.onPress()
    })
    await act(async () => {
      renderer!.root
        .findAll((entry) => entry.type === 'Pressable' && textContent(entry).includes('Describe'))
        .at(-1)
        ?.props.onPress()
      await Promise.resolve()
    })
    expect(describe).toHaveBeenCalledWith('draft text')
  })

  it('disables commit and describe actions for an old host', async () => {
    mocks.state = baseState({
      screenState: { kind: 'unavailable', message: 'Update Orca desktop' }
    })
    await render()
    expect(textContent(renderer!.root)).toContain('Update Orca desktop')
    expect(
      renderer!.root.findAll(
        (entry) =>
          entry.type === 'Pressable' && entry.props.accessibilityLabel === 'Commit all jj changes'
      )
    ).toHaveLength(0)
  })

  it('confirms bookmark create and move with exact names, and cancel does not mutate', async () => {
    const createBookmark = vi.fn().mockResolvedValue({ ok: true })
    const moveBookmark = vi.fn().mockResolvedValue({ ok: true })
    mocks.state = baseState({ createBookmark, moveBookmark })
    await render()
    await act(async () => {
      pressable('Manage local bookmarks').props.onPress()
      await Promise.resolve()
    })
    const input = renderer!.root
      .findAllByType('TextInput')
      .find((entry) => entry.props.accessibilityLabel === 'New local bookmark name')
    await act(async () => {
      input?.props.onChangeText('release/name')
    })
    await act(async () => {
      pressable('Create bookmark').props.onPress()
    })
    expect(createBookmark).not.toHaveBeenCalled()
    const createConfirmation = renderer!.root.findByType('ConfirmModal')
    expect(createConfirmation.props).toMatchObject({
      title: 'Create local bookmark?',
      message: 'Create "release/name" at the current change?'
    })
    await act(async () => {
      pressable('Create').props.onPress()
      await Promise.resolve()
    })
    expect(createBookmark).toHaveBeenCalledWith('release/name')
    await act(async () => {
      pressable('Move feature/demo to current').props.onPress()
    })
    const moveConfirmation = renderer!.root.findByType('ConfirmModal')
    expect(moveConfirmation.props).toMatchObject({
      title: 'Move local bookmark?',
      message: 'Move "feature/demo" to the current change? jj will refuse a non-forward move.'
    })
    await act(async () => {
      button('Cancel').props.onPress()
    })
    expect(moveBookmark).not.toHaveBeenCalled()
  })

  it('fetches selected remote and pushes exact bookmark only after confirmation', async () => {
    const fetchRemote = vi.fn().mockResolvedValue({ ok: true })
    const pushBookmark = vi.fn().mockResolvedValue({ ok: true })
    mocks.state = baseState({ fetchRemote, pushBookmark })
    await render()
    await act(async () => {
      pressable('Open jj source control actions').props.onPress()
    })
    await act(async () => {
      renderer!.root
        .findAll((entry) => entry.type === 'Pressable' && textContent(entry).includes('Fetch'))
        .at(-1)
        ?.props.onPress()
      await Promise.resolve()
    })
    await act(async () => {
      pressable('Select remote origin').props.onPress()
    })
    await act(async () => {
      pressable('Fetch selected remote').props.onPress()
      await Promise.resolve()
    })
    expect(fetchRemote).toHaveBeenCalledWith('origin')
    await act(async () => {
      pressable('Open jj source control actions').props.onPress()
    })
    await act(async () => {
      renderer!.root
        .findAll((entry) => entry.type === 'Pressable' && textContent(entry).includes('Push'))
        .at(-1)
        ?.props.onPress()
      await Promise.resolve()
    })
    await act(async () => {
      pressable('Select remote origin').props.onPress()
    })
    await act(async () => {
      pressable('Select bookmark feature/demo').props.onPress()
    })
    await act(async () => {
      pressable('Push selected bookmark').props.onPress()
    })
    expect(pushBookmark).not.toHaveBeenCalled()
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      const pushes = renderer!.root.findAll(
        (entry) => entry.type === 'Pressable' && textContent(entry).includes('Push')
      )
      pushes.at(-1)?.props.onPress()
      await Promise.resolve()
    })
    expect(pushBookmark).toHaveBeenCalledWith('origin', 'feature/demo')
  })

  it('selects a path through the rendered checkbox and uses the selected commit action', async () => {
    const setSelectedPaths = vi.fn()
    mocks.state = baseState({ setSelectedPaths, commitMessage: 'save', selectedPaths: [] })
    await render()
    await act(async () => {
      pressable('Select src/one.ts for commit').props.onPress()
    })
    expect(setSelectedPaths).toHaveBeenCalledWith(['src/one.ts'])

    updateState({ selectedPaths: ['src/one.ts'] })
    await act(async () => {
      pressable('Select src/one.ts for commit').props.onPress()
    })
    expect(setSelectedPaths).toHaveBeenLastCalledWith([])
  })

  it('renders actual diff content and switches merge parents with parent-aware reads', async () => {
    const readDiff = vi.fn().mockResolvedValue(undefined)
    mocks.state = baseState({
      readDiff,
      diffState: { kind: 'ready', path: 'src/one.ts', result: readyDiff() }
    })
    await render()
    const fileReader = renderer!.root.findByType(FileReader)
    expect(fileReader.props.doc).toMatchObject({
      status: 'ready',
      kind: 'diff',
      lines: expect.arrayContaining([
        expect.objectContaining({ kind: 'add', text: 'new visible line' }),
        expect.objectContaining({ kind: 'delete', text: 'old line' })
      ])
    })
    await act(async () => {
      button('parent-r').props.onPress()
      await Promise.resolve()
    })
    expect(readDiff).toHaveBeenCalledWith('src/one.ts', 'parent-right')
    expect(textContent(renderer!.root)).toContain('Compared with parent-right')
  })

  it('recovers a stale workspace and renders recovery errors', async () => {
    const updateStale = vi.fn().mockResolvedValue({ ok: true })
    mocks.state = baseState({
      screenState: { kind: 'stale', message: 'Working copy is stale' },
      updateStale
    })
    await render()
    expect(textContent(renderer!.root)).toContain('Working Copy Is Stale')
    await act(async () => {
      button('Update Stale Workspace').props.onPress()
      await Promise.resolve()
    })
    expect(updateStale).toHaveBeenCalledOnce()

    updateState({
      screenState: { kind: 'stale', message: 'Working copy is stale' },
      mutationError: 'Workspace update rejected'
    })
    expect(textContent(renderer!.root)).toContain('Workspace update rejected')
  })

  it('renders unavailable and diff errors with retry and back navigation', async () => {
    const refresh = vi.fn().mockResolvedValue(true)
    mocks.state = baseState({
      screenState: { kind: 'error', message: 'jj method unavailable' },
      refresh
    })
    await render()
    expect(textContent(renderer!.root)).toContain('Unable to Load jj Workspace')
    await act(async () => {
      button('Retry').props.onPress()
      await Promise.resolve()
    })
    expect(refresh).toHaveBeenCalledOnce()

    updateState({
      screenState: { kind: 'ready', changes, metadata },
      diffState: { kind: 'error', path: 'src/one.ts', message: 'Diff unavailable' },
      mutationError: 'Commit rejected'
    })
    expect(textContent(renderer!.root)).toContain('Diff unavailable')
    expect(textContent(renderer!.root)).toContain('Commit rejected')

    updateState({ mutationError: 'Commit may have succeeded', mutationUncertain: true })
    expect(textContent(renderer!.root)).toContain(
      'Commit outcome is uncertain. Refresh before trying again.'
    )
    expect(textContent(renderer!.root)).not.toContain('Commit may have succeeded')

    await act(async () => {
      pressable('Back to session').props.onPress()
    })
    expect(mocks.back).toHaveBeenCalledOnce()
  })
})
