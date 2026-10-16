import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemePreferenceOrNull } from '@/hooks/theme-preference';
import { resolveThemeName, type ThemeName } from '@/utils/theme';

export type { ThemeName };

/**
 * Returns the active color palette.
 *
 * The palette comes from the stored appearance preference (Settings →
 * Appearance) when there is one, and otherwise from the device scheme — the
 * rule lives in `resolveThemeName`, so every screen, the tab bar and the
 * navigation chrome can never disagree about it.
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
  return Colors[useThemeName()];
}

/** Just the theme name, for places that need to branch (e.g. icon styles). */
export function useThemeName(): ThemeName {
  const scheme = useColorScheme();
  const preference = useThemePreferenceOrNull()?.preference ?? 'system';
  return resolveThemeName(preference, scheme);
}
