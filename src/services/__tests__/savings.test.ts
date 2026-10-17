import type { SavingsGoal } from '@/types/models';

import {
  MAX_GOAL_NAME_LENGTH,
  buildGoalSummary,
  buildGoalsTotals,
  createEmptyGoalDraft,
  goalNameError,
  goalOpeningBalanceError,
  goalPatchFromDraft,
  goalProgress,
  goalTargetAmountError,
  goalTargetDateError,
  goalTargetDateHint,
  pickFeaturedGoal,
  savingsGoalDraftFrom,
  validateSavingsGoalDraft,
  withdrawalError,
  type SavingsGoalDraft,
} from '../savings';

/**
 * The savings-goal rules, tested without a database or a phone.
 *
 * Two ideas run through these tests:
 *
 *   1. **A goal's balance is derived, never typed.** It is the opening balance
 *      plus the net of its linked saving transactions, so the arithmetic is the
 *      part worth pinning down: contributions in, withdrawals out, and what
 *      "reached" means once the target is passed.
 *   2. **The schema and the form agree.** The 60-character name and the
 *      "target greater than zero" rule are also `CHECK` constraints; these tests
 *      cover the half that tells the user *before* the database refuses.
 */

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: 'goal-1',
    name: 'Emergency fund',
    targetMinorUnits: 5000000,
    openingBalanceMinorUnits: 0,
    targetDate: null,
    isArchived: false,
    sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function draft(overrides: Partial<SavingsGoalDraft> = {}): SavingsGoalDraft {
  return {
    name: 'Emergency fund',
    targetAmount: '50000',
    openingBalance: '',
    targetDate: '',
    ...overrides,
  };
}

describe('createEmptyGoalDraft', () => {
  it('starts blank rather than pre-filled with a guess', () => {
    expect(createEmptyGoalDraft()).toEqual({
      name: '',
      targetAmount: '',
      openingBalance: '',
      targetDate: '',
    });
  });
});

describe('savingsGoalDraftFrom', () => {
  it('shows the target without a trailing .00 so it can be edited', () => {
    expect(savingsGoalDraftFrom(goal({ targetMinorUnits: 5000000 })).targetAmount).toBe('50000');
  });

  it('leaves the opening balance blank when there is none', () => {
    // Blank rather than "0", so the optional field reads as optional.
    expect(savingsGoalDraftFrom(goal()).openingBalance).toBe('');
  });

  it('carries a real opening balance and target date through', () => {
    const filled = savingsGoalDraftFrom(
      goal({ openingBalanceMinorUnits: 250050, targetDate: '2026-12-31' })
    );

    expect(filled.openingBalance).toBe('2500.50');
    expect(filled.targetDate).toBe('2026-12-31');
  });
});

describe('goalProgress', () => {
  it('starts empty when nothing has been saved and nothing was carried over', () => {
    const progress = goalProgress(goal(), 0);

    expect(progress.savedMinorUnits).toBe(0);
    expect(progress.remainingMinorUnits).toBe(5000000);
    expect(progress.percentOfTarget).toBe(0);
    expect(progress.progress).toBe(0);
    expect(progress.isReached).toBe(false);
  });

  it('counts money saved before PesaTrack towards the goal', () => {
    const progress = goalProgress(goal({ openingBalanceMinorUnits: 1000000 }), 250000);

    expect(progress.savedMinorUnits).toBe(1250000);
    expect(progress.remainingMinorUnits).toBe(3750000);
    expect(progress.percentOfTarget).toBe(25);
  });

  it('subtracts a withdrawal, because money left the goal', () => {
    // Refunds taught the same lesson: direction is part of the record, so a
    // withdrawal must reduce the balance rather than be ignored.
    const progress = goalProgress(goal(), 500000 - 200000);

    expect(progress.savedMinorUnits).toBe(300000);
    expect(progress.remainingMinorUnits).toBe(4700000);
  });

  it('is reached exactly on the target, with nothing remaining', () => {
    const progress = goalProgress(goal({ targetMinorUnits: 100000 }), 100000);

    expect(progress.isReached).toBe(true);
    expect(progress.remainingMinorUnits).toBe(0);
    expect(progress.surplusMinorUnits).toBe(0);
    expect(progress.percentOfTarget).toBe(100);
    expect(progress.progress).toBe(1);
  });

  it('keeps counting past the target instead of pretending it stopped', () => {
    const progress = goalProgress(goal({ targetMinorUnits: 100000 }), 120000);

    expect(progress.isReached).toBe(true);
    expect(progress.surplusMinorUnits).toBe(20000);
    expect(progress.percentOfTarget).toBe(120);
    // The bar cannot draw past its own end, so the fraction is clamped...
    expect(progress.progress).toBe(1);
    // ...while the percentage still tells the truth.
    expect(progress.percentOfTarget).toBe(120);
  });

  it('clamps the bar at zero if the balance ever goes negative', () => {
    // Reachable only by deleting a contribution after withdrawing it, but a
    // bar drawn to the left of its track would be a visible bug.
    const progress = goalProgress(goal({ openingBalanceMinorUnits: 0 }), -5000);

    expect(progress.savedMinorUnits).toBe(-5000);
    expect(progress.progress).toBe(0);
    expect(progress.remainingMinorUnits).toBe(5005000);
  });
});

describe('buildGoalSummary', () => {
  it('carries the goal and its contributions alongside the progress', () => {
    const summary = buildGoalSummary(goal({ id: 'goal-9' }), 100000);

    expect(summary.goal.id).toBe('goal-9');
    expect(summary.contributedMinorUnits).toBe(100000);
    expect(summary.savedMinorUnits).toBe(100000);
  });
});

describe('buildGoalsTotals', () => {
  it('is all zeros with no goals, never null', () => {
    expect(buildGoalsTotals([])).toEqual({
      goalCount: 0,
      savedMinorUnits: 0,
      targetMinorUnits: 0,
    });
  });

  it('adds up what is saved and what is aimed for', () => {
    const totals = buildGoalsTotals([
      buildGoalSummary(goal({ id: 'a', targetMinorUnits: 100000 }), 40000),
      buildGoalSummary(goal({ id: 'b', targetMinorUnits: 250000 }), 60000),
    ]);

    expect(totals.goalCount).toBe(2);
    expect(totals.savedMinorUnits).toBe(100000);
    expect(totals.targetMinorUnits).toBe(350000);
  });
});

describe('goalNameError', () => {
  it('requires a name', () => {
    expect(goalNameError('')).toContain('name');
    expect(goalNameError('   ')).toContain('name');
  });

  it('accepts a name at the length the schema allows', () => {
    expect(goalNameError('a'.repeat(MAX_GOAL_NAME_LENGTH))).toBeNull();
  });

  it('refuses a name longer than the schema allows', () => {
    expect(goalNameError('a'.repeat(MAX_GOAL_NAME_LENGTH + 1))).toContain('60');
  });

  it('treats names as equal regardless of case and surrounding spaces', () => {
    expect(goalNameError('  emergency FUND ', [goal({ name: 'Emergency Fund' })])).not.toBeNull();
  });

  it('ignores the goal being edited, so saving without renaming works', () => {
    expect(goalNameError('Emergency fund', [goal({ id: 'goal-1' })], 'goal-1')).toBeNull();
  });

  it('lets an archived goal free its name for reuse', () => {
    expect(goalNameError('Emergency fund', [goal({ isArchived: true })])).toBeNull();
  });
});

describe('goalTargetAmountError', () => {
  it('accepts a plain amount and one with separators', () => {
    expect(goalTargetAmountError('50000')).toBeNull();
    expect(goalTargetAmountError('50,000')).toBeNull();
  });

  it('refuses a missing or unusable amount', () => {
    expect(goalTargetAmountError('')).toContain('amount');
    expect(goalTargetAmountError('abc')).toContain('amount');
  });

  it('refuses zero, because a zero target is not a goal', () => {
    expect(goalTargetAmountError('0')).toContain('more than zero');
  });
});

describe('goalOpeningBalanceError', () => {
  it('allows the field to be left blank', () => {
    expect(goalOpeningBalanceError('')).toBeNull();
    expect(goalOpeningBalanceError('  ')).toBeNull();
  });

  it('accepts a real amount', () => {
    expect(goalOpeningBalanceError('2000')).toBeNull();
  });

  it('refuses something that is not an amount', () => {
    expect(goalOpeningBalanceError('two thousand')).not.toBeNull();
  });
});

describe('goalTargetDateError', () => {
  it('allows the field to be left blank', () => {
    expect(goalTargetDateError('')).toBeNull();
  });

  it('accepts a real date', () => {
    expect(goalTargetDateError('2026-12-31')).toBeNull();
  });

  it('refuses a date that is not real', () => {
    expect(goalTargetDateError('2026-02-30')).not.toBeNull();
    expect(goalTargetDateError('31/12/2026')).not.toBeNull();
  });
});

describe('validateSavingsGoalDraft', () => {
  it('reports nothing for a usable draft', () => {
    expect(validateSavingsGoalDraft(draft())).toEqual({});
  });

  it('reports every problem at once', () => {
    const errors = validateSavingsGoalDraft(
      draft({ name: '', targetAmount: '0', openingBalance: 'abc', targetDate: '31/12/2026' })
    );

    expect(Object.keys(errors).sort()).toEqual([
      'name',
      'openingBalance',
      'targetAmount',
      'targetDate',
    ]);
  });

  it('keys each message to its own field', () => {
    const errors = validateSavingsGoalDraft(draft({ targetAmount: '0' }));

    expect(errors.targetAmount).toBeDefined();
    expect(errors.name).toBeUndefined();
  });
});

describe('goalPatchFromDraft', () => {
  it('converts a usable draft into stored values', () => {
    expect(goalPatchFromDraft(draft({ openingBalance: '2000', targetDate: '2026-12-31' }))).toEqual({
      name: 'Emergency fund',
      targetMinorUnits: 5000000,
      openingBalanceMinorUnits: 200000,
      targetDate: '2026-12-31',
    });
  });

  it('turns a blank opening balance and date into nothing', () => {
    expect(goalPatchFromDraft(draft())).toMatchObject({
      openingBalanceMinorUnits: 0,
      targetDate: null,
    });
  });

  it('never returns a half-written goal', () => {
    // A partial patch could store a target with no name, so an unusable draft
    // must produce nothing at all.
    expect(goalPatchFromDraft(draft({ name: '' }))).toBeNull();
    expect(goalPatchFromDraft(draft({ targetAmount: '' }))).toBeNull();
    expect(goalPatchFromDraft(draft({ targetDate: 'nonsense' }))).toBeNull();
  });
});

describe('withdrawalError', () => {
  it('allows a withdrawal within the balance', () => {
    expect(withdrawalError(5000, 10000)).toBeNull();
    expect(withdrawalError(10000, 10000)).toBeNull();
  });

  it('refuses more than the goal holds', () => {
    expect(withdrawalError(10001, 10000)).toContain('more than');
  });

  it('refuses nothing at all', () => {
    expect(withdrawalError(0, 10000)).not.toBeNull();
  });
});

describe('goalTargetDateHint', () => {
  it('says nothing when there is no date, or it is unusable', () => {
    expect(goalTargetDateHint(null)).toBeNull();
    expect(goalTargetDateHint('nonsense')).toBeNull();
  });

  it('counts the days left', () => {
    expect(goalTargetDateHint('2026-11-10', '2026-10-16')).toContain('25 days');
  });

  it('handles today and tomorrow in words', () => {
    expect(goalTargetDateHint('2026-10-16', '2026-10-16')).toContain('today');
    expect(goalTargetDateHint('2026-10-17', '2026-10-16')).toContain('tomorrow');
  });

  it('admits when the date has passed', () => {
    expect(goalTargetDateHint('2026-10-01', '2026-10-16')).toContain('Was due');
  });
});

describe('pickFeaturedGoal', () => {
  it('is null when there is nothing to feature', () => {
    expect(pickFeaturedGoal([])).toBeNull();
  });

  it('ignores archived goals', () => {
    expect(pickFeaturedGoal([buildGoalSummary(goal({ isArchived: true }), 4000000)])).toBeNull();
  });

  it('picks the active goal closest to its target', () => {
    const nearlyDone = buildGoalSummary(goal({ id: 'nearly', name: 'Laptop' }), 4500000);
    const farAway = buildGoalSummary(goal({ id: 'far', name: 'Car' }), 100000);

    expect(pickFeaturedGoal([farAway, nearlyDone])?.goal.id).toBe('nearly');
  });

  it('breaks a tie by name so the card is stable between reloads', () => {
    const a = buildGoalSummary(goal({ id: 'a', name: 'Airtime' }), 100000);
    const b = buildGoalSummary(goal({ id: 'b', name: 'Books' }), 100000);

    expect(pickFeaturedGoal([b, a])?.goal.id).toBe('a');
    expect(pickFeaturedGoal([a, b])?.goal.id).toBe('a');
  });
});
