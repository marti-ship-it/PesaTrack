import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * Web-only variant of `useColorScheme` (selected automatically by file
 * extension: Metro picks `.web.ts` when bundling for the browser).
 *
 * When Expo renders the app statically, the HTML is produced before the
 * browser knows the visitor's theme. The first client render must therefore
 * match the server output ("light") and only then switch to the real value,
 * otherwise React reports a hydration mismatch.
 *
 * `useSyncExternalStore` expresses exactly that: the server snapshot is
 * `false` and the client snapshot is `true`, with no state update inside an
 * effect.
 */
const subscribe = () => () => {};

const getClientSnapshot = () => true;

const getServerSnapshot = () => false;

export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const colorScheme = useRNColorScheme();

  return hasHydrated ? colorScheme : 'light';
}
