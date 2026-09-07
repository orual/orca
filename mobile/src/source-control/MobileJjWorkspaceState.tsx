import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { RotateCcw } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { MobileJjScreenState } from './mobile-jj-source-control-types'

const styles = {
  state: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: spacing.xl,
    gap: spacing.sm
  },
  stateTitle: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700' as const
  },
  stateText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    textAlign: 'center' as const
  },
  button: {
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
  buttonText: { color: colors.bgBase, fontSize: typography.bodySize, fontWeight: '700' as const },
  secondaryText: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600' as const
  },
  error: { color: colors.statusRed, fontSize: typography.metaSize, marginBottom: spacing.sm },
  warning: { color: colors.statusAmber, fontSize: typography.metaSize, marginBottom: spacing.sm }
}

type Props = {
  screenState: Exclude<MobileJjScreenState, { kind: 'ready' }>
  mutationError?: string | null
  busy: boolean
  uncertain: boolean
  onRetry: () => void
  onUpdate: () => void
}

export function MobileJjWorkspaceState({
  screenState,
  mutationError,
  busy,
  uncertain,
  onRetry,
  onUpdate
}: Props) {
  if (screenState.kind === 'loading') {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
  }
  if (screenState.kind === 'stale') {
    return (
      <View style={styles.state}>
        <Text style={styles.stateTitle}>Working Copy Is Stale</Text>
        <Text style={styles.warning}>{screenState.message}</Text>
        {mutationError ? <Text style={styles.error}>{mutationError}</Text> : null}
        <Pressable style={styles.button} onPress={onUpdate} disabled={busy || uncertain}>
          <RotateCcw size={16} color={colors.bgBase} />
          <Text style={styles.buttonText}>Update Stale Workspace</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <View style={styles.state}>
      <Text style={styles.stateTitle}>Unable to Load jj Workspace</Text>
      <Text style={styles.stateText}>{screenState.message}</Text>
      {mutationError ? <Text style={styles.error}>{mutationError}</Text> : null}
      <Pressable style={[styles.button, styles.secondary]} onPress={onRetry}>
        <Text style={styles.secondaryText}>Retry</Text>
      </Pressable>
    </View>
  )
}
