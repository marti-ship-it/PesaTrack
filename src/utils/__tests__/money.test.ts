import {
  formatMinorUnits,
  formatSignedMinorUnits,
  isValidMinorUnits,
  minorUnitsToDecimalString,
  minorUnitsToInputString,
  parseAmountToMinorUnits,
  percentageOf,
  sumMinorUnits,
} from '../money';

describe('parseAmountToMinorUnits', () => {
  it('parses whole shillings', () => {
    expect(parseAmountToMinorUnits('1250')).toBe(125000);
  });

  it('parses an amount with a thousands separator', () => {
    expect(parseAmountToMinorUnits('1,250.50')).toBe(125050);
    expect(parseAmountToMinorUnits('1,250,000')).toBe(125000000);
  });

  it('treats one decimal place as tens of cents', () => {
    // "1250.5" means 1250 shillings and 50 cents, not 5 cents.
    expect(parseAmountToMinorUnits('1250.5')).toBe(125050);
  });

  it('parses small amounts', () => {
    expect(parseAmountToMinorUnits('0.05')).toBe(5);
    expect(parseAmountToMinorUnits('.5')).toBeNull(); // leading digit required
  });

  it('ignores surrounding spaces', () => {
    expect(parseAmountToMinorUnits('  250  ')).toBe(25000);
  });

  it('rejects empty input', () => {
    expect(parseAmountToMinorUnits('')).toBeNull();
    expect(parseAmountToMinorUnits('   ')).toBeNull();
  });

  it('rejects more than two decimal places rather than rounding', () => {
    // Silently turning 12.345 into 12.35 would lose the user's money.
    expect(parseAmountToMinorUnits('12.345')).toBeNull();
  });

  it('rejects letters, symbols and stray separators', () => {
    expect(parseAmountToMinorUnits('abc')).toBeNull();
    expect(parseAmountToMinorUnits('KSh 500')).toBeNull();
    expect(parseAmountToMinorUnits('1.2.3')).toBeNull();
    expect(parseAmountToMinorUnits('1,25')).toBeNull();
  });

  it('rejects negative input, because direction comes from the type', () => {
    expect(parseAmountToMinorUnits('-50')).toBeNull();
  });

  it('round-trips through the display formatter', () => {
    for (const minorUnits of [0, 5, 999, 125050, 123456789]) {
      const text = formatMinorUnits(minorUnits, { symbol: '' });
      expect(parseAmountToMinorUnits(text)).toBe(minorUnits);
    }
  });
});

describe('formatMinorUnits', () => {
  it('formats with the Kenyan shilling symbol by default', () => {
    expect(formatMinorUnits(125050)).toBe('KSh 1,250.50');
    expect(formatMinorUnits(0)).toBe('KSh 0.00');
    expect(formatMinorUnits(5)).toBe('KSh 0.05');
  });

  it('groups thousands', () => {
    expect(formatMinorUnits(1250500)).toBe('KSh 12,505.00');
    expect(formatMinorUnits(100000000)).toBe('KSh 1,000,000.00');
  });

  it('handles negatives', () => {
    expect(formatMinorUnits(-125050)).toBe('-KSh 1,250.50');
  });

  it('can omit the symbol, the decimals, or both', () => {
    expect(formatMinorUnits(125050, { symbol: '' })).toBe('1,250.50');
    expect(formatMinorUnits(125050, { hideDecimals: true })).toBe('KSh 1,250');
  });

  it('can force an explicit sign', () => {
    expect(formatSignedMinorUnits(45000)).toBe('+KSh 450.00');
    expect(formatSignedMinorUnits(-45000)).toBe('-KSh 450.00');
  });
});

describe('minorUnitsToDecimalString and minorUnitsToInputString', () => {
  it('produces a plain decimal for exports', () => {
    expect(minorUnitsToDecimalString(125050)).toBe('1250.50');
    expect(minorUnitsToDecimalString(0)).toBe('0.00');
    expect(minorUnitsToDecimalString(-5)).toBe('-0.05');
  });

  it('drops a trailing .00 for editing', () => {
    expect(minorUnitsToInputString(125000)).toBe('1250');
    expect(minorUnitsToInputString(125050)).toBe('1250.50');
  });
});

describe('arithmetic helpers', () => {
  it('sums exactly, where floating point would drift', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; 10 + 20 === 30 in minor units.
    expect(sumMinorUnits([10, 20])).toBe(30);
    expect(sumMinorUnits([])).toBe(0);
    expect(sumMinorUnits([125050, 74950])).toBe(200000);
  });

  it('returns null for a percentage of zero instead of dividing by zero', () => {
    expect(percentageOf(0, 0)).toBeNull();
    expect(percentageOf(5000, 0)).toBeNull();
  });

  it('computes a percentage of a budget', () => {
    expect(percentageOf(5000, 10000)).toBe(50);
    expect(percentageOf(10000, 10000)).toBe(100);
  });

  it('recognises usable amounts only', () => {
    expect(isValidMinorUnits(0)).toBe(true);
    expect(isValidMinorUnits(125050)).toBe(true);
    expect(isValidMinorUnits(-1)).toBe(false);
    expect(isValidMinorUnits(1.5)).toBe(false);
    expect(isValidMinorUnits('100')).toBe(false);
  });
});
