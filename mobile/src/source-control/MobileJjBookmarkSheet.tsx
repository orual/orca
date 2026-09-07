import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Bookmark, Plus, MoveRight } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

export type MobileJjBookmark = { name: string; readOnly?: boolean }

type Props = {
  visible: boolean
  bookmarks: MobileJjBookmark[]
  localBookmarks: MobileJjBookmark[]
  busy: boolean
  loading?: boolean
  error?: string | null
  onClose: () => void
  onCreate: (name: string) => void
  onMove: (name: string) => void
}

const styles = {
  title: {
    color: colors.textPrimary,
    fontSize: typography.titleSize,
    fontWeight: '700' as const,
    marginBottom: spacing.md
  },
  label: { color: colors.textSecondary, fontSize: typography.metaSize, marginBottom: spacing.xs },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.input,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle
  },
  copy: { flex: 1, color: colors.textPrimary, fontSize: typography.bodySize },
  detail: { color: colors.textMuted, fontSize: typography.metaSize },
  button: {
    minHeight: 40,
    borderRadius: radii.button,
    backgroundColor: colors.textPrimary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.md
  },
  secondary: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.borderSubtle },
  primaryText: { color: colors.bgBase, fontSize: typography.bodySize, fontWeight: '700' as const },
  secondaryText: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600' as const
  },
  error: { color: colors.statusRed, fontSize: typography.metaSize, marginTop: spacing.sm }
}

export function MobileJjBookmarkSheet({
  visible,
  bookmarks,
  localBookmarks,
  busy,
  loading = false,
  error,
  onClose,
  onCreate,
  onMove
}: Props) {
  const [name, setName] = useState('')
  const submit = () => {
    const trimmed = name.trim()
    if (trimmed && !busy) {
      onCreate(trimmed)
    }
  }
  return (
    <BottomDrawer visible={visible} onClose={onClose} contentScrollable={false}>
      <Text style={styles.title}>
        <Bookmark size={18} color={colors.textSecondary} /> Local bookmarks
      </Text>
      {loading ? (
        <Text style={styles.detail}>Loading local bookmarks…</Text>
      ) : bookmarks.length ? (
        bookmarks.map((bookmark) => (
          <View style={styles.row} key={bookmark.name}>
            <Bookmark size={15} color={colors.textMuted} />
            <Text style={styles.copy}>{bookmark.name}</Text>
            <Text style={styles.detail}>current</Text>
          </View>
        ))
      ) : (
        <Text style={styles.detail}>No bookmark at current change.</Text>
      )}
      <Text style={[styles.label, { marginTop: spacing.lg }]}>Create bookmark</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Bookmark name"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        editable={!busy}
        accessibilityLabel="New local bookmark name"
      />
      <Pressable
        style={styles.button}
        onPress={submit}
        disabled={busy || !name.trim()}
        accessibilityLabel="Create bookmark"
      >
        <Plus size={16} color={colors.bgBase} />
        <Text style={styles.primaryText}>Create bookmark</Text>
      </Pressable>
      <Text style={[styles.label, { marginTop: spacing.lg }]}>Move bookmark to current change</Text>
      {localBookmarks.length ? (
        localBookmarks.map((bookmark) => (
          <Pressable
            key={bookmark.name}
            style={[styles.row, styles.secondary]}
            onPress={() => onMove(bookmark.name)}
            disabled={busy}
            accessibilityLabel={`Move ${bookmark.name} to current`}
          >
            <MoveRight size={15} color={colors.textSecondary} />
            <Text style={styles.copy}>{bookmark.name}</Text>
          </Pressable>
        ))
      ) : (
        <Text style={styles.detail}>No local bookmarks available.</Text>
      )}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </BottomDrawer>
  )
}
