import { Pressable, Text } from 'react-native'
import { Download, Upload } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

export type MobileJjRemote = { name: string; url?: string }
type Props = {
  visible: boolean
  kind: 'fetch' | 'push'
  remotes: MobileJjRemote[]
  bookmarks: { name: string }[]
  selectedRemote: string
  selectedBookmark: string
  busy: boolean
  loading?: boolean
  error?: string | null
  onClose: () => void
  onRemote: (name: string) => void
  onBookmark: (name: string) => void
  onSubmit: () => void
}
const styles = {
  title: {
    color: colors.textPrimary,
    fontSize: typography.titleSize,
    fontWeight: '700' as const,
    marginBottom: spacing.md
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    marginTop: spacing.sm,
    marginBottom: spacing.xs
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    marginBottom: spacing.xs
  },
  selected: { backgroundColor: colors.bgRaised, borderColor: colors.textSecondary },
  text: { flex: 1, color: colors.textPrimary, fontSize: typography.bodySize },
  detail: { color: colors.textMuted, fontSize: typography.metaSize },
  button: {
    minHeight: 42,
    marginTop: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.textPrimary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: spacing.xs
  },
  buttonText: { color: colors.bgBase, fontSize: typography.bodySize, fontWeight: '700' as const },
  error: { color: colors.statusRed, fontSize: typography.metaSize, marginTop: spacing.sm }
}
export function MobileJjRemoteSheet({
  visible,
  kind,
  remotes,
  bookmarks,
  selectedRemote,
  selectedBookmark,
  busy,
  loading = false,
  error,
  onClose,
  onRemote,
  onBookmark,
  onSubmit
}: Props) {
  const ActionIcon = kind === 'fetch' ? Download : Upload
  return (
    <BottomDrawer visible={visible} onClose={onClose} contentScrollable={false}>
      <Text style={styles.title}>
        <ActionIcon size={18} color={colors.textSecondary} />{' '}
        {kind === 'fetch' ? 'Fetch bookmarks' : 'Push bookmark'}
      </Text>
      <Text style={styles.label}>Remote</Text>
      {loading ? (
        <Text style={styles.detail}>Loading remotes…</Text>
      ) : remotes.length ? (
        remotes.map((remote) => (
          <Pressable
            key={remote.name}
            style={[styles.row, selectedRemote === remote.name && styles.selected]}
            onPress={() => onRemote(remote.name)}
            disabled={busy}
            accessibilityLabel={`Select remote ${remote.name}`}
          >
            <Text style={styles.text}>{remote.name}</Text>
            <Text style={styles.detail} numberOfLines={1}>
              {remote.url ?? ''}
            </Text>
          </Pressable>
        ))
      ) : (
        <Text style={styles.detail}>No remotes found.</Text>
      )}
      {kind === 'push' ? (
        <>
          <Text style={styles.label}>Bookmark</Text>
          {bookmarks.map((bookmark) => (
            <Pressable
              key={bookmark.name}
              style={[styles.row, selectedBookmark === bookmark.name && styles.selected]}
              onPress={() => onBookmark(bookmark.name)}
              disabled={busy}
              accessibilityLabel={`Select bookmark ${bookmark.name}`}
            >
              <Text style={styles.text}>{bookmark.name}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
      <Pressable
        style={styles.button}
        onPress={onSubmit}
        disabled={busy || loading || !selectedRemote || (kind === 'push' && !selectedBookmark)}
        accessibilityLabel={kind === 'fetch' ? 'Fetch selected remote' : 'Push selected bookmark'}
      >
        <ActionIcon size={16} color={colors.bgBase} />
        <Text style={styles.buttonText}>{kind === 'fetch' ? 'Fetch' : 'Push'}</Text>
      </Pressable>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </BottomDrawer>
  )
}
