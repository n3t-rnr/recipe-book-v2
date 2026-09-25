// List filter model of the recipe list (client/src/lib/list-query.ts): URL ⇄ filter ⇄ API query (F-34
// „Suchbegriff, Filter und Sortierung stehen in der URL“), default sorts (F-26), the chip row (F-24, F-20),
// reset (F-24 AK3) and the remembered filter of the two-pane detail.
import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  CHIP_ROW_TAGS,
  chipRow,
  EMPTY_FILTER,
  effectiveSort,
  filterKey,
  isFiltered,
  knownTags,
  type ListFilter,
  listFilterFor,
  parseListFilter,
  rememberListFilter,
  resetFilter,
  SEARCH_DEBOUNCE_MS,
  searchable,
  toApiQuery,
  toggleTag,
  toUrlQuery,
} from '../../client/src/lib/list-query.ts';
import { buildQuery, paths } from '../../client/src/lib/routes.ts';
import { LIMITS } from '../../shared/constants.ts';
import { searchTerms } from '../../shared/normalize.ts';
import type { TagCount } from '../../shared/types.ts';

const parse = (query: string): ListFilter => parseListFilter(new URLSearchParams(query));
const filter = (f: Partial<ListFilter>): ListFilter => ({ ...EMPTY_FILTER, ...f });
/** The URL of a filter as the list writes it, parsed back as the router hands it over. */
const roundTrip = (f: ListFilter): ListFilter => {
  const url = paths.recipes(toUrlQuery(f));
  return parse(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
};

function tag(id: number, name: string, count: number): TagCount {
  return { id, name, count };
}

describe('constants', () => {
  it('debounces the search by 150 ms and shows 12 chips (F-21, F-24)', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(150);
    expect(CHIP_ROW_TAGS).toBe(12);
    expect(EMPTY_FILTER).toEqual({ q: '', tags: [], tagMode: 'all', sort: null });
  });
});

describe('parseListFilter', () => {
  it('reads q, tags, tagMode and sort', () => {
    expect(parse('q=k%C3%A4se&tags=3,7&tagMode=any&sort=title')).toEqual({
      q: 'käse',
      tags: [3, 7],
      tagMode: 'any',
      sort: 'title',
    });
    expect(parse('')).toEqual(EMPTY_FILTER);
  });

  it('keeps well-formed tag ids only, deduplicated in URL order, at most 20', () => {
    expect(parse('tags=abc,5').tags).toEqual([5]);
    expect(parse('tags=3,3').tags).toEqual([3]);
    expect(parse('tags=7,3,7,1').tags).toEqual([7, 3, 1]);
    expect(parse('tags=0,-1,1.5,007,,+4, 5,6').tags).toEqual([6]);
    const ids = Array.from({ length: 21 }, (_, i) => i + 1);
    expect(parse(`tags=${ids.join(',')}`).tags).toEqual(ids.slice(0, 20));
    expect(LIMITS.filterTags).toBe(20);
    // 20 distinct ids after dropping duplicates, not the first 20 parts.
    expect(parse(`tags=1,1,${ids.slice(1).join(',')}`).tags).toHaveLength(20);
  });

  it('drops ids beyond the safe integer range, which would be sent rounded (400)', () => {
    expect(parse('tags=9007199254740991,9999999999999999').tags).toEqual([9007199254740991]);
    expect(parse('tags=12345678901234567').tags).toEqual([]);
  });

  it('falls back to "all" and the default sort for unknown values', () => {
    expect(parse('tagMode=x').tagMode).toBe('all');
    expect(parse('tagMode=ANY').tagMode).toBe('all');
    expect(parse('sort=zufall').sort).toBeNull();
    // M5 sorts are not offered yet (F-44).
    expect(parse('sort=rating').sort).toBeNull();
    expect(parse('sort=updated').sort).toBeNull();
    expect(parse('sort=relevance').sort).toBe('relevance');
    expect(parse('sort=newest').sort).toBe('newest');
  });

  it('cuts the search text to LIMITS.query characters', () => {
    expect(parse(`q=${'a'.repeat(250)}`).q).toHaveLength(LIMITS.query);
    expect(LIMITS.query).toBe(200);
  });

  it('never cuts an emoji in half, so the filter still builds URLs', () => {
    const long = `${'a'.repeat(LIMITS.query - 1)}🥨🥨`;
    const f = parse(`q=${encodeURIComponent(long)}`);
    expect(f.q).toBe('a'.repeat(LIMITS.query - 1));
    expect(() => filterKey(f)).not.toThrow();
    expect(() => paths.recipes(toUrlQuery(f))).not.toThrow();
    // An emoji that fits stays whole.
    expect(parse(`q=${encodeURIComponent(`${'a'.repeat(LIMITS.query - 2)}🥨`)}`).q).toHaveLength(
      LIMITS.query,
    );
  });
});

describe('URL round trip (F-34 AK3: „Zwei Filter setzen und neu laden → beide aktiv“)', () => {
  it('parses back to the same filter', () => {
    const cases: ListFilter[] = [
      EMPTY_FILTER,
      filter({ q: 'käse spätzle', tags: [7, 3], tagMode: 'any', sort: 'title' }),
      filter({ tags: [5, 9] }),
      filter({ q: 'Crème & Brûlée, 100%', sort: 'newest' }),
      filter({ q: 'suppe' }),
      filter({ sort: 'title' }),
    ];
    for (const f of cases) expect(roundTrip(f), JSON.stringify(f)).toEqual(f);
  });

  it('leaves the defaults out of the URL', () => {
    expect(paths.recipes(toUrlQuery(EMPTY_FILTER))).toBe('/rezepte');
    expect(paths.recipes(toUrlQuery(filter({ tags: [3, 7] })))).toBe('/rezepte?tags=3,7');
    expect(paths.recipes(toUrlQuery(filter({ tags: [3], tagMode: 'any' })))).toBe(
      '/rezepte?tags=3&tagMode=any',
    );
    // Neueste is the default without a search term, Relevanz never needs to be written.
    expect(paths.recipes(toUrlQuery(filter({ sort: 'newest' })))).toBe('/rezepte');
    expect(paths.recipes(toUrlQuery(filter({ q: 'suppe', sort: 'relevance' })))).toBe('/rezepte?q=suppe');
    expect(paths.recipes(toUrlQuery(filter({ q: 'suppe', sort: 'newest' })))).toBe(
      '/rezepte?q=suppe&sort=newest',
    );
    expect(paths.recipes(toUrlQuery(filter({ q: '   ' })))).toBe('/rezepte');
  });

  it('keeps the raw search text, so the caret in the field never jumps', () => {
    expect(toUrlQuery(filter({ q: 'käse ' })).q).toBe('käse ');
    expect(toUrlQuery(filter({ q: 'k' })).q).toBe('k');
  });

  it('writes the keys in the order q, tags, tagMode, sort', () => {
    expect(buildQuery(toUrlQuery(filter({ q: 'ei', tags: [1], tagMode: 'any', sort: 'title' })))).toBe(
      'q=ei&tags=1&tagMode=any&sort=title',
    );
  });
});

describe('searchable (Kap. 4.5: Begriffe ab 2 Zeichen)', () => {
  it('needs 2 letters or digits in a row', () => {
    expect(searchable('k')).toBe(false);
    expect(searchable('ka')).toBe(true);
    expect(searchable('a b')).toBe(false);
    expect(searchable('-')).toBe(false);
    expect(searchable('ei')).toBe(true);
    expect(searchable('  ')).toBe(false);
    expect(searchable('Ä')).toBe(false);
    expect(searchable('Öl')).toBe(true);
    expect(searchable('42')).toBe(true);
    expect(searchable('k-a')).toBe(false);
  });

  it('agrees with the server for decomposed umlauts (a pasted „Öl“ from macOS is NFD)', () => {
    const decomposed = 'Öl'.normalize('NFD');
    expect(decomposed).toHaveLength(3);
    expect(searchable(decomposed)).toBe(true);
    // The server searches it: normalize() drops the mark, leaving the 2-letter term 'ol'.
    expect(searchTerms(decomposed)).toEqual(['ol']);
    expect(toApiQuery(filter({ q: decomposed })).q).toBe(decomposed);
    // A single letter with its mark stays below the 2-character minimum on both sides.
    expect(searchable('é'.normalize('NFD'))).toBe(false);
    expect(searchTerms('é'.normalize('NFD'))).toEqual([]);
  });

  it('is never true for a text the server would not search (Kap. 4.5)', () => {
    for (const q of [
      'k',
      'Ä',
      'a b',
      'k-a',
      '-',
      ' ',
      'Öl',
      'Öl'.normalize('NFD'),
      'ei',
      'ß',
      'é'.normalize('NFD'),
    ]) {
      if (searchable(q)) expect(searchTerms(q).length, q).toBeGreaterThan(0);
    }
  });
});

describe('effectiveSort (F-26 AK2)', () => {
  it('is newest without and relevance with a search term', () => {
    expect(effectiveSort(filter({ q: '' }))).toBe('newest');
    expect(effectiveSort(filter({ q: 'kase' }))).toBe('relevance');
    expect(effectiveSort(filter({ q: 'k' }))).toBe('newest');
  });

  it('keeps an explicit Titel A–Z or Neueste while typing', () => {
    expect(effectiveSort(filter({ q: 'kase', sort: 'title' }))).toBe('title');
    expect(effectiveSort(filter({ q: 'kase', sort: 'newest' }))).toBe('newest');
  });

  it('turns relevance into newest when the search text is cleared', () => {
    expect(effectiveSort(filter({ q: 'kase', sort: 'relevance' }))).toBe('relevance');
    expect(effectiveSort(filter({ q: '', sort: 'relevance' }))).toBe('newest');
  });
});

describe('toApiQuery', () => {
  it('sends q trimmed and with collapsed whitespace, only when searchable', () => {
    expect(toApiQuery(filter({ q: '  kartoffel   käse ' })).q).toBe('kartoffel käse');
    expect(toApiQuery(filter({ q: 'k' })).q).toBeNull();
    expect(toApiQuery(filter({ q: ' ' })).q).toBeNull();
  });

  it('never sends more than LIMITS.query characters', () => {
    const q = toApiQuery(filter({ q: `${'ab '.repeat(100)}` })).q;
    expect(typeof q === 'string' && q.length <= LIMITS.query).toBe(true);
  });

  it('cuts a long typed text before an emoji, not inside it', () => {
    const f = filter({ q: `${'ab '.repeat(66)}x🥨 kuchen` });
    expect(toApiQuery(f).q).toBe(`${'ab '.repeat(66)}x`);
    expect(() => filterKey(f)).not.toThrow();
  });

  it('sends tagMode only with tags', () => {
    expect(toApiQuery(filter({ tagMode: 'any' })).tagMode).toBeNull();
    expect(toApiQuery(filter({ tags: [3], tagMode: 'any' })).tagMode).toBe('any');
    expect(toApiQuery(filter({ tags: [3], tagMode: 'all' })).tagMode).toBeNull();
  });

  it('always sends the sort in use', () => {
    expect(toApiQuery(EMPTY_FILTER).sort).toBe('newest');
    expect(toApiQuery(filter({ q: 'suppe' })).sort).toBe('relevance');
    expect(toApiQuery(filter({ q: 'suppe', sort: 'title' })).sort).toBe('title');
    expect(buildQuery(toApiQuery(filter({ q: 'suppe', tags: [3, 7], tagMode: 'any' })))).toBe(
      'q=suppe&tags=3,7&tagMode=any&sort=relevance',
    );
  });
});

describe('filterKey', () => {
  it('is equal for filters the server answers the same way', () => {
    expect(filterKey(filter({ tags: [7, 3] }))).toBe(filterKey(filter({ tags: [3, 7] })));
    expect(filterKey(filter({ q: 'k' }))).toBe(filterKey(filter({ q: '' })));
    expect(filterKey(filter({ q: ' suppe ' }))).toBe(filterKey(filter({ q: 'suppe' })));
    expect(filterKey(filter({ tagMode: 'any' }))).toBe(filterKey(EMPTY_FILTER));
    expect(filterKey(filter({ sort: 'newest' }))).toBe(filterKey(EMPTY_FILTER));
  });

  it('differs when the result differs', () => {
    const keys = [
      filterKey(EMPTY_FILTER),
      filterKey(filter({ q: 'suppe' })),
      filterKey(filter({ q: 'suppe', sort: 'title' })),
      filterKey(filter({ tags: [3] })),
      filterKey(filter({ tags: [3, 7] })),
      filterKey(filter({ tags: [3, 7], tagMode: 'any' })),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not reorder the filter itself', () => {
    const f = filter({ tags: [7, 3] });
    filterKey(f);
    expect(f.tags).toEqual([7, 3]);
  });
});

describe('isFiltered and activeFilterCount (F-24 AK2: „als Zahl am Filtersymbol“)', () => {
  it('counts the active tags; a search text filters but is not counted', () => {
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
    expect(isFiltered(filter({ q: 'k' }))).toBe(false);
    expect(isFiltered(filter({ q: 'ka' }))).toBe(true);
    expect(isFiltered(filter({ tags: [1] }))).toBe(true);
    expect(isFiltered(filter({ tagMode: 'any', sort: 'title' }))).toBe(false);
    expect(activeFilterCount(filter({ q: 'suppe', tags: [1, 2], tagMode: 'any', sort: 'title' }))).toBe(2);
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
  });
});

describe('toggleTag (F-24 AK1: „ein Fingertipp schaltet den Filter an oder aus“)', () => {
  it('appends in activation order and removes only the tapped tag', () => {
    const one = toggleTag(EMPTY_FILTER, 7);
    const two = toggleTag(one, 3);
    expect(two.tags).toEqual([7, 3]);
    expect(toggleTag(two, 7).tags).toEqual([3]);
    expect(EMPTY_FILTER.tags).toEqual([]);
    expect(one.tags).toEqual([7]);
  });

  it('keeps the other parts of the filter', () => {
    const f = filter({ q: 'suppe', tagMode: 'any', sort: 'title' });
    expect(toggleTag(f, 4)).toEqual({ ...f, tags: [4] });
  });

  it('adds nothing beyond 20 active tags (the API rejects a 21st)', () => {
    const full = filter({ tags: Array.from({ length: 20 }, (_, i) => i + 1) });
    expect(toggleTag(full, 99)).toBe(full);
    expect(toggleTag(full, 5).tags).toHaveLength(19);
  });
});

describe('resetFilter (F-24 AK3: „entfernt alle Filter und den Suchbegriff mit einem Fingertipp“)', () => {
  it('clears q, tags and the mode and keeps Titel A–Z', () => {
    expect(resetFilter(filter({ q: 'suppe', tags: [1, 2], tagMode: 'any', sort: 'title' }))).toEqual({
      q: '',
      tags: [],
      tagMode: 'all',
      sort: 'title',
    });
    expect(resetFilter(filter({ q: 'suppe', sort: 'newest' })).sort).toBe('newest');
  });

  it('drops relevance, which needs the search term', () => {
    expect(resetFilter(filter({ q: 'suppe', sort: 'relevance' }))).toEqual(EMPTY_FILTER);
    expect(isFiltered(resetFilter(filter({ q: 'suppe', tags: [3] })))).toBe(false);
  });
});

describe('chipRow (F-24: „aktive Tags zuerst, dann die 12 meistgenutzten“)', () => {
  // Server order: count descending, unused tags last.
  const list: TagCount[] = [
    tag(1, 'Hauptgericht', 20),
    tag(2, 'Vegetarisch', 14),
    tag(3, 'Schnell', 9),
    tag(4, 'Suppe', 6),
    tag(5, 'Backen', 5),
    tag(6, 'Dessert', 4),
    tag(7, 'Für Gäste', 3),
    tag(8, 'Salat', 2),
    tag(9, 'Beilage', 1),
    tag(10, 'Frühstück', 1),
    tag(11, 'Vegan', 1),
    tag(12, 'Kuchen', 1),
    tag(13, 'Brot', 1),
    tag(14, 'Grillen', 0),
    tag(15, 'Low-Carb', 0),
  ];
  const ids = (row: ReturnType<typeof chipRow>): number[] => row.map((c) => c.tag.id);

  it('shows the 12 most used tags without a filter', () => {
    const row = chipRow(list, []);
    expect(ids(row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(row.every((c) => !c.active)).toBe(true);
  });

  it('puts the active tags first in activation order, then 12 others', () => {
    const row = chipRow(list, [14, 3]);
    expect(ids(row)).toEqual([14, 3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(row.map((c) => c.active)).toEqual([true, true, ...Array<boolean>(12).fill(false)]);
    expect(row.filter((c) => c.tag.id === 3)).toHaveLength(1);
  });

  it('skips active ids the list does not know and never repeats a tag', () => {
    expect(ids(chipRow(list, [99, 2, 2]))).toEqual([2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(chipRow([], [3])).toEqual([]);
  });

  it('fills the row with unused start tags on a new install (F-20)', () => {
    const start = ['Vegetarisch', 'Vegan', 'Schnell', 'Hauptgericht', 'Beilage', 'Suppe', 'Salat'].map(
      (name, i) => tag(i + 1, name, 0),
    );
    expect(chipRow(start, []).map((c) => c.tag.name)).toEqual(start.map((t) => t.name));
  });

  it('respects another limit', () => {
    expect(ids(chipRow(list, [5], 2))).toEqual([5, 1, 2]);
  });
});

describe('knownTags', () => {
  const list = [tag(3, 'Schnell', 9), tag(7, 'Suppe', 6)];

  it('drops ids of deleted or merged tags from an old link', () => {
    expect(knownTags(filter({ q: 'suppe', tags: [3, 99, 7], tagMode: 'any' }), list)).toEqual({
      q: 'suppe',
      tags: [3, 7],
      tagMode: 'any',
      sort: null,
    });
  });

  it('is null when every id is known', () => {
    expect(knownTags(filter({ tags: [7, 3] }), list)).toBeNull();
    expect(knownTags(EMPTY_FILTER, [])).toBeNull();
  });
});

describe('listFilterFor (two panes from 1024 px)', () => {
  it('parses the list and a detail URL with list parameters', () => {
    expect(listFilterFor('recipes', new URLSearchParams('tags=3&sort=title'))).toEqual(
      filter({ tags: [3], sort: 'title' }),
    );
    expect(listFilterFor('recipe', new URLSearchParams('q=suppe'))).toEqual(filter({ q: 'suppe' }));
  });

  it('gives a detail URL without list parameters the remembered filter', () => {
    const remembered = filter({ q: 'kuchen', tags: [5] });
    rememberListFilter(remembered);
    expect(listFilterFor('recipe', new URLSearchParams(''))).toEqual(remembered);
    expect(listFilterFor('recipe', new URLSearchParams('foo=1'))).toEqual(remembered);
    // Any list parameter wins, even an empty one.
    expect(listFilterFor('recipe', new URLSearchParams('tags='))).toEqual(EMPTY_FILTER);
    // The list itself always follows its URL.
    expect(listFilterFor('recipes', new URLSearchParams(''))).toEqual(EMPTY_FILTER);
    rememberListFilter(EMPTY_FILTER);
    expect(listFilterFor('recipe', new URLSearchParams(''))).toEqual(EMPTY_FILTER);
  });
});
