import Ionicons from '@react-native-vector-icons/ionicons';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ScreenScaffoldProps = {
  /** Screen heading. */
  title: string;
  /** Optional one-line explanation under the heading. */
  subtitle?: string;
  children?: ReactNode;
  /** Set to false for screens that manage their own scrolling. */
  scroll?: boolean;
  /**
   * Opt-in back control.
   *
   * Tab screens are the root of their section, so they show no back button.
   * A *pushed* screen (for example Categories) is not, so it passes `router.back`
   * and gets the same header, with a leading chevron.
   */
  onBack?: () => void;
};

/**
 * Standard page frame for every screen: themed background, top safe area,
 * consistent padding, readable max width, and enough bottom padding that
 * content is never hidden behind the tab bar.
 */
export function ScreenScaffold({
  title,
  subtitle,
  children,
  scroll = true,
  onBack,
}: ScreenScaffoldProps) {
  const theme = useTheme();

  const heading = (
    <>
      <ThemedText type="heading" accessibilityRole="header">
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      ) : null}
    </>
  );

  const header = onBack ? (
    <View style={styles.headerRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => [
          styles.backButton,
          { borderColor: theme.border, backgroundColor: theme.backgroundElement },
          pressed ? styles.pressed : null,
        ]}>
        <Ionicons name="chevron-back" size={20} color={theme.text} />
      </Pressable>
      <View style={styles.headerText}>{heading}</View>
    </View>
  ) : (
    <View style={styles.headerText}>{heading}</View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headerText: {
    flexShrink: 1,
    gap: Spacing.half,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
