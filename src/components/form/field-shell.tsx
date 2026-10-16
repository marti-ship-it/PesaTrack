import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type FieldShellProps = {
  /** Field caption shown above the control. */
  label: string;
  /** Field-level error; shown instead of the hint when present. */
  error?: string;
  /** Guidance shown while there is no error. */
  hint?: string;
  children: ReactNode;
};

/**
 * Wraps a form control with its label and message.
 *
 * Every field in the app uses this, so labels, spacing and error styling cannot
 * drift apart from one another.
 */
export function FieldShell({ label, error, hint, children }: FieldShellProps) {
  return (
    <View style={styles.container}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
      {error ? (
        <ThemedText type="small" themeColor="expense">
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textMuted">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
});
