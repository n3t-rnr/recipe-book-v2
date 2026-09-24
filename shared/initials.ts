/**
 * Avatar initials (F-03): one letter per profile, two when first letters collide
 * ("Anna" and "Andreas" → "An" and "Ad"). Grouping and comparison use normalize() (Kap. 4.4), so
 * "Ömer" and "Olga" collide as well. The displayed letters always come from the original name
 * (Kap. 4.4, "Anzeige"), so an umlaut stays an umlaut: "Bärbel" and "Bernd" → "Bä" and "Be".
 */
import { normalize } from './normalize.ts';

const segmenter = new Intl.Segmenter('de', { granularity: 'grapheme' });
const LETTER_LIKE = /^[\p{L}\p{N}]$/u;
const LETTER = /^\p{L}$/u;
const WHITESPACE = /^\s+$/u;

/** One character of the normalized name plus the original grapheme it came from. */
interface Unit {
  key: string;
  display: string;
  /** Comes from the first grapheme, which already is the first letter ("Æ" → "a", "e"; "ß" → "s", "s"). */
  head: boolean;
}

interface Entry {
  id: number;
  first: string;
  units: Unit[];
}

function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), (part) => part.segment);
}

/**
 * The normalized name as units: joined, the keys equal normalize(name) (same folding, same collapse of
 * letter runs and whitespace), but every unit remembers its original grapheme for display.
 */
function toUnits(name: string): Unit[] {
  const units: Unit[] = [];
  let pendingSpace = false;
  for (const grapheme of graphemes(name.normalize('NFC'))) {
    const key = normalize(grapheme);
    if (key === '') {
      // Whitespace collapses to one space and is trimmed; lone combining marks vanish like in normalize().
      if (WHITESPACE.test(grapheme) && units.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      units.push({ key: ' ', display: ' ', head: false });
      pendingSpace = false;
    }
    const display = grapheme.toLocaleLowerCase('de');
    const head = units.length === 0;
    for (const ch of key) {
      const last = units[units.length - 1];
      const beforeLast = units[units.length - 2];
      // Step 4 of normalize(): three or more equal letters count as two.
      if (LETTER.test(ch) && last?.key === ch && beforeLast?.key === ch) continue;
      units.push({ key: ch, display, head });
    }
  }
  return units;
}

/** First grapheme of the name in upper case; a non-letter (digit, emoji, …) is kept as it is. */
function firstLetter(name: string): string {
  const first = graphemes(name.trim().normalize('NFC'))[0] ?? '';
  const upper = first.toLocaleUpperCase('de');
  // "ß" would become "SS"; one grapheme stays one grapheme.
  return graphemes(upper).length === 1 ? upper : first;
}

/**
 * Second letter for a profile whose first letter collides: the first letter-like position after the
 * first letter where its normalized name differs from all others in the group; failing that, from at
 * least one other (keeps "Maria", "Mario", "Marion" apart); failing that, simply the second letter.
 */
function secondLetter(units: Unit[], others: Unit[][]): string {
  const candidates = units
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => !unit.head && LETTER_LIKE.test(unit.key));
  const differsFromAll = candidates.find(({ unit, index }) =>
    others.every((other) => other[index]?.key !== unit.key),
  );
  const differsFromAny = candidates.find(({ unit, index }) =>
    others.some((other) => other[index]?.key !== unit.key),
  );
  const chosen = differsFromAll ?? differsFromAny ?? candidates[0];
  return chosen ? chosen.unit.display : '';
}

/** Initials for all profiles, keyed by profile id. Always computed over the complete profile list. */
export function computeInitials(profiles: ReadonlyArray<{ id: number; name: string }>): Map<number, string> {
  const groups = new Map<string, Entry[]>();
  const entries: Array<{ entry: Entry; groupKey: string }> = [];
  for (const profile of profiles) {
    const units = toUnits(profile.name);
    const entry: Entry = { id: profile.id, first: firstLetter(profile.name), units };
    const groupKey = units[0]?.key ?? '';
    const group = groups.get(groupKey);
    if (group) group.push(entry);
    else groups.set(groupKey, [entry]);
    entries.push({ entry, groupKey });
  }

  const initials = new Map<number, string>();
  for (const { entry, groupKey } of entries) {
    const others = (groups.get(groupKey) ?? []).filter((other) => other !== entry);
    const second =
      others.length === 0
        ? ''
        : secondLetter(
            entry.units,
            others.map((other) => other.units),
          );
    initials.set(entry.id, entry.first + second);
  }
  return initials;
}
