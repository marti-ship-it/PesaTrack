import {
  MAX_BUDGET_WARNING_THRESHOLD_PERCENT,
  budgetWarningThresholdError,
  financialMonthStartDayError,
  parseSettingInteger,
  settingsPatchFromDraft,
  themePreferenceError,
  toThemePreference,
  validateSettingsDraft,
  type SettingsDraft,
} from '../settings';

/**
 * Settings rules, tested without a database or a phone.
 *
 * The same ranges are enforced twice on purpose: here, so the user is told
 * *before* saving, and by `CHECK` constraints in the schema, so an impossible
 * value can never be stored. These tests pin the first half; `schema.test.ts`
 * pins the second.
 *
 * The recurring theme is "the user typed something odd": a stale draft, a
 * leading zero, a 29th of the month that would not exist in February, or a
 * percentage of 0 that would make every budget warn immediately.
 */

function draft(overrides: Partial<SettingsDraft> = {}): SettingsDraft {
  return {
    financialMonthStartDay: '1',
    budgetWarningThresholdPercent: '80',
    ...overrides,
  };
}

describe('parseSettingInteger', () => {
  it('reads a plain whole number', () => {
    expect(parseSettingInteger('25')).toBe(25);
  });

  it('ignores surrounding spaces and leading zeros', () => {
    expect(parseSettingInteger('  07 ')).toBe(7);
  });

  it('accepts the boundary values the settings allow', () => {
    expect(parseSettingInteger('1')).toBe(1);
    expect(parseSettingInteger('100')).toBe(100);
  });

  it('refuses an empty field rather than treating it as zero', () => {
    // Zero is not a valid day or threshold, so silently reading "" as 0 would
    // produce a confusing second error instead of "enter a number".
    expect(parseSettingInteger('')).toBeNull();
    expect(parseSettingInteger('   ')).toBeNull();
  });

  it('refuses anything that is not a whole number', () => {
    expect(parseSettingInteger('12.5')).toBeNull();
    expect(parseSettingInteger('-5')).toBeNull();
    expect(parseSettingInteger('two')).toBeNull();
    expect(parseSettingInteger('12a')).toBeNull();
    expect(parseSettingInteger('5x')).toBeNull();
  });

  it('ignores spaces, because a pasted value often carries them', () => {
    // Deliberate leniency: "1 000" and " 07 " are read as 1000 and 7 rather
    // than being rejected as typos.
    expect(parseSettingInteger(' 07 ')).toBe(7);
    expect(parseSettingInteger('1 0')).toBe(10);
  });

  it('refuses a number too long to be a day or a percentage', () => {
    expect(parseSettingInteger('1000')).toBeNull();
  });
});

describe('financialMonthStartDayError', () => {
  it('accepts every day from the 1st to the 28th', () => {
    expect(financialMonthStartDayError(1)).toBeNull();
    expect(financialMonthStartDayError(28)).toBeNull();
  });

  it('refuses the 29th onwards, which would not exist in every month', () => {
    // This is the whole reason the range stops at 28: a start day of 30 would
    // have no February, so the financial month could not be computed.
    expect(financialMonthStartDayError(29)).toContain('1 to 28');
    expect(financialMonthStartDayError(30)).toContain('1 to 28');
    expect(financialMonthStartDayError(31)).toContain('1 to 28');
  });

  it('refuses zero and negative days', () => {
    expect(financialMonthStartDayError(0)).toContain('1 to 28');
    expect(financialMonthStartDayError(-1)).toContain('1 to 28');
  });

  it('refuses an unparsable value', () => {
    expect(financialMonthStartDayError(null)).toContain('1 to 28');
  });
});

describe('budgetWarningThresholdError', () => {
  it('accepts any percentage from 1 to 100', () => {
    expect(budgetWarningThresholdError(1)).toBeNull();
    expect(budgetWarningThresholdError(80)).toBeNull();
    expect(budgetWarningThresholdError(MAX_BUDGET_WARNING_THRESHOLD_PERCENT)).toBeNull();
  });

  it('refuses 0, which would warn before any money was spent', () => {
    expect(budgetWarningThresholdError(0)).toContain('1 to 100');
  });

  it('refuses more than 100 per cent', () => {
    expect(budgetWarningThresholdError(101)).toContain('1 to 100');
  });

  it('refuses an unparsable value', () => {
    expect(budgetWarningThresholdError(null)).toContain('1 to 100');
  });
});

describe('themePreferenceError', () => {
  it('accepts the three stored choices', () => {
    expect(themePreferenceError('system')).toBeNull();
    expect(themePreferenceError('light')).toBeNull();
    expect(themePreferenceError('dark')).toBeNull();
  });

  it('refuses anything else', () => {
    expect(themePreferenceError('sepia')).not.toBeNull();
    expect(themePreferenceError('')).not.toBeNull();
  });
});

describe('validateSettingsDraft', () => {
  it('reports nothing for a usable draft', () => {
    expect(validateSettingsDraft(draft())).toEqual({});
  });

  it('reports every problem at once, not just the first', () => {
    // Fixing errors one at a time is the tedious behaviour this avoids.
    const errors = validateSettingsDraft(
      draft({ financialMonthStartDay: '31', budgetWarningThresholdPercent: '500' })
    );

    expect(errors.financialMonthStartDay).toBeDefined();
    expect(errors.budgetWarningThresholdPercent).toBeDefined();
  });

  it('keys each message to its own field', () => {
    const errors = validateSettingsDraft(draft({ financialMonthStartDay: '29' }));

    expect(errors.financialMonthStartDay).toContain('1 to 28');
    expect(errors.budgetWarningThresholdPercent).toBeUndefined();
  });
});

describe('settingsPatchFromDraft', () => {
  it('turns a valid draft into the numbers that are stored', () => {
    expect(settingsPatchFromDraft(draft({ financialMonthStartDay: '25', budgetWarningThresholdPercent: '90' })))
      .toEqual({
        financialMonthStartDay: 25,
        budgetWarningThresholdPercent: 90,
      });
  });

  it('never returns a half-written patch', () => {
    // A partial patch could store a new start day while silently keeping the
    // old threshold, so an unusable draft must produce nothing at all.
    expect(settingsPatchFromDraft(draft({ budgetWarningThresholdPercent: '0' }))).toBeNull();
    expect(settingsPatchFromDraft(draft({ financialMonthStartDay: '29' }))).toBeNull();
    expect(settingsPatchFromDraft(draft({ financialMonthStartDay: '' }))).toBeNull();
  });
});

describe('toThemePreference', () => {
  it('keeps the two explicit choices', () => {
    expect(toThemePreference('light')).toBe('light');
    expect(toThemePreference('dark')).toBe('dark');
  });

  it('falls back to following the phone for anything unexpected', () => {
    expect(toThemePreference('system')).toBe('system');
    expect(toThemePreference('sepia')).toBe('system');
    expect(toThemePreference('')).toBe('system');
  });
});
