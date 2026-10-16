/**
 * Pins down the rule that decides the visible palette.
 *
 * The cases that matter are the ones a phone can genuinely report: an
 * unreported system scheme, and a stored preference that must override it.
 * Getting any of these wrong shows as a flash of the wrong theme or a crash on
 * a missing colour token, neither of which a screenshot test would catch
 * reliably — so the rule is asserted here instead.
 */
import { resolveThemeName } from '../theme';

describe('resolveThemeName', () => {
  it('follows the device when the preference is "system"', () => {
    expect(resolveThemeName('system', 'dark')).toBe('dark');
    expect(resolveThemeName('system', 'light')).toBe('light');
  });

  it('treats an unreported system scheme as light', () => {
    // A device or browser that says nothing, and React Native Web's
    // 'unspecified', all have to resolve to a real palette.
    expect(resolveThemeName('system', null)).toBe('light');
    expect(resolveThemeName('system', undefined)).toBe('light');
    expect(resolveThemeName('system', 'unspecified')).toBe('light');
  });

  it('lets an explicit preference win over the device', () => {
    expect(resolveThemeName('light', 'dark')).toBe('light');
    expect(resolveThemeName('dark', 'light')).toBe('dark');
  });
});
