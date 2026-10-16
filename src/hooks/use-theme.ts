import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Light or dark, never anything else. */
export type ThemeName = 'light' | 'dark';

/**
 * Returns the active color palette.
 *
 * `useColorScheme()` can return `null` or `undefined` (a device or browser that
 * does not report a preference), and React Native Web uses `'unspecified'`.
 * Any of those means "light", so the lookup below can never produce
 * `undefined` — which would crash every component that reads a color token.
 *
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */
export function useTheme() {
  const scheme = useColorScheme();
  const themeName: ThemeName = scheme === 'dark' ? 'dark' : 'light';

  return Colors[themeName];
}

/** Just the theme name, for places that need to branch (e.g. icon styles). */
export function useThemeName(): ThemeName {
  const scheme = useColorScheme();
  return scheme === 'dark' ? 'dark' : 'light';
}
