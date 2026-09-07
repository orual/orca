import { Pressable, ScrollView, Text, View } from 'react-native'
import type {
  JjChange,
  JjCurrentChangeMetadata,
  JjFileDiffResult
} from '../../../src/shared/jj-types'
import { FileReader } from '../session/MobileSessionFileReader'
import { buildMobileDiffLines } from '../session/mobile-diff-lines'
import { mobileDiffImageDataUri } from '../files/mobile-diff-image-preview'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { MobileJjComposer } from './MobileJjComposer'
import { MobileJjFileRow } from './MobileJjFileRow'

const styles = {
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
  card: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  row: { flexDirection: 'row' as const, gap: spacing.sm },
  button: {
    flex: 1,
    minHeight: 40,
    borderRadius: radii.button,
    backgroundColor: colors.textPrimary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm
  },
  secondary: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.borderSubtle },
  title: { color: colors.textPrimary, fontSize: typography.titleSize, fontWeight: '700' as const },
  detail: { color: colors.textSecondary, fontSize: typography.metaSize },
  diffViewer: { minHeight: 280, overflow: 'hidden' as const },
  secondaryText: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600' as const
  },
  error: { color: colors.statusRed, fontSize: typography.metaSize, marginBottom: spacing.sm }
}

type Props = {
  metadata: JjCurrentChangeMetadata | null
  changes: JjChange[]
  selectedPaths: readonly string[]
  selectableParents: string[]
  parentRevision?: string
  diff: Extract<JjFileDiffResult, { ok: true }> | null
  message: string
  selectedCount: number
  busy: boolean
  uncertain: boolean
  mutationError?: string | null
  diffError?: string
  onMessageChange: (message: string) => void
  onCommit: (kind: 'all' | 'selected') => void
  onOpenActions: () => void
  onTogglePath: (path: string) => void
  onOpenDiff: (path: string) => void
  onSelectParent: (parent: string) => void
}

function diffDocument(
  result: Extract<JjFileDiffResult, { ok: true }>
): Parameters<typeof FileReader>[0]['doc'] {
  if (result.diff.kind === 'text') {
    const diff = buildMobileDiffLines(result.diff.originalContent, result.diff.modifiedContent)
    return { status: 'ready', kind: 'diff', lines: diff.lines, truncated: diff.truncated }
  }
  const dataUri = mobileDiffImageDataUri(result.diff)
  return dataUri
    ? { status: 'ready', kind: 'image', dataUri }
    : { status: 'error', message: 'Binary diff preview unavailable' }
}

export function MobileJjWorkspaceContent({
  metadata,
  changes,
  selectedPaths,
  selectableParents,
  parentRevision,
  diff,
  message,
  selectedCount,
  busy,
  uncertain,
  mutationError,
  diffError,
  onMessageChange,
  onCommit,
  onOpenActions,
  onTogglePath,
  onOpenDiff,
  onSelectParent
}: Props) {
  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title} numberOfLines={2}>
          {metadata?.description || 'Unnamed change'}
        </Text>
        <Text style={styles.detail}>
          Change {metadata?.changeId} · Commit {metadata?.commitId.slice(0, 12)}
        </Text>
        {metadata?.workspaceName ? (
          <Text style={styles.detail}>Workspace: {metadata.workspaceName}</Text>
        ) : null}
        {metadata?.bookmarks.length ? (
          <Text style={styles.detail}>
            Read-only bookmarks: {metadata.bookmarks.map((bookmark) => bookmark.name).join(', ')}
          </Text>
        ) : null}
        {metadata?.conflicted ? (
          <Text style={styles.error}>Conflicts need resolution before commit.</Text>
        ) : null}
      </View>
      <MobileJjComposer
        message={message}
        changeCount={changes.length}
        selectedCount={selectedCount}
        busy={busy}
        uncertain={uncertain}
        error={mutationError}
        onChange={onMessageChange}
        onCommit={() => onCommit('all')}
        onOpenActions={onOpenActions}
      />
      <View style={styles.card}>
        <Text style={styles.title}>Changed files ({changes.length})</Text>
        {changes.length === 0 ? (
          <Text style={styles.detail}>No local changes.</Text>
        ) : (
          changes.map((change) => (
            <MobileJjFileRow
              key={`${change.path}:${change.originalPath ?? ''}`}
              change={change}
              selected={selectedPaths.includes(change.path)}
              busy={busy || uncertain}
              onToggle={() => onTogglePath(change.path)}
              onOpen={() => onOpenDiff(change.path)}
            />
          ))
        )}
      </View>
      {diff ? (
        <View style={styles.card}>
          <Text style={styles.title} numberOfLines={1}>
            {diff.path}
          </Text>
          {selectableParents.length > 1 ? (
            <View style={styles.row}>
              {selectableParents.map((parent) => (
                <Pressable
                  key={parent}
                  style={[styles.button, styles.secondary]}
                  onPress={() => onSelectParent(parent)}
                  accessibilityLabel={`Select ${parent}`}
                >
                  <Text style={styles.secondaryText}>{parent.slice(0, 8)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={styles.detail}>
            {parentRevision ? `Compared with ${parentRevision}` : 'Current change versus parent(s)'}
          </Text>
          <Text style={styles.detail}>
            {diff.diff.kind === 'text'
              ? `${diff.diff.originalContent.length + diff.diff.modifiedContent.length} characters shown below`
              : 'Binary diff'}
          </Text>
          <View style={styles.diffViewer}>
            <FileReader doc={diffDocument(diff)} title={diff.path} relativePath={diff.path} />
          </View>
        </View>
      ) : null}
      {diffError ? <Text style={styles.error}>{diffError}</Text> : null}
    </ScrollView>
  )
}
