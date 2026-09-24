// F-10 format rule for amounts and NF-10 formats (decimal comma, dates), client/src/lib/format.ts.
import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatIngredient,
  formatIngredientAmount,
  formatMinutes,
  formatRange,
  formatRating,
  parseAmount,
} from '../../client/src/lib/format.ts';

describe('parseAmount and formatAmount (F-10 AK)', () => {
  const cases: Array<[input: string, stored: number, shown: string]> = [
    ['1,5', 1.5, '1 ½'],
    ['1/2', 0.5, '½'],
    ['½', 0.5, '½'],
    ['0,1', 0.1, '0,1'],
    ['1,25', 1.25, '1 ¼'],
    ['2,4', 2.4, '2,4'],
  ];

  it.each(cases)('"%s" → stored %d, shown "%s"', (input, stored, shown) => {
    const parsed = parseAmount(input);
    expect(parsed).toEqual({ amount: stored, amountMax: null });
    expect(formatAmount(stored)).toBe(shown);
  });

  it('"1/3" → 0.3333… and "⅓"', () => {
    const parsed = parseAmount('1/3');
    expect(parsed?.amount).toBeCloseTo(0.3333, 4);
    expect(parsed?.amountMax).toBeNull();
    expect(formatAmount(parsed?.amount ?? 0)).toBe('⅓');
  });

  it('"2–3" and "2-3" → amount 2, amountMax 3, shown "2–3"', () => {
    expect(parseAmount('2–3')).toEqual({ amount: 2, amountMax: 3 });
    expect(parseAmount('2-3')).toEqual({ amount: 2, amountMax: 3 });
    expect(parseAmount('2 - 3')).toEqual({ amount: 2, amountMax: 3 });
    expect(formatRange(2, 3)).toBe('2–3');
  });
});

describe('formatAmount', () => {
  it('shows ¼ ⅓ ½ ⅔ ¾ as glyphs, with the whole part as "1 ½"', () => {
    expect(formatAmount(0.25)).toBe('¼');
    expect(formatAmount(1 / 3)).toBe('⅓');
    expect(formatAmount(0.5)).toBe('½');
    expect(formatAmount(2 / 3)).toBe('⅔');
    expect(formatAmount(0.75)).toBe('¾');
    expect(formatAmount(2.5)).toBe('2 ½');
    expect(formatAmount(3.75)).toBe('3 ¾');
  });

  it('applies the 0.01 tolerance', () => {
    expect(formatAmount(0.33)).toBe('⅓');
    expect(formatAmount(0.67)).toBe('⅔');
    expect(formatAmount(1.26)).toBe('1 ¼');
    expect(formatAmount(0.7)).toBe('0,7');
    expect(formatAmount(0.3)).toBe('0,3');
  });

  it('uses a decimal comma with at most two decimals', () => {
    expect(formatAmount(200)).toBe('200');
    expect(formatAmount(2.4)).toBe('2,4');
    expect(formatAmount(0.125)).toBe('0,13');
    expect(formatAmount(1.999)).toBe('2');
    expect(formatAmount(0)).toBe('0');
  });

  it('formatDecimal keeps the requested digits without trailing zeros', () => {
    expect(formatDecimal(2.4)).toBe('2,4');
    expect(formatDecimal(10)).toBe('10');
    expect(formatDecimal(1.005, 1)).toBe('1');
  });
});

describe('parseAmount', () => {
  it('accepts dot, comma, glyphs, mixed numbers and fractions', () => {
    expect(parseAmount('1.5')).toEqual({ amount: 1.5, amountMax: null });
    expect(parseAmount('1 ½')).toEqual({ amount: 1.5, amountMax: null });
    expect(parseAmount('1½')).toEqual({ amount: 1.5, amountMax: null });
    expect(parseAmount('1 1/2')).toEqual({ amount: 1.5, amountMax: null });
    expect(parseAmount('⅛')).toEqual({ amount: 0.125, amountMax: null });
    expect(parseAmount(',5')).toEqual({ amount: 0.5, amountMax: null });
    expect(parseAmount('  400 ')).toEqual({ amount: 400, amountMax: null });
    expect(parseAmount('½–1')).toEqual({ amount: 0.5, amountMax: 1 });
  });

  it('reads German thousands separators, keeps the comma as decimal separator (NF-10)', () => {
    expect(parseAmount('1.000')).toEqual({ amount: 1000, amountMax: null });
    expect(parseAmount('12.500')).toEqual({ amount: 12500, amountMax: null });
    expect(parseAmount('1.250.000')).toEqual({ amount: 1250000, amountMax: null });
    expect(parseAmount('1.000–1.500')).toEqual({ amount: 1000, amountMax: 1500 });
    expect(parseAmount('1.000,5')).toEqual({ amount: 1000.5, amountMax: null });
    // Not exactly three digits per group, or a leading zero: a decimal point as before.
    expect(parseAmount('1.5')).toEqual({ amount: 1.5, amountMax: null });
    expect(parseAmount('1.50')).toEqual({ amount: 1.5, amountMax: null });
    expect(parseAmount('1.0000')).toEqual({ amount: 1, amountMax: null });
    expect(parseAmount('0.500')).toEqual({ amount: 0.5, amountMax: null });
    expect(parseAmount('1,000')).toEqual({ amount: 1, amountMax: null });
    expect(parseAmount('1.000.5')).toBeNull();
  });

  it('treats empty input as "no amount"', () => {
    expect(parseAmount('')).toEqual({ amount: null, amountMax: null });
    expect(parseAmount('   ')).toEqual({ amount: null, amountMax: null });
  });

  it('rejects unreadable input and invalid ranges', () => {
    expect(parseAmount('etwas')).toBeNull();
    expect(parseAmount('1/0')).toBeNull();
    expect(parseAmount('3-2')).toBeNull();
    expect(parseAmount('2-2')).toBeNull();
    expect(parseAmount('-1')).toBeNull();
    expect(parseAmount('1,2,3')).toBeNull();
  });
});

describe('ingredients (F-10 AK)', () => {
  it('shows "200 g Mehl, gesiebt"', () => {
    expect(formatIngredient({ amount: 200, amountMax: null, unit: 'g', name: 'Mehl', note: 'gesiebt' })).toBe(
      '200 g Mehl, gesiebt',
    );
  });

  it('shows "Salz" without leading spaces when amount and unit are missing', () => {
    expect(formatIngredient({ amount: null, amountMax: null, unit: '', name: 'Salz', note: '' })).toBe(
      'Salz',
    );
    expect(formatIngredientAmount(null, null, '')).toBe('');
  });

  it('formats ranges and fractions inside the line', () => {
    expect(formatIngredient({ amount: 2, amountMax: 3, unit: 'EL', name: 'Olivenöl', note: '' })).toBe(
      '2–3 EL Olivenöl',
    );
    expect(formatIngredientAmount(1.5, null, 'Tassen')).toBe('1 ½ Tassen');
  });
});

describe('formatMinutes and formatRating', () => {
  it('always shows whole minutes, also from an hour on (artboards: "60 min", "90 min")', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('60 min');
    expect(formatMinutes(90)).toBe('90 min');
    expect(formatMinutes(125)).toBe('125 min');
    expect(formatMinutes(29.6)).toBe('30 min');
    expect(formatMinutes(-5)).toBe('0 min');
  });

  it('shows the average with one decimal and a comma (F-27: "Ø 3,0")', () => {
    expect(formatRating(3)).toBe('3,0');
    expect(formatRating(13 / 3)).toBe('4,3');
  });
});

describe('formatDate (NF-10 AK)', () => {
  // Local-time constructors keep the test independent of the machine's time zone.
  const now = new Date(2026, 8, 23, 20, 15);
  const at = (y: number, m: number, d: number, h = 12): string => new Date(y, m - 1, d, h).toISOString();

  it('shows "12.03.2026" for older dates', () => {
    expect(formatDate(at(2026, 3, 12), now)).toBe('12.03.2026');
    expect(formatDate(at(2025, 12, 1), now)).toBe('01.12.2025');
  });

  it('shows "heute", "gestern" and "vor 3 Tagen" within 7 days', () => {
    expect(formatDate(at(2026, 9, 23, 0), now)).toBe('heute');
    expect(formatDate(at(2026, 9, 22, 23), now)).toBe('gestern');
    expect(formatDate(at(2026, 9, 20), now)).toBe('vor 3 Tagen');
    expect(formatDate(at(2026, 9, 17), now)).toBe('vor 6 Tagen');
    expect(formatDate(at(2026, 9, 16), now)).toBe('16.09.2026');
  });

  it('shows future dates absolute and ignores invalid input', () => {
    expect(formatDate(at(2026, 9, 30), now)).toBe('30.09.2026');
    expect(formatDate('kein Datum', now)).toBe('');
  });

  it('adds the time for status lines (F-42: "heute, 03:00")', () => {
    expect(formatDateTime(new Date(2026, 8, 23, 3, 0).toISOString(), now)).toBe('heute, 03:00');
    expect(formatDateTime(new Date(2026, 2, 12, 9, 5).toISOString(), now)).toBe('12.03.2026, 09:05');
  });
});
