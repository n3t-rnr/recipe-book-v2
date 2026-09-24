/**
 * German number, amount, time and date formats (F-10, NF-10). Pure functions without DOM access so the
 * unit tests run in Node.
 */
import { de } from '../i18n/de.ts';

/** Fraction glyphs used for display (F-10 format rule). */
const DISPLAY_FRACTIONS: ReadonlyArray<readonly [number, string]> = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];
const FRACTION_TOLERANCE = 0.01;
/** Absorbs binary float noise at the tolerance boundary (e.g. 2.26 − 2 = 0.2599999…). */
const EPSILON = 1e-9;

/** Every vulgar fraction glyph accepted on input (U+00BC–00BE, U+2150–215E). */
const INPUT_FRACTIONS: Readonly<Record<string, number>> = {
  '¼': 1 / 4,
  '½': 1 / 2,
  '¾': 3 / 4,
  '⅐': 1 / 7,
  '⅑': 1 / 9,
  '⅒': 1 / 10,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅕': 1 / 5,
  '⅖': 2 / 5,
  '⅗': 3 / 5,
  '⅘': 4 / 5,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
};
const GLYPH = '[¼½¾⅐-⅞]';
const MIXED_GLYPH = new RegExp(`^(\\d+)\\s*(${GLYPH})$`, 'u');
const ONLY_GLYPH = new RegExp(`^(${GLYPH})$`, 'u');
const MIXED_FRACTION = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/;
const FRACTION = /^(\d+)\s*\/\s*(\d+)$/;
const DECIMAL = /^(\d*)(?:[.,](\d+))?$/;
/** German thousands separators: "1.000", "12.500", "1.250.000", "1.000,5" (not "1.5", not "0.500"). */
const THOUSANDS = /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/;
const RANGE = /^(.+?)\s*[-–—]\s*(.+)$/u;

/** Decimal comma with at most `digits` decimals, trailing zeros dropped ("2,4", "0,1", "3"). */
export function formatDecimal(n: number, digits = 2): string {
  const text = n.toFixed(digits);
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  return trimmed.replace('.', ',');
}

/**
 * Amount after the F-10 format rule: fractional parts ¼ ⅓ ½ ⅔ ¾ (±0.01) as glyphs, with the whole part
 * as "1 ½"; everything else with a decimal comma and at most two decimals.
 */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const frac = abs - whole;
  for (const [value, glyph] of DISPLAY_FRACTIONS) {
    if (Math.abs(frac - value) <= FRACTION_TOLERANCE + EPSILON) {
      return sign + (whole > 0 ? `${whole} ${glyph}` : glyph);
    }
  }
  return sign + formatDecimal(abs, 2);
}

/** "2–3" for a range, otherwise the single amount. */
export function formatRange(amount: number, amountMax: number | null): string {
  if (amountMax === null) return formatAmount(amount);
  return `${formatAmount(amount)}–${formatAmount(amountMax)}`;
}

function parseSingle(text: string): number | null {
  const s = text.trim();
  if (s === '') return null;
  let m = MIXED_GLYPH.exec(s);
  if (m) return Number(m[1]) + (INPUT_FRACTIONS[m[2] ?? ''] ?? Number.NaN);
  m = ONLY_GLYPH.exec(s);
  if (m) return INPUT_FRACTIONS[m[1] ?? ''] ?? null;
  m = MIXED_FRACTION.exec(s);
  if (m) {
    const den = Number(m[3]);
    return den === 0 ? null : Number(m[1]) + Number(m[2]) / den;
  }
  m = FRACTION.exec(s);
  if (m) {
    const den = Number(m[2]);
    return den === 0 ? null : Number(m[1]) / den;
  }
  // "1.000 g" is a thousand grams, never one gram (NF-10); the comma stays the decimal separator.
  if (THOUSANDS.test(s)) return Number(s.replaceAll('.', '').replace(',', '.'));
  m = DECIMAL.exec(s);
  if (m && (m[1] !== '' || m[2] !== undefined)) {
    return Number(`${m[1] === '' ? '0' : m[1]}.${m[2] ?? '0'}`);
  }
  return null;
}

export interface ParsedAmount {
  amount: number | null;
  amountMax: number | null;
}

/**
 * Parses an amount field: "1,5", "1.5", "1/2", "½", "1 ½", "1 1/2", "1.000" (thousands separator)
 * and ranges "2-3" / "2–3".
 * Empty input means "no amount" ({ amount: null, amountMax: null }); unreadable input or a range whose
 * upper bound is not above the lower one returns null.
 */
export function parseAmount(text: string): ParsedAmount | null {
  const s = text.trim();
  if (s === '') return { amount: null, amountMax: null };
  const range = RANGE.exec(s);
  if (range) {
    const amount = parseSingle(range[1] ?? '');
    const amountMax = parseSingle(range[2] ?? '');
    if (amount === null || amountMax === null || Number.isNaN(amount) || amountMax <= amount) return null;
    return { amount, amountMax };
  }
  const amount = parseSingle(s);
  if (amount === null || Number.isNaN(amount)) return null;
  return { amount, amountMax: null };
}

/** Amount and unit of an ingredient, e.g. "200 g", "2–3 EL", "" without amount and unit. */
export function formatIngredientAmount(
  amount: number | null,
  amountMax: number | null,
  unit: string,
): string {
  const parts: string[] = [];
  if (amount !== null) parts.push(formatRange(amount, amountMax));
  if (unit.trim() !== '') parts.push(unit.trim());
  return parts.join(' ');
}

/** One ingredient line as in the detail (F-10): "200 g Mehl, gesiebt"; "Salz" has no leading space. */
export function formatIngredient(i: {
  amount: number | null;
  amountMax: number | null;
  unit: string;
  name: string;
  note: string;
}): string {
  const head = [formatIngredientAmount(i.amount, i.amountMax, i.unit), i.name.trim()]
    .filter((part) => part !== '')
    .join(' ');
  const note = i.note.trim();
  return note === '' ? head : `${head}, ${note}`;
}

// List formats live in format-list.ts so the entry chunk does not pull in the amount parser (NF-01).
export { formatMinutes, formatRating } from './format-list.ts';

const DAY_MS = 86_400_000;

/** Whole calendar days from `date` to `now` in local time (DST-safe). */
function calendarDaysBetween(date: Date, now: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / DAY_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "12.03.2026" in local time. */
export function formatAbsoluteDate(date: Date): string {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/**
 * Date after NF-10: within the last 7 days relative ("heute", "gestern", "vor 3 Tagen"), otherwise
 * "12.03.2026". Future dates and invalid input: absolute date or "".
 */
export function formatDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const days = calendarDaysBetween(date, now);
  if (days === 0) return de.time.today;
  if (days === 1) return de.time.yesterday;
  if (days > 1 && days < 7) return de.time.daysAgo(days);
  return formatAbsoluteDate(date);
}

/** "heute, 03:00" or "12.03.2026, 03:00" (F-42). */
export function formatDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDate(iso, now)}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
