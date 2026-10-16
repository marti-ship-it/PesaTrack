import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

type ScreenScaffoldProps = {
  /** Screen heading. */
  title: string;
  /** Optional one-line explanation under the heading. */
  subtitle?: string;
  children?: ReactNode;
  /** Set to false for screens that manage their own scrolling. */
  scroll?: boolean;
};

/**
 * Standard page frame for every screen: themed background, top safe area,
 * consistent padding, readable max width, and enough bottom padding that
 * content is never hidden behind the tab bar.
 */
export function ScreenScaffold({ title, subtitle, children, scroll = true }: ScreenScaffoldProps) {
  const header = (
    <View style={styles.header}>
      <ThemedText type="heading">{title}</ThemedText>
      {subtitle ? (
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        {scroll ? (
          <View style={styles.centeredColumn}>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}>
              {header}
              {children}
            </ScrollView>
          </View>
        ) : (
          <View style={[styles.content, styles.flex]}>
            {header}
            {children}
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centeredColumn: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.half,
  },
});
