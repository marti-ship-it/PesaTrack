import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { migrateDatabase } from '@/db/migrations';
import { DATABASE_NAME } from '@/db/schema';
import { ThemePreferenceProvider } from '@/hooks/theme-preference';
import { useThemeName } from '@/hooks/use-theme';

/**
 * Root layout.
 *
 * `_layout.tsx` is special in Expo Router: it wraps every screen beneath it.
 * Here we do five things that must happen once for the whole app:
 *   1. open the SQLite database and bring its schema up to date,
 *   2. load the stored appearance preference and apply it app-wide,
 *   3. apply that palette to the native navigation chrome,
 *   4. register the stack screens (the `(tabs)` folder plus the modal forms),
 *   5. set the status bar style to match the theme.
 *
 * The order matters. The theme preference lives *in* the database, so
 * `ThemePreferenceProvider` has to sit inside `SQLiteProvider`; the navigation
 * chrome sits inside the theme provider because it needs to know which palette
 * won. The database opens *before* the first screen renders (`useSuspense`), so
 * no screen has to cope with a half-ready database. Until it is ready the user
 * sees a short loading screen instead of a flash of empty cards — that screen
 * is deliberately outside both providers (the preference cannot be read yet)
 * and falls back to the device scheme.
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

/**
 * Paints the native navigation chrome (and status bar) with the active theme.
 *
 * `ThemeProvider` must wrap the `Stack` itself for the navigator to pick the
 * colors up, so this sits between our stored preference and the navigator.
 */
function AppChrome({ children }: { children: ReactNode }) {
  const isDark = useThemeName() === 'dark';

  return (
    <ThemeProvider value={isDark ? navigationDark : navigationLight}>
      {children}
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <Suspense fallback={<DatabaseLoadingScreen />}>
      {/*
        `onInit` runs once, before the first screen can query. It creates the
        tables and seeds the starter categories on a fresh install, and is a
        no-op afterwards, so the user's data is never touched on update.
      */}
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDatabase} useSuspense>
        <ThemePreferenceProvider>
          <AppChrome>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              {/* The add/edit transaction form is presented as a modal over the tabs. */}
              <Stack.Screen name="transaction-form" options={{ presentation: 'modal' }} />
              {/* The set/edit budget form is presented the same way. */}
              <Stack.Screen name="budget-form" options={{ presentation: 'modal' }} />
              {/* Category management is a pushed screen; its edit form is a modal. */}
              <Stack.Screen name="categories" />
              <Stack.Screen name="category-form" options={{ presentation: 'modal' }} />
            </Stack>
          </AppChrome>
        </ThemePreferenceProvider>
      </SQLiteProvider>
    </Suspense>
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
