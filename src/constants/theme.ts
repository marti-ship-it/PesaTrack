/**
 * PesaTrack design system.
 *
 * All visual constants live here so that screens never hard-code colors,
 * spacing, or corner radii. Keeping them in one place is what makes the app
 * look consistent, and it makes light/dark theming a single-file change.
 *
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Semantic color tokens.
 *
 * "Semantic" means the name describes the *meaning* (income, expense, savings)
 * rather than the appearance (green, red). If we later adjust the exact green,
 * every screen updates automatically.
 *
 * Accessibility note: these values were chosen to keep readable contrast in
 * both themes. Financial states are additionally labelled with text or icons,
 * never communicated by color alone.
 */
export const Colors = {
  light: {
    // Neutrals
    text: '#101418',
    textSecondary: '#5A6472',
    textMuted: '#7C8794',
    background: '#F5F7FA',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E7EBF0',
    border: '#DDE3EA',

    // Brand + interaction
    primary: '#1B4D89',
    primaryMuted: '#E8F0FA',
    onPrimary: '#FFFFFF',

    // Financial semantics
    income: '#0F7B3F',
    expense: '#C02626',
    savings: '#0B6E99',
    warning: '#9A5B00',
  },
  dark: {
    // Neutrals
    text: '#F2F4F7',
    textSecondary: '#A9B2BF',
    textMuted: '#7C8794',
    background: '#0E1116',
    backgroundElement: '#171B21',
    backgroundSelected: '#232A33',
    border: '#2A313B',

    // Brand + interaction
    primary: '#8AB4F8',
    primaryMuted: '#1B2735',
    onPrimary: '#0B1220',

    // Financial semantics
    income: '#4ADE80',
    expense: '#FF8A80',
    savings: '#5AC8FA',
    warning: '#F5B94A',
  },
} as const;

/** Any valid color token name, e.g. "income" or "textSecondary". */
export type ThemeColor = keyof typeof Colors.light;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    mono: 'var(--font-mono)',
  },
});

/**
 * Spacing scale. Using multiples of 4 keeps layouts visually aligned.
 * Prefer these over raw numbers in styles.
 */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Corner radii. */
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/** Standard border width for cards and inputs. */
export const BorderWidth = 1;

/** Extra bottom padding so content is never hidden behind the tab bar. */
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;

/** Keeps content readable on tablets instead of stretching edge-to-edge. */
export const MaxContentWidth = 800;
