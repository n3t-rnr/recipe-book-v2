/**
 * Tag matching of the editor's autocomplete (F-18), the tag page and the filter sheet: one rule for all
 * three. Only lazily loaded chunks import this module, which keeps normalize out of the entry (NF-01).
 */
import { normalize, queryVariants } from '../../../shared/normalize.ts';
import type { TagCount } from '../../../shared/types.ts';

/** Suggestions under the editor's tag field. */
export const MAX_SUGGESTIONS = 6;
/** „Häufig verwendet“ chips in the editor. */
export const FREQUENT_TAGS = 6;

interface Keys {
  keys: readonly string[];
  /** Words of each key, for matches at a word start ('einfach' → 'Schnell & einfach'). */
  words: ReadonlyArray<readonly string[]>;
}

// The tag store replaces its list array on every load, so the list itself is the cache key.
const cache = new WeakMap<readonly TagCount[], Keys>();

function keysOf(list: readonly TagCount[]): Keys {
  let entry = cache.get(list);
  if (!entry) {
    const keys = list.map((t) => normalize(t.name));
    entry = { keys, words: keys.map((key) => key.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '')) };
    cache.set(list, entry);
  }
  return entry;
}

/** normalize(name) of every tag, index by index (Kap. 4.4). */
export function tagKeys(list: readonly TagCount[]): readonly string[] {
  return keysOf(list).keys;
}

/**
 * Tags whose key, or one word of the key, starts with a variant of the typed text (F-18: „Der
 * Präfixvergleich läuft über queryVariants()“, so 'sue' finds 'Süßspeise'). Keeps the list order (server
 * order: count descending, then name), skips keys in `exclude` and stops after `limit` tags.
 */
export function matchTags(
  list: readonly TagCount[],
  text: string,
  exclude: ReadonlySet<string> = new Set(),
  limit: number = Number.POSITIVE_INFINITY,
): TagCount[] {
  const q = normalize(text);
  if (q === '') return [];
  const variants = queryVariants(q);
  const { keys, words } = keysOf(list);
  const found: TagCount[] = [];
  for (let i = 0; i < list.length && found.length < limit; i++) {
    const tag = list[i];
    const key = keys[i] ?? '';
    if (!tag || exclude.has(key)) continue;
    const starts = (w: string): boolean => variants.some((v) => w.startsWith(v));
    if (starts(key) || (words[i] ?? []).some(starts)) found.push(tag);
  }
  return found;
}

/** Display name per key, so a typed 'süßspeise' becomes the existing 'Süßspeise'. */
export function tagNamesByKey(list: readonly TagCount[]): Map<string, string> {
  const names = new Map<string, string>();
  const keys = tagKeys(list);
  list.forEach((tag, i) => {
    const key = keys[i] ?? '';
    if (!names.has(key)) names.set(key, tag.name);
  });
  return names;
}
