import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BorderWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** How much visual weight a button carries. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and blocks further presses while an async action runs. */
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The app's button.
 *
 * `primary` is the single main action on a screen; `secondary` is everything
 * else; `danger` is destructive (delete) and is deliberately outlined rather
 * than filled, so it never looks like the default thing to tap.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const colors =
    variant === 'primary'
      ? { backgroundColor: theme.primary, borderColor: theme.primary, textColor: theme.onPrimary }
      : variant === 'danger'
        ? { backgroundColor: theme.backgroundElement, borderColor: theme.expense, textColor: theme.expense }
        : { backgroundColor: theme.backgroundElement, borderColor: theme.border, textColor: theme.text };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.backgroundColor, borderColor: colors.borderColor },
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.textColor} />
      ) : (
        <ThemedText type="default" style={[styles.label, { color: colors.textColor }]}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: BorderWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  label: {
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
});
