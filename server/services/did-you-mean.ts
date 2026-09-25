import { normalize, queryVariants, searchTerms } from '../../shared/normalize.ts';
import { searchWordTexts } from '../db/repos/search-words.ts';
import { MAX_TERMS } from '../db/search.ts';
import type { DB } from '../db/types.ts';
import { maxDistance, osaDistance } from './fuzzy.ts';

/**
 * „Meintest du …?“ (F-23, Kap. 4.5 point 7): a word list from titles, tag names and ingredient
 * names (normalized word → first original spelling) stays in memory and is rebuilt when
 * meta.data_revision changes. The list request passes the revision it already read, so checking
 * freshness costs no statement (NF-04).
 */

/** Normalized word → first original spelling and how often it occurs in the source texts. */
export type WordList = Map<string, { display: string; n: number }>;

/** Words shorter than this are not kept: the shortest suggested term (4) is at most 1 edit away. */
const MIN_WORD = 3;
/** Terms shorter than this never get a suggestion (F-23 AK3). */
export const MIN_SUGGEST_TERM = 4;

/** Splits like the search, but keeps combining marks inside a word ("a" + U+0308 stays one word). */
function words(text: string): string[] {
  return text
    .normalize('NFC')
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((w) => w !== '');
}

function length(s: string): number {
  return Array.from(s).length;
}

export function buildWordList(texts: Iterable<string>): WordList {
  const list: WordList = new Map();
  // Titles repeat their words a lot ("mit", "Käsekuchen"); normalize each spelling once.
  const keys = new Map<string, string>();
  for (const text of texts) {
    for (const word of words(text)) {
      let key = keys.get(word);
      if (key === undefined) {
        key = normalize(word);
        keys.set(word, key);
      }
      if (length(key) < MIN_WORD) continue;
      const entry = list.get(key);
      if (entry) entry.n++;
      else list.set(key, { display: word, n: 1 });
    }
  }
  return list;
}

/**
 * Best known word for a normalized term, as its display spelling, or null. A term that is part of
 * a known word is left alone (it has hits or only fails in combination). Candidates lie at distance
 * 1..maxDistance; ties go to the more frequent word, then to the alphabetically first key.
 * The query spellings of the search count as the term (F-22): "kaese" is „Käse“ spelled with ae, not
 * a typo, so it is never "corrected" to „Käse“, and "muesly" is 1 edit from „Müsli“ like "musly".
 */
export function suggestWord(list: WordList, term: string): string | null {
  const max = maxDistance(length(term));
  if (max === 0) return null;
  // Same spellings as the search (server/db/search.ts): no 1-character variant.
  const spellings = queryVariants(term).filter((v) => length(v) >= 2);
  for (const key of list.keys()) {
    if (spellings.some((s) => key.includes(s))) return null;
  }
  let best: { d: number; n: number; key: string; display: string } | null = null;
  for (const [key, word] of list) {
    let d = max + 1;
    for (const s of spellings) d = Math.min(d, osaDistance(s, key, max));
    if (d < 1 || d > max) continue;
    if (
      best === null ||
      d < best.d ||
      (d === best.d && (word.n > best.n || (word.n === best.n && key < best.key)))
    ) {
      best = { d, n: word.n, key, display: word.display };
    }
  }
  return best?.display ?? null;
}

const cache = new WeakMap<DB, { revision: number; list: WordList }>();

/** The word list of this database for `revision`; rebuilt with one statement when the revision changed. */
export function wordListFor(db: DB, revision: number): WordList {
  let entry = cache.get(db);
  if (!entry || entry.revision !== revision) {
    entry = { revision, list: buildWordList(searchWordTexts(db)) };
    cache.set(db, entry);
  }
  return entry.list;
}

/**
 * The whole query with every correctable word of 4+ characters replaced by its suggestion, words
 * joined by single spaces ("Spazle" → "Spätzle"), or null when nothing was replaced.
 * Only searched terms are corrected (the first MAX_TERMS distinct ones, Kap. 4.5): a word after them
 * did not cause the 0 hits, and the cap bounds the work of a 200-character query to 8 lookups
 * (NF-04: no request over 100 ms, also with a word list of 5,000 words).
 */
export function didYouMean(db: DB, q: string, revision: number): string | null {
  const searched = new Set([...new Set(searchTerms(q))].slice(0, MAX_TERMS));
  const suggestions = new Map<string, string | null>();
  let list: WordList | null = null;
  let changed = false;
  const out = words(q).map((word) => {
    const term = normalize(word);
    if (length(term) < MIN_SUGGEST_TERM || !searched.has(term)) return word;
    let suggestion = suggestions.get(term);
    if (suggestion === undefined) {
      list ??= wordListFor(db, revision);
      suggestion = suggestWord(list, term);
      suggestions.set(term, suggestion);
    }
    if (suggestion === null) return word;
    changed = true;
    return suggestion;
  });
  return changed ? out.join(' ') : null;
}
