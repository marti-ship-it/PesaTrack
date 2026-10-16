import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { migrateDatabase } from '@/db/migrations';
import { DATABASE_NAME } from '@/db/schema';

/**
 * Root layout.
 *
 * `_layout.tsx` is special in Expo Router: it wraps every screen beneath it.
 * Here we do four things that must happen once for the whole app:
 *   1. open the SQLite database and bring its schema up to date,
 *   2. apply our color palette to the native navigation chrome,
 *   3. register the tab navigator (the `(tabs)` folder),
 *   4. set the status bar style to match the theme.
 *
 * The database opens *before* the first screen renders (`useSuspense`), so no
 * screen has to cope with a half-ready database. Until it is ready the user
 * sees a short themed loading screen instead of a flash of empty cards.
 */

const navigationLight = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.light.primary,
    background: Colors.light.background,
    card: Colors.light.backgroundElement,
    text: Colors.light.text,
    border: Colors.light.border,
  },
};

const navigationDark = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.dark.primary,
    background: Colors.dark.background,
    card: Colors.dark.backgroundElement,
    text: Colors.dark.text,
    border: Colors.dark.border,
  },
};

/** Shown for the moment it takes to open the database and run migrations. */
function DatabaseLoadingScreen() {
  const isDark = useColorScheme() === 'dark';

  return (
    <View
      style={[
        styles.loadingContainer,
        { backgroundColor: isDark ? Colors.dark.background : Colors.light.background },
      ]}
    >
      <ActivityIndicator
        size="large"
        color={isDark ? Colors.dark.primary : Colors.light.primary}
      />
      <Text
        style={[
          styles.loadingText,
          { color: isDark ? Colors.dark.textMuted : Colors.light.textMuted },
        ]}
      >
        Opening your records…
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const isDark = useColorScheme() === 'dark';

  return (
    <ThemeProvider value={isDark ? navigationDark : navigationLight}>
      <Suspense fallback={<DatabaseLoadingScreen />}>
        {/*
          `onInit` runs once, before the first screen can query. It creates the
          tables and seeds the starter categories on a fresh install, and is a
          no-op afterwards, so the user's data is never touched on update.
        */}
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDatabase} useSuspense>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            {/* The add/edit transaction form is presented as a modal over the tabs. */}
            <Stack.Screen name="transaction-form" options={{ presentation: 'modal' }} />
          </Stack>
        </SQLiteProvider>
      </Suspense>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
});
