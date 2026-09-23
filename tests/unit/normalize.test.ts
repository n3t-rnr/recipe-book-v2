import { describe, expect, it } from 'vitest';
import { normalize, queryVariants, searchTerms } from '../../shared/normalize.ts';

/** Binary comparison like SQLite's default collation, used for the tie-break on the original title. */
const binary = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Mirrors `ORDER BY title_key, title` (Kap. 4.4, DIN 5007-1). */
const byTitle = (a: string, b: string): number => binary(normalize(a), normalize(b)) || binary(a, b);

/** True when one query variant of the (single) term is a prefix of the normalized text, like the FTS prefix match. */
const prefixMatches = (query: string, text: string): boolean => {
  const [term] = searchTerms(query);
  if (term === undefined) return false;
  const words = normalize(text).split(/[^\p{L}\p{N}]+/u);
  return queryVariants(term).some((variant) => words.some((word) => word.startsWith(variant)));
};

// NF-29 / F-22: at least 30 cases covering ä ö ü ß ẞ é ñ ø, triple letters, emojis and digits.
const NORMALIZE_CASES: ReadonlyArray<readonly [input: string, expected: string]> = [
  // umlauts, DIN 5007-1: ä is sorted like a
  ['ä', 'a'],
  ['ö', 'o'],
  ['ü', 'u'],
  ['Ä', 'a'],
  ['Ö', 'o'],
  ['Ü', 'u'],
  ['Käse', 'kase'],
  ['Kürbissuppe', 'kurbissuppe'],
  // sharp s, lower and capital
  ['ß', 'ss'],
  ['ẞ', 'ss'],
  ['Straße', 'strasse'],
  ['GROẞ', 'gross'],
  ['Weißkohl', 'weisskohl'],
  // accents and other diacritics
  ['é', 'e'],
  ['è', 'e'],
  ['ê', 'e'],
  ['à', 'a'],
  ['ñ', 'n'],
  ['ç', 'c'],
  ['å', 'a'],
  ['Crème brûlée', 'creme brulee'],
  ['Jalapeño', 'jalapeno'],
  // letters without a decomposition
  ['ø', 'o'],
  ['Øl', 'ol'],
  ['æ', 'ae'],
  ['Æbleskiver', 'aebleskiver'],
  ['œ', 'oe'],
  ['Œuf', 'oeuf'],
  ['ł', 'l'],
  ['Łódź', 'lodz'],
  // ß/ss/sss variants and triple letters (F-17)
  ['Süßspeise', 'susspeise'],
  ['Süssspeise', 'susspeise'],
  ['Süsspeise', 'susspeise'],
  ['SÜSSSPEISE', 'susspeise'],
  ['süßspeise', 'susspeise'],
  ['Schifffahrt', 'schiffahrt'],
  ['Kaffeeersatz', 'kaffeersatz'],
  ['ééé', 'ee'],
  // digits are never shortened
  ['1000', '1000'],
  ['3er', '3er'],
  ['Pizza 1000 g', 'pizza 1000 g'],
  ['Menü 2026', 'menu 2026'],
  // whitespace is collapsed and trimmed (tab, newline, NBSP)
  ['  Kartoffel   Salat  ', 'kartoffel salat'],
  ['Kartoffel\tSalat', 'kartoffel salat'],
  ['Kartoffel\n\r\nSalat', 'kartoffel salat'],
  ['Kartoffel Salat', 'kartoffel salat'],
  [' \t Salat \n', 'salat'],
  // emojis are kept (they are not letters, so triple emojis stay too)
  ['Käse 🧀', 'kase 🧀'],
  ['🧀🧀🧀 Party', '🧀🧀🧀 party'],
  ['Daumen 👍🏽', 'daumen 👍🏽'],
  // the variation selector U+FE0F is a combining mark and is dropped, so ❤️ and ❤ share one key
  ['❤️ Kuchen', '❤ kuchen'],
  // ae/oe/ue are never folded in the index (F-22)
  ['Michael', 'michael'],
  ['Goethe', 'goethe'],
  ['Poesie', 'poesie'],
  ['Kaese', 'kaese'],
  // punctuation is kept; searchTerms() splits on it
  ['Low-Carb', 'low-carb'],
  ['Schnell & einfach', 'schnell & einfach'],
  // empty and blank input
  ['', ''],
  [' \t\n ', ''],
];

describe('normalize()', () => {
  it('has at least 30 cases (NF-29)', () => {
    expect(NORMALIZE_CASES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(NORMALIZE_CASES)('%j -> %j', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  it.each(NORMALIZE_CASES)('is idempotent for %j', (input) => {
    const once = normalize(input);
    expect(normalize(once)).toBe(once);
  });

  it('gives all Süßspeise spellings one key (F-17)', () => {
    const keys = new Set(['Süßspeise', 'süßspeise', 'Süssspeise', 'Süsspeise', 'SÜSSSPEISE'].map(normalize));
    expect([...keys]).toEqual(['susspeise']);
  });

  it('gives Vegan, vegan and VEGAN one key (F-17)', () => {
    expect(new Set(['Vegan', 'vegan', 'VEGAN'].map(normalize)).size).toBe(1);
  });

  it('lets Käse and Kase collide on purpose (Kap. 4.4)', () => {
    expect(normalize('Käse')).toBe(normalize('Kase'));
  });

  it('keeps Käse and Kaese apart in the index (ae is a query variant only)', () => {
    expect(normalize('Käse')).not.toBe(normalize('Kaese'));
  });
});

describe('queryVariants()', () => {
  it.each([
    ['kaese', ['kaese', 'kase']],
    ['sue', ['sue', 'su']],
    ['goethe', ['goethe', 'gothe']],
    ['muesli', ['muesli', 'musli']],
    ['kaesekuchen', ['kaesekuchen', 'kasekuchen']],
    ['tomate', ['tomate']],
    ['suppe', ['suppe']],
    ['', ['']],
  ])('%j -> %j', (term, expected) => {
    expect(queryVariants(term)).toEqual(expected);
  });

  it('always keeps the original term first, so "michael" still finds Michael (F-22)', () => {
    const variants = queryVariants('michael');
    expect(variants[0]).toBe('michael');
    expect(variants).toContain('michael');
  });

  it('adds at most one extra variant', () => {
    expect(queryVariants('aeoeue')).toEqual(['aeoeue', 'aou']);
  });
});

describe('searchTerms()', () => {
  it.each([
    ['Kürbis-Suppe mit Ingwer', ['kurbis', 'suppe', 'mit', 'ingwer']],
    ['kartoffel käse', ['kartoffel', 'kase']],
    ['Crème brûlée', ['creme', 'brulee']],
    ['Low-Carb', ['low', 'carb']],
    ['Käse, Tomate; Basilikum!', ['kase', 'tomate', 'basilikum']],
    ['3er Pack', ['3er', 'pack']],
    ['Käse 🧀', ['kase']],
    ['Süßspeise', ['susspeise']],
  ])('%j -> %j', (query, expected) => {
    expect(searchTerms(query)).toEqual(expected);
  });

  it('drops terms with a single character (Kap. 4.5)', () => {
    expect(searchTerms('a Ei b Öl c')).toEqual(['ei', 'ol']);
    expect(searchTerms('x')).toEqual([]);
  });

  it.each(['', '   ', '-', '🧀', '& /'])('returns no terms for %j', (query) => {
    expect(searchTerms(query)).toEqual([]);
  });
});

describe('spelling tolerance at the prefix level (F-18, F-22)', () => {
  it.each(['kase', 'käse', 'KÄSE', 'kaese'])('%j matches Käsekuchen', (query) => {
    expect(prefixMatches(query, 'Käsekuchen')).toBe(true);
  });

  it('"weiss" matches Weißkohl', () => {
    expect(prefixMatches('weiss', 'Weißkohl')).toBe(true);
  });

  it('"creme brulee" matches Crème brûlée in every term', () => {
    const title = normalize('Crème brûlée');
    expect(searchTerms('creme brulee').every((t) => title.includes(t))).toBe(true);
  });

  it('"michael" still matches Michaels Nudeln', () => {
    expect(prefixMatches('michael', 'Michaels Nudeln')).toBe(true);
  });

  it.each(['su', 'sue'])('tag autocomplete %j suggests Süßspeise', (query) => {
    expect(prefixMatches(query, 'Süßspeise')).toBe(true);
  });

  it('"veg" suggests Vegetarisch and Vegan', () => {
    expect(prefixMatches('veg', 'Vegetarisch')).toBe(true);
    expect(prefixMatches('veg', 'Vegan')).toBe(true);
  });
});

describe('title sort A–Z (DIN 5007-1, F-26)', () => {
  it('sorts umlauts like their base letters', () => {
    const titles = ['Zucchini', 'Öl', 'Birne', 'Äpfel', 'Apfelkuchen', 'Ananas'];
    expect([...titles].sort(byTitle)).toEqual(['Ananas', 'Äpfel', 'Apfelkuchen', 'Birne', 'Öl', 'Zucchini']);
  });

  it('ignores case and accents in the key', () => {
    const titles = ['zwiebelkuchen', 'Crème brûlée', 'apfelstrudel', 'Bratkartoffeln', 'Crepes'];
    expect([...titles].sort(byTitle)).toEqual([
      'apfelstrudel',
      'Bratkartoffeln',
      'Crème brûlée',
      'Crepes',
      'zwiebelkuchen',
    ]);
  });

  it('breaks ties on equal keys by the binary order of the original title', () => {
    // 'a' (U+0061) < 'Ä' (U+00C4) < 'ä' (U+00E4)
    expect(['Käse', 'KÄSE', 'Kase'].sort(byTitle)).toEqual(['Kase', 'KÄSE', 'Käse']);
  });
});
