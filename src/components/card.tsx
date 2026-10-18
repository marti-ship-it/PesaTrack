import { StyleSheet, View, type ViewProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BorderWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type CardProps = ViewProps & {
  /** Optional heading shown at the top of the card. */
  title?: string;
};

/**
 * A surface used for grouping related information (summary numbers, budget
 * rows, form sections). Produces consistent padding, radius and border so
 * every screen looks like part of the same product.
 */
export function Card({ title, style, children, ...rest }: CardProps) {
  const theme = useTheme();

  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.card, { borderColor: theme.border }, style]}
      {...rest}>
      {title ? (
        <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header">
          {title}
        </ThemedText>
      ) : null}
      <View style={styles.body}>{children}</View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: BorderWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  body: {
    gap: Spacing.two,
  },
});
