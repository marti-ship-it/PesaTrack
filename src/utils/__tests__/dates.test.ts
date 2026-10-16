import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  formatDateLabel,
  formatDateWithWeekday,
  formatMonthLabel,
  formatShortMonthLabel,
  isWithinRange,
  isValidIsoDate,
  monthRange,
  parseIsoDate,
  periodMonthKey,
  toIsoDate,
  todayIso,
} from '../dates';

describe('calendar helpers', () => {
  it('knows the length of each month, including leap years', () => {
    expect(daysInMonth(2026, 0)).toBe(31);
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2024, 1)).toBe(29); // 2024 is a leap year
    expect(daysInMonth(2000, 1)).toBe(29); // divisible by 400
    expect(daysInMonth(1900, 1)).toBe(28); // divisible by 100 but not 400
  });

  it('parses a date as local midnight, never UTC', () => {
    // `new Date("2026-10-15")` is UTC midnight, which is the 14th or 15th
    // depending on the time zone. Parsing by hand must always give the 15th.
    const parsed = parseIsoDate('2026-10-15');
    expect(parsed).not.toBeNull();
    expect(parsed?.getDate()).toBe(15);
    expect(parsed?.getMonth()).toBe(9);
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getHours()).toBe(0);
  });

  it('round-trips a local date through toIsoDate', () => {
    for (const date of ['2026-01-01', '2026-02-28', '2026-12-31', '2024-02-29']) {
      expect(toIsoDate(parseIsoDate(date) as Date)).toBe(date);
    }
  });

  it('rejects impossible and malformed dates', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('2026-00-10')).toBeNull();
    expect(parseIsoDate('2026-1-5')).toBeNull(); // must be zero-padded
    expect(parseIsoDate('15/10/2026')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
    expect(isValidIsoDate('2026-10-15')).toBe(true);
    expect(isValidIsoDate('2026-10-32')).toBe(false);
  });

  it('gives today as a local date', () => {
    expect(todayIso()).toBe(toIsoDate(new Date()));
    expect(isValidIsoDate(todayIso())).toBe(true);
  });

  it('shifts days across month and year boundaries', () => {
    expect(addDays('2026-10-15', 1)).toBe('2026-10-16');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('counts whole days between dates', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-10-31', '2026-10-01')).toBe(-30);
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(0);
    expect(daysBetween('2026-10-01', '2026-13-01')).toBeNull();
  });

  it('shifts months, rolling the year over', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-10', 0)).toBe('2026-10');
    expect(addMonths('nonsense', 1)).toBe('nonsense');
  });
});

describe('financial months', () => {
  it('treats a start day of 1 as the calendar month', () => {
    expect(monthRange('2026-10')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });

  it('honours a custom start day', () => {
    // "October's money" runs 25 Oct – 24 Nov for this user.
    expect(monthRange('2026-10', 25)).toEqual({ start: '2026-10-25', end: '2026-11-24' });
  });

  it('rolls the end date into the next year in December', () => {
    expect(monthRange('2026-12', 25)).toEqual({ start: '2026-12-25', end: '2027-01-24' });
  });

  it('rejects an invalid month key', () => {
    expect(monthRange('2026-13')).toBeNull();
    expect(monthRange('202610')).toBeNull();
  });

  it('assigns a date to the period that contains it', () => {
    // With a start day of 25, 10 Nov belongs to the period that began 25 Oct.
    expect(periodMonthKey('2026-11-10', 25)).toBe('2026-10');
    expect(periodMonthKey('2026-11-25', 25)).toBe('2026-11');
    expect(periodMonthKey('2026-10-24', 25)).toBe('2026-09');
    // The default start day is simply the calendar month.
    expect(periodMonthKey('2026-10-15')).toBe('2026-10');
  });

  it('tests membership of a range inclusively', () => {
    const range = monthRange('2026-10')!;
    expect(isWithinRange('2026-10-01', range)).toBe(true);
    expect(isWithinRange('2026-10-31', range)).toBe(true);
    expect(isWithinRange('2026-11-01', range)).toBe(false);
    expect(isWithinRange('2026-09-30', range)).toBe(false);
  });
});

describe('display formatting', () => {
  it('formats dates for reading', () => {
    expect(formatDateLabel('2026-10-15')).toBe('15 Oct 2026');
    // 15 Oct 2026 is a Thursday.
    expect(formatDateWithWeekday('2026-10-15')).toBe('Thursday, 15 Oct 2026');
    expect(formatDateLabel('not-a-date')).toBe('');
  });

  it('formats month keys for reading', () => {
    expect(formatMonthLabel('2026-10')).toBe('October 2026');
    expect(formatMonthLabel('2026-01')).toBe('January 2026');
    expect(formatShortMonthLabel('2026-10')).toBe('Oct 2026');
    expect(formatMonthLabel('nonsense')).toBe('');
  });
});
