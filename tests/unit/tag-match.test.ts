// Tag matching of the editor autocomplete, the tag page and the filter sheet (client/src/lib/tag-match.ts):
// F-18 „Der Präfixvergleich läuft über queryVariants() aus shared/normalize.ts (normalisiert, inkl.
// ae/oe/ue → a/o/u)“, in server order (count descending).
import { describe, expect, it } from 'vitest';
import {
  FREQUENT_TAGS,
  MAX_SUGGESTIONS,
  matchTags,
  tagKeys,
  tagNamesByKey,
} from '../../client/src/lib/tag-match.ts';
import type { TagCount } from '../../shared/types.ts';

function tag(id: number, name: string, count: number): TagCount {
  return { id, name, count };
}

// GET /tags order: count descending, then name key.
const LIST: TagCount[] = [
  tag(1, 'Vegetarisch', 12),
  tag(2, 'Hauptgericht', 9),
  tag(3, 'Vegan', 3),
  tag(4, 'Süßspeise', 3),
  tag(5, 'Schnell & einfach', 2),
  tag(6, 'Low-Carb', 1),
  tag(7, 'Suppe', 1),
  tag(8, 'Für Gäste', 0),
];
const names = (found: TagCount[]): string[] => found.map((t) => t.name);

describe('matchTags', () => {
  it('„veg“ schlägt „Vegetarisch (12)“ und „Vegan (3)“ vor, nach Anzahl sortiert (F-18 AK1)', () => {
    expect(matchTags(LIST, 'veg')).toEqual([tag(1, 'Vegetarisch', 12), tag(3, 'Vegan', 3)]);
  });

  it('„su“ und „sue“ schlagen „Süßspeise“ vor (F-18 AK2), also for SÜ and suess', () => {
    for (const text of ['su', 'sue', 'SÜ', 'suess', 'Süß', 'süss', 'SUESSSPEISE']) {
      expect(names(matchTags(LIST, text)), text).toContain('Süßspeise');
    }
    expect(names(matchTags(LIST, 'su'))).toEqual(['Süßspeise', 'Suppe']);
    // 'sue' also means 'su' (queryVariants), so Suppe matches too.
    expect(names(matchTags(LIST, 'sue'))).toEqual(['Süßspeise', 'Suppe']);
    expect(names(matchTags(LIST, 'suess'))).toEqual(['Süßspeise']);
  });

  it('matches at the start of a word inside the name', () => {
    expect(names(matchTags(LIST, 'einfach'))).toEqual(['Schnell & einfach']);
    expect(names(matchTags(LIST, 'carb'))).toEqual(['Low-Carb']);
    expect(names(matchTags(LIST, 'gaeste'))).toEqual(['Für Gäste']);
    expect(names(matchTags(LIST, 'schnell &'))).toEqual(['Schnell & einfach']);
  });

  it('matches prefixes only, not the middle of a word', () => {
    expect(matchTags(LIST, 'tarisch')).toEqual([]);
    expect(matchTags(LIST, 'arb')).toEqual([]);
    expect(matchTags(LIST, 'xyz')).toEqual([]);
  });

  it('skips excluded keys (tags already on the recipe) and respects the limit', () => {
    expect(names(matchTags(LIST, 'veg', new Set(['vegetarisch'])))).toEqual(['Vegan']);
    expect(names(matchTags(LIST, 'veg', new Set(), 1))).toEqual(['Vegetarisch']);
    const many = Array.from({ length: 20 }, (_, i) => tag(i + 1, `Tag ${i + 1}`, 20 - i));
    expect(matchTags(many, 'tag', new Set(), MAX_SUGGESTIONS)).toHaveLength(6);
  });

  it('returns nothing for empty or blank text', () => {
    expect(matchTags(LIST, '')).toEqual([]);
    expect(matchTags(LIST, ' ')).toEqual([]);
    // A lone combining mark (U+0301) normalizes to ''.
    expect(matchTags(LIST, String.fromCodePoint(0x301))).toEqual([]);
    expect(matchTags([], 'veg')).toEqual([]);
  });

  it('keeps the server order on equal counts', () => {
    const tie = [tag(10, 'Vegan', 3), tag(11, 'Vegetarisch', 3), tag(12, 'Veggie-Burger', 3)];
    expect(names(matchTags(tie, 'veg'))).toEqual(['Vegan', 'Vegetarisch', 'Veggie-Burger']);
    const reversed = [...tie].reverse();
    expect(names(matchTags(reversed, 'veg'))).toEqual(['Veggie-Burger', 'Vegetarisch', 'Vegan']);
  });

  it('matches 1,000 tags in under 5 ms', () => {
    const big = Array.from({ length: 1000 }, (_, i) =>
      tag(i + 1, `Tag ${i} Süßes Gericht Nr. ${i}`, 1000 - i),
    );
    matchTags(big, 'warm-up'); // builds the key cache once, as the first keystroke does
    // The fastest of a few keystrokes: in a parallel test run (pnpm verify) another process may
    // preempt any single measurement.
    let fastest = Number.POSITIVE_INFINITY;
    let found: TagCount[] = [];
    for (let i = 0; i < 10; i++) {
      const started = performance.now();
      found = matchTags(big, 'suess');
      fastest = Math.min(fastest, performance.now() - started);
    }
    expect(found).toHaveLength(1000);
    expect(fastest).toBeLessThan(5);
  });
});

describe('tagKeys', () => {
  it('normalizes every name and caches per list array', () => {
    const keys = tagKeys(LIST);
    expect(keys).toEqual([
      'vegetarisch',
      'hauptgericht',
      'vegan',
      'susspeise',
      'schnell & einfach',
      'low-carb',
      'suppe',
      'fur gaste',
    ]);
    expect(tagKeys(LIST)).toBe(keys);
    // A new array (the store replaces it on every load) gets new keys.
    const renamed = LIST.map((t) => (t.id === 4 ? { ...t, name: 'Nachtisch' } : t));
    expect(tagKeys(renamed)[3]).toBe('nachtisch');
    expect(names(matchTags(renamed, 'nach'))).toEqual(['Nachtisch']);
  });
});

describe('tagNamesByKey', () => {
  it('maps the key to the display name', () => {
    const map = tagNamesByKey(LIST);
    expect(map.get('susspeise')).toBe('Süßspeise');
    expect(map.get('schnell & einfach')).toBe('Schnell & einfach');
    expect(map.size).toBe(LIST.length);
  });
});

describe('limits', () => {
  it('suggests at most 6 tags and shows 6 frequent ones', () => {
    expect(MAX_SUGGESTIONS).toBe(6);
    expect(FREQUENT_TAGS).toBe(6);
  });
});
