import type { SQLiteDatabase } from 'expo-sqlite';

import type { AppSettings } from '@/types/models';
import { nowIso } from '@/utils/ids';
import { DEFAULT_CURRENCY } from '@/utils/money';
import { DEFAULT_FINANCIAL_MONTH_START_DAY } from '@/utils/dates';

import { DEFAULT_BUDGET_WARNING_THRESHOLD_PERCENT } from '../schema';

/**
 * Reads and writes the single `settings` row.
 *
 * Settings are stored as one row so that a screen can load them in a single
 * query. `updateSettings` takes a partial object, which is what a settings
 * screen naturally produces when one switch is flipped.
 */

/**
 * Settings used before the row exists, and the values written by migration 1.
 * Keeping them in one constant means "default" can never mean two things.
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  displayName: null,
  currencyCode: DEFAULT_CURRENCY.code,
  currencySymbol: DEFAULT_CURRENCY.symbol,
  financialMonthStartDay: DEFAULT_FINANCIAL_MONTH_START_DAY,
  themePreference: 'system',
  budgetWarningThresholdPercent: DEFAULT_BUDGET_WARNING_THRESHOLD_PERCENT,
  defaultTransactionSort: 'newest',
  startingBalanceMinorUnits: 0,
  savingsOpeningBalanceMinorUnits: 0,
  onboardingCompleted: false,
};

type SettingsRow = {
  display_name: string | null;
  currency_code: string;
  currency_symbol: string;
  financial_month_start_day: number;
  theme_preference: string;
  budget_warning_threshold_percent: number;
  default_transaction_sort: string;
  starting_balance_minor_units: number;
  savings_opening_balance_minor_units: number;
  onboarding_completed: number;
};

const SELECT_SETTINGS = `
  SELECT
    display_name,
    currency_code,
    currency_symbol,
    financial_month_start_day,
    theme_preference,
    budget_warning_threshold_percent,
    default_transaction_sort,
    starting_balance_minor_units,
    savings_opening_balance_minor_units,
    onboarding_completed
  FROM settings
  WHERE id = 1;
`;

function rowToSettings(row: SettingsRow): AppSettings {
  return {
    displayName: row.display_name,
    currencyCode: row.currency_code,
    currencySymbol: row.currency_symbol,
    financialMonthStartDay: row.financial_month_start_day,
    // Casts are safe: the column CHECK constraints allow only these values.
    themePreference: row.theme_preference as AppSettings['themePreference'],
    budgetWarningThresholdPercent: row.budget_warning_threshold_percent,
    defaultTransactionSort: row.default_transaction_sort as AppSettings['defaultTransactionSort'],
    startingBalanceMinorUnits: row.starting_balance_minor_units,
    savingsOpeningBalanceMinorUnits: row.savings_opening_balance_minor_units,
    onboardingCompleted: row.onboarding_completed === 1,
  };
}

/**
 * Writes the default settings row. Called once by migration 1, and used as a
 * repair if `getSettings` ever finds the row missing.
 */
export async function insertDefaultSettingsRow(db: SQLiteDatabase): Promise<void> {
  const timestamp = nowIso();

  await db.runAsync(
    `INSERT OR IGNORE INTO settings (
       id, display_name, currency_code, currency_symbol, financial_month_start_day,
       theme_preference, budget_warning_threshold_percent, default_transaction_sort,
       starting_balance_minor_units, savings_opening_balance_minor_units,
       onboarding_completed, created_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?);`,
    [
      DEFAULT_APP_SETTINGS.displayName,
      DEFAULT_APP_SETTINGS.currencyCode,
      DEFAULT_APP_SETTINGS.currencySymbol,
      DEFAULT_APP_SETTINGS.financialMonthStartDay,
      DEFAULT_APP_SETTINGS.themePreference,
      DEFAULT_APP_SETTINGS.budgetWarningThresholdPercent,
      DEFAULT_APP_SETTINGS.defaultTransactionSort,
      DEFAULT_APP_SETTINGS.startingBalanceMinorUnits,
      DEFAULT_APP_SETTINGS.savingsOpeningBalanceMinorUnits,
      timestamp,
      timestamp,
    ]
  );
}

/** Returns the current settings, repairing the row if it is missing. */
export async function getSettings(db: SQLiteDatabase): Promise<AppSettings> {
  const row = await db.getFirstAsync<SettingsRow>(SELECT_SETTINGS);

  if (!row) {
    await insertDefaultSettingsRow(db);
    return { ...DEFAULT_APP_SETTINGS };
  }

  return rowToSettings(row);
}

/**
 * Applies a partial update and returns the stored result.
 *
 * The whole row is written each time. That is a deliberate trade: it keeps the
 * SQL static (no string-built column lists) and, at thirteen columns, the cost
 * is irrelevant. Values are validated by the column CHECK constraints, so an
 * out-of-range percentage is rejected by the database even if a screen forgets.
 */
export async function updateSettings(
  db: SQLiteDatabase,
  patch: Partial<AppSettings>
): Promise<AppSettings> {
  const next = { ...(await getSettings(db)), ...patch };

  await db.runAsync(
    `UPDATE settings SET
       display_name = ?,
       currency_code = ?,
       currency_symbol = ?,
       financial_month_start_day = ?,
       theme_preference = ?,
       budget_warning_threshold_percent = ?,
       default_transaction_sort = ?,
       starting_balance_minor_units = ?,
       savings_opening_balance_minor_units = ?,
       onboarding_completed = ?,
       updated_at = ?
     WHERE id = 1;`,
    [
      next.displayName,
      next.currencyCode,
      next.currencySymbol,
      next.financialMonthStartDay,
      next.themePreference,
      next.budgetWarningThresholdPercent,
      next.defaultTransactionSort,
      next.startingBalanceMinorUnits,
      next.savingsOpeningBalanceMinorUnits,
      next.onboardingCompleted ? 1 : 0,
      nowIso(),
    ]
  );

  return next;
}
