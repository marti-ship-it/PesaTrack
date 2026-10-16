import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Button, SegmentedControl, TextField, type SegmentOption } from '@/components/form';
import type { IoniconName } from '@/components/icon-name';
import { ScreenScaffold } from '@/components/screen-scaffold';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { getSettings, updateSettings } from '@/db/repositories/settings';
import { useThemePreference } from '@/hooks/theme-preference';
import { useTheme } from '@/hooks/use-theme';
import {
  settingsPatchFromDraft,
  validateSettingsDraft,
  type SettingsDraft,
  type SettingsErrors,
} from '@/services/settings';
import type { AppSettings, ThemePreference } from '@/types/models';
import {
  MAX_FINANCIAL_MONTH_START_DAY,
  MIN_FINANCIAL_MONTH_START_DAY,
  formatMonthLabel,
  periodMonthKey,
  todayIso,
} from '@/utils/dates';
import { getErrorMessage } from '@/utils/errors';

/**
 * Settings — the preferences that change how the whole app behaves.
 *
 * Three kinds of setting live here, and they are deliberately saved differently:
 *
 *   1. **Appearance** is applied the instant it is tapped, because the user can
 *      see the result immediately. It is written to the database by
 *      `useThemePreference`, which also rolls the screen back if the write
 *      fails — so the app can never show a theme it will not remember.
 *   2. **Financial month start day** and the **budget warning threshold** are
 *      typed, so they are validated first (`services/settings.ts`, the same
 *      rules the database's CHECK constraints encode) and saved with a button.
 *   3. **Currency** and the category list are read or managed elsewhere, so
 *      they appear as links rather than as things to type.
 *
 * The screen owns no rules of its own: it collects a `SettingsDraft` and asks
 * the pure service module what is wrong with it.
 */

/** The appearance choices, in the order they are offered. */
const APPEARANCE_OPTIONS: readonly SegmentOption<ThemePreference>[] = [
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
];

/** A tappable row that takes the user to another screen. */
function LinkRow({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  detail: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed ? styles.pressed : null]}>
      <View style={[styles.linkIcon, { backgroundColor: theme.backgroundSelected }]}>
        <Ionicons name={icon} size={20} color={theme.primary} />
      </View>
      <View style={styles.linkText}>
        <ThemedText type="default">{label}</ThemedText>
        <ThemedText type="small" themeColor="textMuted">
          {detail}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

/** One read-only "label: value" pair for the summary cards. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="default" numberOfLines={1} style={styles.detailValue}>
        {value}
      </ThemedText>
    </View>
  );
}

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { preference, setPreference } = useThemePreference();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);

  // Loaded once rather than on every focus: the two text fields hold edits the
  // user may not have saved yet, and re-reading the row would discard them.
  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const stored = await getSettings(db);
        if (isCancelled) {
          return;
        }
        setSettings(stored);
        setDraft({
          financialMonthStartDay: String(stored.financialMonthStartDay),
          budgetWarningThresholdPercent: String(stored.budgetWarningThresholdPercent),
        });
        setStatus('ready');
      } catch (loadError) {
        if (!isCancelled) {
          setError(getErrorMessage(loadError));
          setStatus('error');
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [db]);

  /** The month the current start day produces, shown so the number is concrete. */
  const currentPeriodLabel = useMemo(() => {
    if (!draft) {
      return null;
    }
    const startDay = Number(draft.financialMonthStartDay);
    if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) {
      return null;
    }
    return formatMonthLabel(periodMonthKey(todayIso(), startDay));
  }, [draft]);

  function updateDraft(patch: Partial<SettingsDraft>) {
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
    setSavedMessage(null);
    setErrors((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(patch) as (keyof SettingsDraft)[]) {
        delete next[key];
      }
      return next;
    });
  }

  async function handleAppearanceChange(next: ThemePreference) {
    setAppearanceError(null);
    setSavedMessage(null);
    try {
      await setPreference(next);
      setSavedMessage('Appearance saved.');
    } catch (appearanceFailure) {
      // `setPreference` has already restored the previous palette.
      setAppearanceError(getErrorMessage(appearanceFailure));
    }
  }

  async function handleSave() {
    if (!draft) {
      return;
    }

    const nextErrors = validateSettingsDraft(draft);
    setErrors(nextErrors);
    setSavedMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const patch = settingsPatchFromDraft(draft);
    if (!patch) {
      setErrors({ budgetWarningThresholdPercent: 'Check the values above and try again.' });
      return;
    }

    setIsSaving(true);
    try {
      const stored = await updateSettings(db, patch);
      setSettings(stored);
      setSavedMessage('Preferences saved.');
    } catch (saveError) {
      setErrors({ financialMonthStartDay: getErrorMessage(saveError) });
    } finally {
      setIsSaving(false);
    }
  }

  let body: ReactNode;

  if (status === 'loading') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  } else if (status === 'error' || !draft || !settings) {
    body = (
      <EmptyState
        title="Could not load your settings"
        message={error ?? 'Something went wrong.'}
      />
    );
  } else {
    body = (
      <>
        <Card title="APPEARANCE">
          <SegmentedControl
            options={APPEARANCE_OPTIONS}
            value={preference}
            onChange={(next) => void handleAppearanceChange(next)}
            error={appearanceError ?? undefined}
            hint="System follows your phone's light or dark setting. The choice is saved immediately."
          />
        </Card>

        <Card title="FINANCIAL MONTH">
          <TextField
            label="MONTH STARTS ON DAY"
            value={draft.financialMonthStartDay}
            onChangeText={(financialMonthStartDay) => updateDraft({ financialMonthStartDay })}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={2}
            placeholder="1"
            error={errors.financialMonthStartDay}
            hint={`A whole number from ${MIN_FINANCIAL_MONTH_START_DAY} to ${MAX_FINANCIAL_MONTH_START_DAY}. Use the 25th if your money arrives late in the month.`}
          />
          {currentPeriodLabel ? (
            <ThemedText type="small" themeColor="textMuted">
              {`Today falls in ${currentPeriodLabel}. Budgets and reports follow this month.`}
            </ThemedText>
          ) : null}

          <TextField
            label="WARN AT % OF BUDGET"
            value={draft.budgetWarningThresholdPercent}
            onChangeText={(budgetWarningThresholdPercent) =>
              updateDraft({ budgetWarningThresholdPercent })
            }
            keyboardType="number-pad"
            inputMode="numeric"
            error={errors.budgetWarningThresholdPercent}
            hint="Budgets are highlighted once spending reaches this share of the limit."
          />

          <Button label="Save settings" onPress={() => void handleSave()} loading={isSaving} />

          {savedMessage ? (
            <ThemedText type="small" themeColor="income">
              {savedMessage}
            </ThemedText>
          ) : null}
        </Card>

        <Card title="WHAT THESE NUMBERS DO">
          <DetailRow
            label="Financial month starts"
            value={`Day ${draft.financialMonthStartDay || '—'}`}
          />
          <DetailRow
            label="This period"
            value={currentPeriodLabel ?? 'Not a valid start day yet'}
          />
          <DetailRow
            label="Budget warning at"
            value={`${draft.budgetWarningThresholdPercent || '—'}%`}
          />
          <ThemedText type="small" themeColor="textMuted">
            The financial month affects budgets and reports. Transactions keep the date you gave
            them; only the grouping changes.
          </ThemedText>
        </Card>

        <Card title="CURRENCY">
          <DetailRow label="Code" value={settings.currencyCode} />
          <DetailRow label="Symbol" value={settings.currencySymbol} />
          <ThemedText type="small" themeColor="textMuted">
            All amounts are recorded in this currency. Choosing a different one is planned for a
            later milestone.
          </ThemedText>
        </Card>

        <Card title="CATEGORIES">
          <LinkRow
            icon="pricetags-outline"
            label="Manage categories"
            detail="Rename, retire or add income, expense and saving categories."
            onPress={() => router.push('/categories')}
          />
        </Card>

        <Card title="DATA STORAGE">
          <ThemedText type="small" themeColor="textSecondary">
            PesaTrack keeps your records on this device only. There is no account, no server, and
            no internet connection required.
          </ThemedText>
        </Card>

        <Card title="ABOUT">
          <ThemedText type="default">PesaTrack</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            A personal finance, budgeting and savings tracker made for Kenya. Amounts are shown in
            Kenyan Shillings (KSh).
          </ThemedText>
        </Card>
      </>
    );
  }

  return (
    <ScreenScaffold title="Settings" subtitle="Preferences and categories.">
      {body}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  center: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    flex: 1,
    gap: Spacing.half,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  detailValue: {
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
