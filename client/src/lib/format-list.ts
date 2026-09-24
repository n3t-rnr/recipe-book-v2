/** Formats needed by list cards; kept apart from format.ts so the entry chunk stays small (NF-01). */
import { de } from '../i18n/de.ts';

/** Always whole minutes as in the approved artboards: "45 min", "90 min", never "1 h 30 min". */
export function formatMinutes(total: number): string {
  return de.time.minutes(Math.max(0, Math.round(total)));
}

/** Average rating with one decimal and a decimal comma: 3 → "3,0", 4.333 → "4,3" (F-27). */
export function formatRating(avg: number): string {
  return avg.toFixed(1).replace('.', ',');
}
