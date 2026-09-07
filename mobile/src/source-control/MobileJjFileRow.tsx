import { Pressable, Text, View } from 'react-native'
import { Check, ChevronRight } from 'lucide-react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type { JjChange } from '../../../src/shared/jj-types'
type Props = {
  change: JjChange
  selected: boolean
  busy: boolean
  onOpen: () => void
  onToggle: () => void
}
const styles = {
  row: {
    minHeight: 48,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle
  },
  selectedRow: { backgroundColor: colors.bgRaised },
  selection: {
    width: 28,
    height: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const
  },
  mark: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.textMuted,
    alignItems: 'center' as const,
    justifyContent: 'center' as const
  },
  active: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  badge: { color: colors.textSecondary, fontSize: typography.metaSize, fontWeight: '700' as const },
  path: { flex: 1, color: colors.textPrimary, fontSize: typography.bodySize },
  detail: { color: colors.textSecondary, fontSize: typography.metaSize }
}
export function MobileJjFileRow({ change, selected, busy, onOpen, onToggle }: Props) {
  return (
    <Pressable
      style={[styles.row, selected && styles.selectedRow]}
      onPress={onOpen}
      disabled={busy}
      accessibilityLabel={`Open jj diff ${change.path}`}
    >
      <Pressable
        style={styles.selection}
        onPress={onToggle}
        disabled={busy}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`Select ${change.path} for commit`}
      >
        <View style={[styles.mark, selected && styles.active]}>
          {selected ? <Check size={13} color={colors.bgBase} /> : null}
        </View>
      </Pressable>
      <Text style={styles.badge}>
        {change.status === 'conflicted' ? '!' : change.status.slice(0, 1).toUpperCase()}
      </Text>
      <Text style={styles.path} numberOfLines={1}>
        {change.path}
      </Text>
      {change.stats ? (
        <Text style={styles.detail}>
          +{change.stats.added} -{change.stats.removed}
        </Text>
      ) : null}
      <ChevronRight size={16} color={colors.textMuted} />
    </Pressable>
  )
}
