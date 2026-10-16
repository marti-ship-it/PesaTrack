import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type EmptyStateProps = {
  /** Short heading, for example "No transactions yet". */
  title: string;
  /** One or two sentences explaining what the user can do next. */
  message: string;
  /** Optional icon or illustration shown above the heading. */
  icon?: ReactNode;
};

/**
 * Shown whenever a screen has nothing to display yet.
 *
 * Using one component for all empty states keeps the copy tone and layout
 * consistent, and it guarantees the app never shows a blank screen.
 */
export function EmptyState({ title, message, icon }: EmptyStateProps) {
  return (
    <Card>
      <View style={styles.container}>
        {icon}
        <ThemedText type="default" style={styles.text}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
          {message}
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  text: {
    textAlign: 'center',
  },
});
