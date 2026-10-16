import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getSettings, updateSettings } from '@/db/repositories/settings';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ThemePreference } from '@/types/models';
import { resolveThemeName, type ThemeName } from '@/utils/theme';

/**
 * The stored appearance choice, made available app-wide.
 *
 * The preference lives in the `settings` row, so it cannot be read before the
 * database opens. This provider therefore sits **inside** `SQLiteProvider`
 * (see `app/_layout.tsx`) and applies the choice the moment it loads.
 *
 * Until it has loaded, the provider reports `"system"`, which is both the
 * schema default and what the app showed before M7 — so an existing user never
 * sees a theme flash on launch, and a device with no readable preference still
 * gets a palette.
 */

export type ThemeContextValue = {
  /** The stored choice: `system`, `light` or `dark`. */
  preference: ThemePreference;
  /** The palette actually in use right now (preference resolved with the device). */
  themeName: ThemeName;
  /** Saves the preference and applies it immediately. Rejects if the write fails. */
  setPreference: (next: ThemePreference) => Promise<void>;
};

const ThemePreferenceContext = createContext<ThemeContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const systemScheme = useColorScheme();

  // Always starts at "system": the value migration 1 writes, and the value the
  // app already behaved under before the stored preference was ever read.
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const storedPreference = useRef<ThemePreference>('system');

  useEffect(() => {
    let isCancelled = false;

    void getSettings(db)
      .then((settings) => {
        if (isCancelled) {
          return;
        }
        storedPreference.current = settings.themePreference;
        setPreferenceState(settings.themePreference);
      })
      .catch(() => {
        // The screen can still render with "system"; nothing is written here,
        // so there is nothing to roll back either.
      });

    return () => {
      isCancelled = true;
    };
  }, [db]);

  const setPreference = useCallback(
    async (next: ThemePreference) => {
      const previous = storedPreference.current;
      // Optimistic: the palette should move as soon as the choice is made.
      setPreferenceState(next);

      try {
        await updateSettings(db, { themePreference: next });
        storedPreference.current = next;
      } catch (error) {
        // Put the screen back to what is actually stored, so what the user
        // sees cannot drift away from what the app will do on the next launch.
        setPreferenceState(previous);
        throw error;
      }
    },
    [db]
  );

  const themeName = resolveThemeName(preference, systemScheme);

  const value = useMemo(
    () => ({ preference, themeName, setPreference }),
    [preference, themeName, setPreference]
  );

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

/**
 * The appearance context.
 *
 * Throws when used outside `ThemePreferenceProvider`, because "which theme am I
 * in?" has no sensible default there — a silently wrong answer would repaint
 * the app with the wrong palette.
 */
export function useThemePreference(): ThemeContextValue {
  const value = useContext(ThemePreferenceContext);
  if (!value) {
    throw new Error('useThemePreference must be used inside <ThemePreferenceProvider>.');
  }
  return value;
}

/**
 * The stored preference, or `null` when there is no provider above the caller.
 *
 * `useTheme` needs the lenient version: it falls back to the device scheme, so
 * a component rendered outside the provider (a standalone preview, a test) is
 * still styled rather than crashing.
 */
export function useThemePreferenceOrNull(): ThemeContextValue | null {
  return useContext(ThemePreferenceContext);
}
