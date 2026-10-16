/**
 * Theme resolution.
 *
 * PesaTrack stores a *preference* — "system", "light" or "dark" — and has to
 * turn that, plus whatever the device currently reports, into the one palette
 * it can actually render. Keeping that rule in a file with no React, no React
 * Native and no database imports means it can be tested directly and reused by
 * the theme provider, the navigation chrome and the status bar without any of
 * them having to agree on the rule separately.
 */

import type { ThemePreference } from '@/types/models';

/** Light or dark, never anything else. */
export type ThemeName = 'light' | 'dark';

/**
 * Works out which palette to render.
 *
 * - `"light"` and `"dark"` win outright — that is the point of choosing one.
 * - `"system"` follows the device. `useColorScheme()` may report `null` or
 *   `undefined` (a device or browser that does not say), and React Native Web
 *   may report `'unspecified'`; all of those mean "light", matching the
 *   `userInterfaceStyle: "automatic"` default in app.json. Returning a
 *   definite `"light"`/`"dark"` is what stops every colour-token lookup from
 *   ever producing `undefined`.
 */
export function resolveThemeName(
  preference: ThemePreference,
  systemScheme: string | null | undefined
): ThemeName {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }
  return systemScheme === 'dark' ? 'dark' : 'light';
}
