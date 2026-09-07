import { Pressable, Text, TextInput, View } from 'react-native'
import { Check, MoreHorizontal } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

type Props = {
  message: string
  changeCount: number
  selectedCount: number
  busy: boolean
  uncertain: boolean
  error?: string | null
  onChange: (message: string) => void
  onCommit: () => void
  onOpenActions: () => void
}

const styles = {
  card: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  input: {
    minHeight: 44,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm
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
    gap: spacing.xs
  },
  menuButton: {
    width: 40,
    minHeight: 40,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center' as const,
    justifyContent: 'center' as const
  },
  primaryText: { color: colors.bgBase, fontSize: typography.bodySize, fontWeight: '700' as const },
  detail: { color: colors.textSecondary, fontSize: typography.metaSize },
  error: { color: colors.statusRed, fontSize: typography.metaSize },
  warning: { color: colors.statusAmber, fontSize: typography.metaSize }
}

export function MobileJjComposer({
  message,
  changeCount,
  selectedCount,
  busy,
  uncertain,
  error,
  onChange,
  onCommit,
  onOpenActions
}: Props) {
  const hasMessage = message.trim().length > 0
  return (
    <View style={styles.card}>
      {uncertain ? (
        <Text style={styles.warning}>
          Commit outcome is uncertain. Refresh before trying again.
        </Text>
      ) : null}
      {error && !uncertain ? <Text style={styles.error}>{error}</Text> : null}
      <TextInput
        style={styles.input}
        value={message}
        onChangeText={onChange}
        placeholder="Description or commit message"
        placeholderTextColor={colors.textMuted}
        editable={!busy}
        accessibilityLabel="Description or commit message"
      />
      <View style={styles.row}>
        <Pressable
          style={styles.button}
          onPress={onCommit}
          disabled={busy || uncertain || !hasMessage || changeCount === 0}
          accessibilityLabel="Commit all jj changes"
        >
          <Check size={16} color={colors.bgBase} />
          <Text style={styles.primaryText}>Commit All</Text>
        </Pressable>
        <Pressable
          style={styles.menuButton}
          onPress={onOpenActions}
          disabled={busy}
          hitSlop={8}
          accessibilityLabel="Open jj source control actions"
        >
          <MoreHorizontal size={18} color={colors.textPrimary} strokeWidth={2.1} />
        </Pressable>
      </View>
      <Text style={styles.detail}>
        Selected {selectedCount} · Remaining {Math.max(changeCount - selectedCount, 0)}
      </Text>
    </View>
  )
}
