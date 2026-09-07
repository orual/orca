import { Pressable, Text, View } from 'react-native'
import { Bookmark, ChevronLeft, RefreshCw } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

type Props = {
  name: string
  worktreeId: string
  workspaceName?: string
  busy: boolean
  onBack: () => void
  onRefresh: () => void
  onManageBookmarks: () => void
}
const styles = {
  header: {
    minHeight: 58,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.bgPanel,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radii.button,
    alignItems: 'center' as const,
    justifyContent: 'center' as const
  },
  block: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: typography.titleSize, fontWeight: '700' as const },
  meta: { color: colors.textSecondary, fontSize: typography.metaSize, marginTop: 2 }
}
export function MobileJjSourceControlHeader({
  name,
  worktreeId,
  workspaceName,
  busy,
  onBack,
  onRefresh,
  onManageBookmarks
}: Props) {
  return (
    <View style={styles.header}>
      <Pressable style={styles.icon} onPress={onBack} accessibilityLabel="Back to session">
        <ChevronLeft size={22} color={colors.textSecondary} />
      </Pressable>
      <View style={styles.block}>
        <Text style={styles.title}>{workspaceName ? `${workspaceName}@` : 'Source Control'}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {name || worktreeId}
        </Text>
      </View>
      <Pressable
        style={styles.icon}
        onPress={onManageBookmarks}
        disabled={busy || !workspaceName}
        accessibilityLabel="Manage local bookmarks"
      >
        <Bookmark
          size={18}
          color={busy || !workspaceName ? colors.textMuted : colors.textSecondary}
        />
      </Pressable>
      <Pressable
        style={styles.icon}
        onPress={onRefresh}
        disabled={busy}
        accessibilityLabel="Refresh jj source control"
      >
        <RefreshCw size={18} color={busy ? colors.textMuted : colors.textSecondary} />
      </Pressable>
    </View>
  )
}
