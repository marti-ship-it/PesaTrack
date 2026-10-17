import type { SQLiteDatabase } from 'expo-sqlite';

import {
  contributionsByGoal,
  contributedMinorUnitsForGoal,
  getSavingsGoalById,
  listSavingsGoals,
} from '@/db/repositories/savings-goals';
import { getSettings } from '@/db/repositories/settings';
import type { SavingsGoal } from '@/types/models';
import {
  daysBetween,
  formatDateLabel,
  isValidIsoDate,
  todayIso,
} from '@/utils/dates';
import {
  minorUnitsToInputString,
  parseAmountToMinorUnits,
  percentageOf,
  sumMinorUnits,
} from '@/utils/money';

/**
 * The rules behind the savings goals screens.
 *
 * The important idea, decided in the schema and repeated here: **a contribution
 * is not a row of its own**. Paying money into a goal records an ordinary
 * `saving` transaction with `savingsGoalId` set. So a goal's balance is always
 * derived — its opening balance plus the net of its linked transactions — and
 * there is no second place where the same money could be counted.
 *
 * Everything that can be decided without a database lives in this module
 * (`goalProgress`, `validateSavingsGoalDraft`, `withdrawalError`), so the
 * awkward cases — a goal already past its target, a withdrawal larger than the
 * balance, a duplicate name — are testable without a phone. Only
 * `getSavingsGoalsData` touches the database.
 */

/** Matches the schema's `length(trim(name)) BETWEEN 1 AND 60`. */
export const MAX_GOAL_NAME_LENGTH = 60;

/** What the goal form collects, as the user typed it. */
export type SavingsGoalDraft = {
  name: string;
  /** Target amount, typed. */
  targetAmount: string;
  /** Money already saved before PesaTrack, typed. Blank means none. */
  openingBalance: string;
  /** Optional target date, `YYYY-MM-DD`. Blank means none. */
  targetDate: string;
};

/** One message per field, keyed by the draft's own field names. */
export type SavingsGoalErrors = Partial<Record<keyof SavingsGoalDraft, string>>;

/** A goal's progress, derived from its own row and its contributions. */
export type GoalProgress = {
  /** Opening balance plus the net of the linked saving transactions. */
  savedMinorUnits: number;
  targetMinorUnits: number;
  /** What is still needed. Never negative: a reached goal needs nothing. */
  remainingMinorUnits: number;
  /** How far past the target the goal has gone; `0` until it is reached. */
  surplusMinorUnits: number;
  /** May exceed 100, which is meaningful ("saved 20% more than planned"). */
  percentOfTarget: number;
  /** Fraction for the progress bar, clamped to `0`..`1`. */
  progress: number;
  isReached: boolean;
};

export function createEmptyGoalDraft(): SavingsGoalDraft {
  return { name: '', targetAmount: '', openingBalance: '', targetDate: '' };
}

/** Fills the form from a saved goal, so editing starts from the real values. */
export function savingsGoalDraftFrom(goal: SavingsGoal): SavingsGoalDraft {
  return {
    name: goal.name,
    targetAmount: minorUnitsToInputString(goal.targetMinorUnits),
    openingBalance:
      goal.openingBalanceMinorUnits === 0
        ? ''
        : minorUnitsToInputString(goal.openingBalanceMinorUnits),
    targetDate: goal.targetDate ?? '',
  };
}

/**
 * How much money a goal holds, and how far along it is.
 *
 * `saved` can in principle be negative — deleting a contribution after
 * withdrawing it is the only way — so the bar is clamped to zero rather than
 * drawing to the left of its track, and `remaining` is never allowed below zero
 * the way "you have more left than you budgeted" is allowed elsewhere: a goal is
 * either short of its target or has passed it.
 */
export function goalProgress(
  goal: Pick<SavingsGoal, 'targetMinorUnits' | 'openingBalanceMinorUnits'>,
  contributedMinorUnits: number
): GoalProgress {
  const savedMinorUnits = goal.openingBalanceMinorUnits + contributedMinorUnits;
  const targetMinorUnits = goal.targetMinorUnits;
  const percentOfTarget = percentageOf(savedMinorUnits, targetMinorUnits) ?? 0;

  return {
    savedMinorUnits,
    targetMinorUnits,
    remainingMinorUnits: Math.max(0, targetMinorUnits - savedMinorUnits),
    surplusMinorUnits: Math.max(0, savedMinorUnits - targetMinorUnits),
    percentOfTarget,
    progress: Math.min(1, Math.max(0, percentOfTarget / 100)),
    isReached: savedMinorUnits >= targetMinorUnits,
  };
}

/** A goal plus everything the screens need to draw it. */
export type GoalSummary = GoalProgress & {
  goal: SavingsGoal;
  /** Net of the linked saving transactions, before the opening balance. */
  contributedMinorUnits: number;
};

export function buildGoalSummary(goal: SavingsGoal, contributedMinorUnits: number): GoalSummary {
  return {
    goal,
    contributedMinorUnits,
    ...goalProgress(goal, contributedMinorUnits),
  };
}

export type GoalsTotals = {
  goalCount: number;
  /** Money held in goals. Counts archived goals too — the money is still saved. */
  savedMinorUnits: number;
  /** Sum of every goal's target. */
  targetMinorUnits: number;
};

export function buildGoalsTotals(summaries: readonly GoalSummary[]): GoalsTotals {
  return {
    goalCount: summaries.length,
    savedMinorUnits: sumMinorUnits(summaries.map((summary) => summary.savedMinorUnits)),
    targetMinorUnits: sumMinorUnits(summaries.map((summary) => summary.targetMinorUnits)),
  };
}

/**
 * The one goal the dashboard card highlights: the active goal closest to its
 * target.
 *
 * "Closest" is measured by how much of the target is already saved, not by the
 * target date, because a date is optional and a goal without one still deserves
 * to appear. Ties fall back to the name, so the card does not reshuffle itself
 * between reloads.
 */
export function pickFeaturedGoal(summaries: readonly GoalSummary[]): GoalSummary | null {
  const candidates = summaries.filter((summary) => !summary.goal.isArchived);
  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((best, current) => {
    if (current.progress !== best.progress) {
      return current.progress > best.progress ? current : best;
    }
    return current.goal.name.localeCompare(best.goal.name) < 0 ? current : best;
  });
}

/** Rejects a blank, over-long or already-used name. */
export function goalNameError(
  name: string,
  existingGoals: readonly SavingsGoal[] = [],
  currentGoalId: string | null = null
): string | null {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return 'Give the goal a name, for example Emergency fund.';
  }
  if (trimmed.length > MAX_GOAL_NAME_LENGTH) {
    return `Keep the name to ${MAX_GOAL_NAME_LENGTH} characters or fewer.`;
  }

  // Compared case- and space-insensitively so "Emergency Fund" and
  // "emergency fund" are recognised as the same goal. Unlike categories, the
  // database has no unique index here, so this check is a courtesy rather than
  // a constraint — it keeps a list of goals readable.
  const normalised = trimmed.toLowerCase();
  const clash = existingGoals.some(
    (goal) => !goal.isArchived && goal.id !== currentGoalId && goal.name.trim().toLowerCase() === normalised
  );

  return clash ? `You already have a goal called "${trimmed}".` : null;
}

/** The target must be a real amount greater than zero. */
export function goalTargetAmountError(targetAmount: string): string | null {
  const parsed = parseAmountToMinorUnits(targetAmount);

  if (parsed === null) {
    return 'Enter an amount, for example 50000.';
  }
  return parsed > 0 ? null : 'The target must be more than zero.';
}

/** An opening balance is optional, but a typed one must be usable. */
export function goalOpeningBalanceError(openingBalance: string): string | null {
  if (openingBalance.trim().length === 0) {
    return null;
  }

  const parsed = parseAmountToMinorUnits(openingBalance);
  if (parsed === null) {
    return 'Enter an amount, for example 2000, or leave this blank.';
  }
  return null;
}

/** A target date is optional, but a typed one must be a real date. */
export function goalTargetDateError(targetDate: string): string | null {
  if (targetDate.trim().length === 0) {
    return null;
  }
  return isValidIsoDate(targetDate.trim())
    ? null
    : 'Enter the date as YYYY-MM-DD, for example 2026-12-31.';
}

/**
 * Validates the whole form.
 *
 * Every field is checked even when an earlier one failed, so all the problems
 * appear at once instead of one per attempt.
 */
export function validateSavingsGoalDraft(
  draft: SavingsGoalDraft,
  options: {
    existingGoals?: readonly SavingsGoal[];
    currentGoalId?: string | null;
  } = {}
): SavingsGoalErrors {
  const errors: SavingsGoalErrors = {};

  const nameError = goalNameError(draft.name, options.existingGoals, options.currentGoalId ?? null);
  if (nameError) {
    errors.name = nameError;
  }

  const targetError = goalTargetAmountError(draft.targetAmount);
  if (targetError) {
    errors.targetAmount = targetError;
  }

  const openingError = goalOpeningBalanceError(draft.openingBalance);
  if (openingError) {
    errors.openingBalance = openingError;
  }

  const dateError = goalTargetDateError(draft.targetDate);
  if (dateError) {
    errors.targetDate = dateError;
  }

  return errors;
}

/** What the repository needs, once the draft is known to be usable. */
export type SavingsGoalPatch = {
  name: string;
  targetMinorUnits: number;
  openingBalanceMinorUnits: number;
  targetDate: string | null;
};

/**
 * Turns a validated draft into stored values.
 *
 * Returns `null` rather than a half-built goal when anything is unusable, so a
 * caller can never save a target but forget the name.
 */
export function goalPatchFromDraft(
  draft: SavingsGoalDraft,
  options: {
    existingGoals?: readonly SavingsGoal[];
    currentGoalId?: string | null;
  } = {}
): SavingsGoalPatch | null {
  const errors = validateSavingsGoalDraft(draft, options);
  if (Object.keys(errors).length > 0) {
    return null;
  }

  const targetMinorUnits = parseAmountToMinorUnits(draft.targetAmount);
  const openingBalanceMinorUnits =
    draft.openingBalance.trim().length === 0 ? 0 : parseAmountToMinorUnits(draft.openingBalance);

  if (targetMinorUnits === null || openingBalanceMinorUnits === null) {
    return null;
  }

  return {
    name: draft.name.trim(),
    targetMinorUnits,
    openingBalanceMinorUnits,
    targetDate: draft.targetDate.trim().length === 0 ? null : draft.targetDate.trim(),
  };
}

/**
 * Refuses a withdrawal larger than the money the goal actually holds.
 *
 * Without this the balance could go negative, which would be shown as a goal
 * with "negative saved" — a state that has no meaning in the real world.
 */
export function withdrawalError(
  amountMinorUnits: number,
  availableMinorUnits: number
): string | null {
  if (amountMinorUnits <= 0) {
    return 'Enter an amount to withdraw.';
  }
  if (amountMinorUnits > availableMinorUnits) {
    return 'That is more than this goal holds.';
  }
  return null;
}

/** A short, human sentence about the optional target date. */
export function goalTargetDateHint(targetDate: string | null, today: string = todayIso()): string | null {
  if (!targetDate || !isValidIsoDate(targetDate)) {
    return null;
  }

  const days = daysBetween(today, targetDate);
  if (days === null) {
    return null;
  }

  if (days < 0) {
    return `Was due ${formatDateLabel(targetDate)}.`;
  }
  if (days === 0) {
    return `Due today, ${formatDateLabel(targetDate)}.`;
  }
  if (days === 1) {
    return `Due tomorrow, ${formatDateLabel(targetDate)}.`;
  }
  return `Due in ${days} days, on ${formatDateLabel(targetDate)}.`;
}

/** Everything the savings screens load in one go. */
export type SavingsGoalsData = {
  /** Goals still in use, in the order they were created. */
  active: GoalSummary[];
  /** Goals the user has finished with, oldest first. */
  archived: GoalSummary[];
  /** Over **every** goal, so the money saved is never under-reported. */
  totals: GoalsTotals;
  currencySymbol: string;
};

/**
 * Loads the goals, their balances and the currency in one go.
 *
 * The contributions map is fetched in a single grouped query rather than one
 * query per goal, so the work does not grow with the number of goals.
 */
export async function getSavingsGoalsData(db: SQLiteDatabase): Promise<SavingsGoalsData> {
  const [goals, contributions, settings] = await Promise.all([
    listSavingsGoals(db, { includeArchived: true }),
    contributionsByGoal(db),
    getSettings(db),
  ]);

  const summaries = goals.map((goal) => buildGoalSummary(goal, contributions[goal.id] ?? 0));

  return {
    active: summaries.filter((summary) => !summary.goal.isArchived),
    archived: summaries.filter((summary) => summary.goal.isArchived),
    totals: buildGoalsTotals(summaries),
    currencySymbol: settings.currencySymbol,
  };
}

/** Loads one goal with its progress, for the goal detail screen. */
export async function getGoalSummaryById(
  db: SQLiteDatabase,
  id: string
): Promise<GoalSummary | null> {
  const [goal, contributed] = await Promise.all([
    getSavingsGoalById(db, id),
    contributedMinorUnitsForGoal(db, id),
  ]);

  return goal ? buildGoalSummary(goal, contributed) : null;
}

/**
 * The message shown for a withdrawal that is too large.
 *
 * Separate from `withdrawalError` so the screen can show the actual balance
 * without inventing the wording itself.
 */
export function withdrawalLimitMessage(availableMinorUnits: number): string {
  return `You can withdraw up to ${minorUnitsToInputString(availableMinorUnits)} from this goal.`;
}
