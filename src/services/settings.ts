import type { AppSettings, ThemePreference } from '@/types/models';
import { MAX_FINANCIAL_MONTH_START_DAY, MIN_FINANCIAL_MONTH_START_DAY } from '@/utils/dates';

/**
 * The rules behind the Settings screen.
 *
 * Like `services/validation.ts`, this module is pure: the screen hands it what
 * the user typed, and it answers with field-level messages a person can act on.
 * No database, no React, no side effects — which is what makes the awkward
 * cases ("29 is not a possible start day", "type instead of a number") testable
 * without a phone.
 *
 * The schema enforces the same ranges with `CHECK` constraints, so a buggy
 * screen still cannot store an impossible value. These messages exist so the
 * user is told *before* the database has to complain.
 */

/** Budget warning thresholds, matching the schema's `BETWEEN 1 AND 100`. */
export const MIN_BUDGET_WARNING_THRESHOLD_PERCENT = 1;
export const MAX_BUDGET_WARNING_THRESHOLD_PERCENT = 100;

/**
 * Settings the screen offers, as the user typed them.
 *
 * Kept separate from `AppSettings` because a text input holds a string: the
 * draft is what a form edits, `settingsPatchFromDraft` is what gets stored.
 */
export type SettingsDraft = {
  /** Day of the month the financial month starts on, typed as text. */
  financialMonthStartDay: string;
  /** Percentage of a category budget at which to warn, typed as text. */
  budgetWarningThresholdPercent: string;
};

/**
 * One message per field, so a form can show it under the right input.
 *
 * Note the `Record`: `Partial<keyof SettingsDraft>` would map over the *members
 * of the string type* (`charAt`, `length`, …) rather than over the two field
 * names, so `errors.financialMonthStartDay` would not exist. `Record` keys the
 * object by the draft's own field names, which is what the form needs.
 */
export type SettingsErrors = Partial<Record<keyof SettingsDraft, string>>;

/**
 * Reads a whole number out of a text field.
 *
 * Returns `null` for anything that is not an integer — blank, letters, a
 * decimal point, a sign — so every caller reports one clear message instead of
 * each having to guess what `Number("")` or `Number("12abc")` would produce.
 */
export function parseSettingInteger(input: string): number | null {
  const digits = input.trim().replace(/\s+/g, '');
  if (digits.length === 0 || digits.length > 3 || !/^\d+$/.test(digits)) {
    return null;
  }

  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Day of month, 1–28.
 *
 * The upper bound is 28 rather than 31 so that a financial month starting on
 * that day exists in every month of the year — the same rule the schema's
 * `CHECK (financial_month_start_day BETWEEN 1 AND 28)` encodes.
 */
export function financialMonthStartDayError(value: number | null): string | null {
  if (value === null || value < MIN_FINANCIAL_MONTH_START_DAY || value > MAX_FINANCIAL_MONTH_START_DAY) {
    return `Enter a whole number from ${MIN_FINANCIAL_MONTH_START_DAY} to ${MAX_FINANCIAL_MONTH_START_DAY}.`;
  }
  return null;
}

/** Warning threshold as a percentage, 1–100. */
export function budgetWarningThresholdError(value: number | null): string | null {
  if (
    value === null ||
    value < MIN_BUDGET_WARNING_THRESHOLD_PERCENT ||
    value > MAX_BUDGET_WARNING_THRESHOLD_PERCENT
  ) {
    return `Enter a whole number from ${MIN_BUDGET_WARNING_THRESHOLD_PERCENT} to ${MAX_BUDGET_WARNING_THRESHOLD_PERCENT}.`;
  }
  return null;
}

/** The appearance choice. The schema only allows these three. */
export function themePreferenceError(value: string): string | null {
  const allowed: readonly string[] = ['system', 'light', 'dark'];
  return allowed.includes(value) ? null : 'Choose System, Light or Dark.';
}

/**
 * Validates the two numbers the settings form collects.
 *
 * Every field is checked even when an earlier one failed, so the user sees all
 * the problems at once instead of fixing them one at a time.
 */
export function validateSettingsDraft(draft: SettingsDraft): SettingsErrors {
  const errors: SettingsErrors = {};

  const startDayError = financialMonthStartDayError(parseSettingInteger(draft.financialMonthStartDay));
  if (startDayError) {
    errors.financialMonthStartDay = startDayError;
  }

  const thresholdError = budgetWarningThresholdError(
    parseSettingInteger(draft.budgetWarningThresholdPercent)
  );
  if (thresholdError) {
    errors.budgetWarningThresholdPercent = thresholdError;
  }

  return errors;
}

/**
 * Turns a validated draft into the patch `updateSettings` expects.
 *
 * Returns `null` rather than a half-built patch when any value is unusable, so
 * a caller can never write a start day but forget a threshold. Save only after
 * `validateSettingsDraft` reports no errors and this cannot be `null`.
 */
export function settingsPatchFromDraft(draft: SettingsDraft): Partial<AppSettings> | null {
  const startDay = parseSettingInteger(draft.financialMonthStartDay);
  const threshold = parseSettingInteger(draft.budgetWarningThresholdPercent);

  if (
    startDay === null ||
    threshold === null ||
    financialMonthStartDayError(startDay) !== null ||
    budgetWarningThresholdError(threshold) !== null
  ) {
    return null;
  }

  return {
    financialMonthStartDay: startDay,
    budgetWarningThresholdPercent: threshold,
  };
}

/** Narrows a stored string to the appearance choices, for defensive callers. */
export function toThemePreference(value: string): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
