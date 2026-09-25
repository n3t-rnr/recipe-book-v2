import { afterEach, describe, expect, it } from 'vitest';
import { type ListShape, listRecipes, listSql } from '../../server/db/repos/recipe-list.ts';
import { likeContains, type SearchSpec } from '../../server/db/search.ts';
import type { ErrorBody, ValidationDetail } from '../../shared/error-codes.ts';
import type { RecipeListPage } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';
import { insertProfile, insertRecipe, type RecipeFixture, tagId } from '../helpers/recipes.ts';

/**
 * Search, tag filter and sorting of GET /recipes (F-21 to F-24, F-26, Kap. 4.5) against small
 * hand-made fixtures. The seeded 1,000-recipe checks live in search-seed.test.ts.
 */

const BASE = 'http://localhost:8080/api/v1';
const HOST = { Host: 'localhost:8080' };

let ctx: TestContext | undefined;

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

/** Fresh app whose DB holds `fixtures`; returns the ids by title (the last one wins for duplicates). */
function setup(fixtures: RecipeFixture[] = []): { c: TestContext; id: (title: string) => number } {
  ctx = createTestContext();
  const c = ctx;
  const ids = new Map<string, number>();
  for (const f of fixtures) ids.set(f.title, insertRecipe(c.deps.db, f));
  return {
    c,
    id: (title) => {
      const found = ids.get(title);
      if (found === undefined) throw new Error(`fixture ${title} missing`);
      return found;
    },
  };
}

function qs(params: Record<string, string | number>): string {
  return `?${new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])).toString()}`;
}

async function list(c: TestContext, params: Record<string, string | number> = {}): Promise<RecipeListPage> {
  const res = await c.app.request(`${BASE}/recipes${qs(params)}`, { headers: HOST });
  expect(res.status, JSON.stringify(params)).toBe(200);
  return (await res.json()) as RecipeListPage;
}

async function titles(c: TestContext, params: Record<string, string | number>): Promise<string[]> {
  return (await list(c, params)).items.map((i) => i.title);
}

async function ids(c: TestContext, params: Record<string, string | number>): Promise<number[]> {
  return (await list(c, params)).items.map((i) => i.id);
}

async function fieldError(c: TestContext, params: Record<string, string | number>): Promise<string> {
  const res = await c.app.request(`${BASE}/recipes${qs(params)}`, { headers: HOST });
  expect(res.status, JSON.stringify(params)).toBe(400);
  const { error } = (await res.json()) as ErrorBody;
  expect(error.code).toBe('VALIDATION');
  const details = error.details as ValidationDetail[];
  expect(details).toHaveLength(1);
  return `${details[0]?.field}: ${details[0]?.message}`;
}

/** Follows nextCursor and returns all ids in list order. */
async function walk(c: TestContext, params: Record<string, string | number>): Promise<number[]> {
  const all: number[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 500; guard++) {
    const page: RecipeListPage = await list(c, cursor ? { ...params, cursor } : params);
    all.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor;
    if (cursor === null) return all;
  }
  throw new Error('pagination did not end');
}

function cursorOf(tuple: unknown[]): string {
  return Buffer.from(JSON.stringify(tuple), 'utf8').toString('base64url');
}

describe('F-21 full-text search', () => {
  it('„zwieb“ finds an ingredient-only hit, „suppe“ and „kuchen“ find compounds (AK1)', async () => {
    const { c } = setup([
      { title: 'Linseneintopf', ingredients: ['rote Linsen', 'Zwiebeln'] },
      { title: 'Salat', description: 'Mit Röstzwiebeln' },
      { title: 'Kürbissuppe' },
      { title: 'Tomatensuppe' },
      { title: 'Käsekuchen' },
      { title: 'Brot' },
    ]);
    // Substrings count in title, tags and ingredients only; the description needs a word prefix.
    expect(await titles(c, { q: 'zwieb' })).toEqual(['Linseneintopf']);
    expect((await titles(c, { q: 'suppe' })).sort()).toEqual(['Kürbissuppe', 'Tomatensuppe']);
    expect(await titles(c, { q: 'kuchen' })).toEqual(['Käsekuchen']);
    expect(await titles(c, { q: 'röstzwiebeln' })).toEqual(['Salat']);
  });

  it('„tomate“ lists every title hit before any other hit (AK2)', async () => {
    const { c } = setup([
      // Stronger bm25 than a title hit (tags 6 + ingredients 4 + text 1 > title 10), still after it.
      {
        title: 'Nudelauflauf',
        tags: ['Tomaten'],
        ingredients: ['Tomaten'],
        steps: ['Tomaten würfeln.'],
      },
      { title: 'Pizza', ingredients: ['Kirschtomaten'] },
      { title: 'Tomatensuppe' },
      { title: 'Bruschetta mit Tomaten' },
      { title: 'Brot' },
    ]);
    const found = await titles(c, { q: 'tomate' });
    expect(found.slice(0, 2).sort()).toEqual(['Bruschetta mit Tomaten', 'Tomatensuppe']);
    // Prefix hits (bm25) before the substring-only hit outside the title (Kap. 4.5 point 5c).
    expect(found.slice(2)).toEqual(['Nudelauflauf', 'Pizza']);
  });

  it('„kartoffel käse“ needs both words (AK3)', async () => {
    const { c } = setup([
      { title: 'Kartoffelgratin', ingredients: ['Kartoffeln', 'Bergkäse'] },
      { title: 'Kartoffelsalat', ingredients: ['Kartoffeln', 'Essig'] },
      { title: 'Käsebrot', ingredients: ['Brot', 'Gouda'] },
    ]);
    expect(await titles(c, { q: 'kartoffel käse' })).toEqual(['Kartoffelgratin']);
    expect((await list(c, { q: 'kartoffel käse' })).total).toBe(1);
  });

  it('ranks a prefix hit in the text before a substring-only ingredient hit (Kap. 4.5 point 5)', async () => {
    const { c } = setup([
      { title: 'Pizza', ingredients: ['Parmesankäse'] },
      { title: 'Ofengemüse', description: 'Mit Käse überbacken' },
    ]);
    expect(await titles(c, { q: 'kase' })).toEqual(['Ofengemüse', 'Pizza']);
  });

  it('weights tags over ingredients over the other text (bm25 10/6/4/1)', async () => {
    // Same row length everywhere, so only the column weight differs.
    const { c } = setup([
      { title: 'Rezept Schritt', steps: ['Ingwer'] },
      { title: 'Rezept Zutat', ingredients: ['Ingwer'] },
      { title: 'Rezept Tag', tags: ['Ingwer'] },
      { title: 'Rezept Leer', steps: ['Salz'] },
      { title: 'Rezept Leer', steps: ['Salz'] },
      { title: 'Rezept Leer', steps: ['Salz'] },
    ]);
    expect(await titles(c, { q: 'ingwer' })).toEqual(['Rezept Tag', 'Rezept Zutat', 'Rezept Schritt']);
  });

  it('breaks ties by title key, then title, then id', async () => {
    const f = (title: string): RecipeFixture => ({ title, ingredients: ['Mehl'] });
    const { c } = setup([f('Käsekuchen B'), f('Käsekuchen A'), f('Kasekuchen A'), f('Käsekuchen A')]);
    const rows = c.deps.db.prepare('SELECT id, title FROM recipes ORDER BY id').all() as {
      id: number;
      title: string;
    }[];
    const [b, a1, plainA, a2] = rows.map((r) => r.id);
    // "kasekuchen a" for three of them: binary order puts "Kasekuchen A" before "Käsekuchen A".
    expect(await ids(c, { q: 'kuchen' })).toEqual([plainA, a1, a2, b]);
  });

  it('finds 2-character terms by word prefix only and still ranks title hits first', async () => {
    const { c } = setup([
      { title: 'Rührei' },
      { title: 'Eierlikörkuchen' },
      { title: 'Pfannkuchen', ingredients: ['Eier', 'Mehl'] },
      { title: 'Zwiebelkuchen' },
      { title: 'Linsensuppe', ingredients: ['Zwiebeln'], createdAt: '2026-09-20T10:00:00.000Z' },
    ]);
    expect(await titles(c, { q: 'ei' })).toEqual(['Eierlikörkuchen', 'Pfannkuchen']);
    expect(await titles(c, { q: 'zw' })).toEqual(['Zwiebelkuchen', 'Linsensuppe']);
  });

  it('lists the title hit of a prefix-only term („zw“, „oel“) first, even against a stronger bm25', async () => {
    const { c } = setup([
      // Many hits in tags, ingredients and steps outweigh one title word in bm25 (Kap. 4.5 point 5b).
      {
        title: 'Eintopf',
        tags: ['Zwiebeln', 'Öl'],
        ingredients: ['Zwiebeln', 'Öl', 'Zwiebelpulver', 'Rapsöl'],
        steps: ['Zwiebeln in Öl anbraten.', 'Zwiebeln und Öl verrühren.'],
      },
      {
        title: 'Zwiebelbrot mit Öl',
        description: 'Ein Brot aus Mehl, Wasser, Salz, Hefe und viel Zeit, dazu Butter, Quark und Kräuter.',
      },
    ]);
    // Tier 0 (every term in the title) comes before any bm25 weight (Kap. 4.5 point 5a).
    expect(await titles(c, { q: 'zw' })).toEqual(['Zwiebelbrot mit Öl', 'Eintopf']);
    expect(await titles(c, { q: 'oel' })).toEqual(['Zwiebelbrot mit Öl', 'Eintopf']);
    expect(await titles(c, { q: 'öl zw' })).toEqual(['Zwiebelbrot mit Öl', 'Eintopf']);
  });

  it('never lists or counts a trashed match', async () => {
    const { c, id } = setup([
      { title: 'Kürbissuppe' },
      { title: 'Tomatensuppe', deletedAt: '2026-09-20T10:00:00.000Z' },
    ]);
    const page = await list(c, { q: 'suppe' });
    expect(page.items.map((i) => i.id)).toEqual([id('Kürbissuppe')]);
    expect(page).toMatchObject({ total: 1, totalAll: 1 });
  });
});

describe('F-22 spelling tolerance', () => {
  it('„kase“, „käse“, „KÄSE“ and „kaese“ give the same hits', async () => {
    const { c, id } = setup([
      { title: 'Käsekuchen' },
      { title: 'Apfelkuchen' },
      { title: 'Pizza', ingredients: ['Käse'] },
    ]);
    const expected = await ids(c, { q: 'kase' });
    expect(expected).toEqual([id('Käsekuchen'), id('Pizza')]);
    for (const q of ['käse', 'KÄSE', 'kaese', 'Kaese']) expect(await ids(c, { q }), q).toEqual(expected);
  });

  it('folds ß, accents and triple letters, and keeps „Michael“ findable', async () => {
    const { c } = setup([
      { title: 'Weißkohlsalat' },
      { title: 'Crème brûlée' },
      { title: 'Schifffahrtsbrot' },
      { title: 'Süßspeise mit Äpfeln' },
      { title: 'Michaels Nudeln' },
    ]);
    expect(await titles(c, { q: 'weiss' })).toEqual(['Weißkohlsalat']);
    expect(await titles(c, { q: 'creme brulee' })).toEqual(['Crème brûlée']);
    expect(await titles(c, { q: 'schiffahrt' })).toEqual(['Schifffahrtsbrot']);
    expect(await titles(c, { q: 'schifffahrt' })).toEqual(['Schifffahrtsbrot']);
    expect(await titles(c, { q: 'susspeise' })).toEqual(['Süßspeise mit Äpfeln']);
    expect(await titles(c, { q: 'süssspeise' })).toEqual(['Süßspeise mit Äpfeln']);
    expect(await titles(c, { q: 'aepfeln' })).toEqual(['Süßspeise mit Äpfeln']);
    expect(await titles(c, { q: 'michael' })).toEqual(['Michaels Nudeln']);
  });

  it('„oel“ finds what „öl“ finds, not every word containing „ol“', async () => {
    const { c, id } = setup([
      { title: 'Salat', ingredients: ['Öl', 'Essig'] },
      { title: 'Öl-Dressing' },
      { title: 'Brokkolisuppe', ingredients: ['Brokkoli'] },
      { title: 'Vollkornbrot' },
    ]);
    const expected = await ids(c, { q: 'öl' });
    expect(expected.sort()).toEqual([id('Salat'), id('Öl-Dressing')].sort());
    expect((await ids(c, { q: 'oel' })).sort()).toEqual(expected);
    // Tier 0 for the title hit, as with „öl“.
    expect((await titles(c, { q: 'oel' }))[0]).toBe('Öl-Dressing');
  });
});

describe('search text limits and injection', () => {
  it('treats a text without a term of 2+ characters like no search', async () => {
    const { c, id } = setup([
      { title: 'Alt', createdAt: '2026-01-01T10:00:00.000Z' },
      { title: 'Neu', createdAt: '2026-09-01T10:00:00.000Z' },
    ]);
    for (const q of ['e', 'a b', '-', '   x   ']) {
      expect(await list(c, { q }), q).toMatchObject({ total: 2, totalAll: 2 });
      expect(await ids(c, { q }), q).toEqual([id('Neu'), id('Alt')]);
    }
    // sort=relevance without a term also falls back to newest instead of failing mid-typing.
    expect(await ids(c, { q: 'e', sort: 'relevance' })).toEqual([id('Neu'), id('Alt')]);
  });

  it('answers FTS and LIKE syntax with 200, never 500, and % or _ match nothing extra', async () => {
    const { c } = setup([{ title: 'Käsekuchen' }, { title: 'Brot' }, { title: 'Wasser 100%' }]);
    for (const q of [
      '"',
      '*',
      'NEAR(a b)',
      'kase OR',
      'AND',
      'title:kase',
      '^kase',
      '-kase',
      "'",
      '%',
      '_',
    ]) {
      const res = await c.app.request(`${BASE}/recipes${qs({ q })}`, { headers: HOST });
      expect(res.status, q).toBe(200);
    }
    // Operators are plain words: only recipes containing both words match.
    expect(await titles(c, { q: 'kase OR' })).toEqual([]);
    expect(await titles(c, { q: 'title:kase' })).toEqual([]);
    expect(await titles(c, { q: '-kase' })).toEqual(['Käsekuchen']);
    // A lone % or _ has no term and lists everything like an empty search. Inside the text they only
    // separate words and are never LIKE wildcards: "k_se" is not "kase".
    expect((await list(c, { q: '%' })).total).toBe(3);
    expect(await titles(c, { q: '%kuchen' })).toEqual(['Käsekuchen']);
    expect(await titles(c, { q: 'k_se' })).toEqual([]);
    expect(await titles(c, { q: '100%' })).toEqual(['Wasser 100%']);
  });

  it('escapes % and _ inside LIKE patterns (ESCAPE backslash)', () => {
    const { c, id } = setup([{ title: 'a%b' }, { title: 'axxb' }, { title: 'a_b' }, { title: 'ab' }]);
    const spec = (term: string): SearchSpec => ({
      terms: [{ term, fts: '"zzzz"*', ftsTitle: null, likes: [likeContains(term), likeContains(term)] }],
      ftsAny: '("zzzz"*)',
    });
    const found = (term: string) =>
      listRecipes(c.deps.db, {
        sort: 'title',
        cursor: null,
        limit: 10,
        profileId: null,
        search: spec(term),
        tagFilter: null,
      }).items.map((i) => i.id);
    expect(found('a%b')).toEqual([id('a%b')]);
    expect(found('a_b')).toEqual([id('a_b')]);
  });

  it('rejects a search text over 200 characters with 400 field q', async () => {
    const { c } = setup();
    expect((await list(c, { q: 'k'.repeat(200) })).total).toBe(0);
    expect(await fieldError(c, { q: 'k'.repeat(201) })).toBe('q: Suchbegriff zu lang');
  });
});

describe('F-24 tag filter', () => {
  function fixtures(): ReturnType<typeof setup> {
    return setup([
      { title: 'Gemüsecurry', tags: ['Vegetarisch', 'Schnell'] },
      { title: 'Linseneintopf', tags: ['Vegetarisch'] },
      { title: 'Schnitzel', tags: ['Schnell'] },
      { title: 'Braten', tags: ['Sonntag'] },
      { title: 'Kürbissuppe', tags: ['Vegetarisch', 'Schnell', 'Suppe'] },
      { title: 'Alte Suppe', tags: ['Vegetarisch', 'Schnell'], deletedAt: '2026-09-20T10:00:00.000Z' },
    ]);
  }

  it('„alle“ (default) needs both tags, „einer reicht“ gives the union (AK1)', async () => {
    const { c, id } = fixtures();
    const tags = `${tagId(c.deps.db, 'Vegetarisch')},${tagId(c.deps.db, 'Schnell')}`;
    const both = [id('Gemüsecurry'), id('Kürbissuppe')].sort();
    expect((await ids(c, { tags })).sort()).toEqual(both);
    expect((await ids(c, { tags, tagMode: 'all' })).sort()).toEqual(both);
    expect((await ids(c, { tags, tagMode: 'any' })).sort()).toEqual(
      [id('Gemüsecurry'), id('Linseneintopf'), id('Schnitzel'), id('Kürbissuppe')].sort(),
    );
    expect(await list(c, { tags })).toMatchObject({ total: 2, totalAll: 5 });
    // tagMode without tags filters nothing.
    expect((await list(c, { tagMode: 'any' })).total).toBe(5);
  });

  it('dedupes ids; an unknown id matches nothing in „alle“ and is ignored in „einer reicht“', async () => {
    const { c, id } = fixtures();
    const veg = tagId(c.deps.db, 'Vegetarisch');
    expect((await ids(c, { tags: `${veg},${veg}` })).sort()).toEqual(
      [id('Gemüsecurry'), id('Linseneintopf'), id('Kürbissuppe')].sort(),
    );
    expect(await list(c, { tags: `${veg},999` })).toMatchObject({ items: [], total: 0, totalAll: 5 });
    expect((await list(c, { tags: `${veg},999`, tagMode: 'any' })).total).toBe(3);
    expect((await list(c, { tags: '999' })).total).toBe(0);
  });

  it('rejects malformed tag lists and modes with 400', async () => {
    const { c } = fixtures();
    const twentyOne = Array.from({ length: 21 }, (_, i) => i + 1).join(',');
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1).join(',');
    for (const tags of [
      'abc',
      '1,,2',
      '0',
      '-1',
      '1,',
      ',1',
      '1.5',
      '01',
      twentyOne,
      '9999999999999999',
      '99999999999999999',
    ]) {
      expect(await fieldError(c, { tags }), tags).toBe('tags: Ungültige Tag-Auswahl');
    }
    expect((await list(c, { tags: twenty })).total).toBe(0);
    expect(await fieldError(c, { tagMode: 'xyz' })).toBe('tagMode: Unbekannter Filtermodus');
    expect(await fieldError(c, { tags: '1', tagMode: 'ALL' })).toBe('tagMode: Unbekannter Filtermodus');
  });

  it('combines search, two tags and title sort to the intersection in title order', async () => {
    const { c } = setup([
      { title: 'Zucchinisuppe', tags: ['Vegetarisch', 'Schnell'] },
      { title: 'Ärmelsuppe', tags: ['Vegetarisch', 'Schnell'] },
      { title: 'Brokkolisuppe', tags: ['Vegetarisch', 'Schnell', 'Grün'] },
      { title: 'Erbsensuppe', tags: ['Vegetarisch'] },
      { title: 'Gemüsecurry', tags: ['Vegetarisch', 'Schnell'] },
    ]);
    const tags = `${tagId(c.deps.db, 'Vegetarisch')},${tagId(c.deps.db, 'Schnell')}`;
    const page = await list(c, { q: 'suppe', tags, sort: 'title' });
    expect(page.items.map((i) => i.title)).toEqual(['Ärmelsuppe', 'Brokkolisuppe', 'Zucchinisuppe']);
    expect(page).toMatchObject({ total: 3, totalAll: 5 });
    expect((await titles(c, { q: 'suppe', tags, tagMode: 'any', sort: 'title' })).length).toBe(4);
  });
});

describe('F-26 sorting with a search', () => {
  it('sorts by relevance with a term and by newest without one (AK2)', async () => {
    const { c, id } = setup([
      { title: 'Kürbissuppe', createdAt: '2026-01-01T10:00:00.000Z' },
      { title: 'Eintopf', ingredients: ['Kürbis'], createdAt: '2026-09-01T10:00:00.000Z' },
    ]);
    expect(await ids(c, { q: 'kurbis' })).toEqual([id('Kürbissuppe'), id('Eintopf')]);
    expect(await ids(c, { q: 'kurbis', sort: 'relevance' })).toEqual([id('Kürbissuppe'), id('Eintopf')]);
    expect(await ids(c, { q: 'kurbis', sort: 'newest' })).toEqual([id('Eintopf'), id('Kürbissuppe')]);
    expect(await ids(c, { q: 'kurbis', sort: 'title' })).toEqual([id('Eintopf'), id('Kürbissuppe')]);
    expect(await ids(c, {})).toEqual([id('Eintopf'), id('Kürbissuppe')]);
    expect(await ids(c, { sort: 'relevance' })).toEqual([id('Eintopf'), id('Kürbissuppe')]);
  });
});

describe('paging a search', () => {
  function soups(): ReturnType<typeof setup> {
    const f: RecipeFixture[] = [];
    for (let i = 0; i < 12; i++) f.push({ title: `Suppe ${String(i).padStart(2, '0')}` });
    for (let i = 0; i < 12; i++) f.push({ title: `Topf ${i}`, tags: ['Suppe'] });
    for (let i = 0; i < 12; i++) f.push({ title: `Eintopf ${i}`, ingredients: ['Suppengrün'] });
    for (let i = 0; i < 12; i++) f.push({ title: `Gericht ${i}`, ingredients: ['Tomatensuppe'] });
    f.push({ title: 'Kuchen' });
    return setup(f);
  }

  it('walks the relevance order with an offset cursor without gaps or duplicates', async () => {
    const { c } = soups();
    const all = await ids(c, { q: 'suppe', limit: 100 });
    expect(all).toHaveLength(48);
    const walked = await walk(c, { q: 'suppe', limit: 13 });
    expect(walked).toEqual(all);
    expect(new Set(walked).size).toBe(48);
    const first = await list(c, { q: 'suppe', limit: 13 });
    expect(JSON.parse(Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8'))).toEqual(['r', 13]);
    expect(first).toMatchObject({ total: 48, totalAll: 49 });
    // Paging with tags and a keyset sort works the same way.
    expect(await walk(c, { q: 'suppe', sort: 'title', limit: 7 })).toEqual(
      await ids(c, { q: 'suppe', sort: 'title', limit: 100 }),
    );
  });

  it('rejects a relevance cursor for another sort and tampered offsets with 400 field cursor', async () => {
    const { c } = soups();
    const first = await list(c, { q: 'suppe', limit: 13 });
    const relevance = first.nextCursor ?? '';
    const newest = (await list(c, { limit: 13 })).nextCursor ?? '';
    const message = 'cursor: Ungültige Seitenmarke – bitte die Liste neu laden';
    expect(await fieldError(c, { q: 'suppe', sort: 'title', cursor: relevance })).toBe(message);
    expect(await fieldError(c, { cursor: relevance })).toBe(message);
    expect(await fieldError(c, { q: 'suppe', cursor: newest })).toBe(message);
    for (const offset of [-1, 0, 'x', 1.5, 100000]) {
      expect(await fieldError(c, { q: 'suppe', cursor: cursorOf(['r', offset]) }), String(offset)).toBe(
        message,
      );
    }
    expect((await list(c, { q: 'suppe', cursor: cursorOf(['r', 10000]) })).items).toEqual([]);
  });
});

describe('F-23 „Meintest du …?“', () => {
  const words: RecipeFixture[] = [
    { title: 'Spätzle mit Linsen', tags: ['Schwäbisch'] },
    { title: 'Lasagne', ingredients: ['Nudelplatten', 'Tomaten'] },
    { title: 'Brot' },
  ];

  it('suggests „Spätzle“ for „Spazle“ and „Lasagne“ for „Lasange“ (AK1, AK2)', async () => {
    const { c } = setup(words);
    expect(await list(c, { q: 'Spazle' })).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
      totalAll: 3,
      didYouMean: 'Spätzle',
    });
    expect((await list(c, { q: 'Lasange' })).didYouMean).toBe('Lasagne');
    // The whole query comes back, only the corrected word is replaced.
    expect((await list(c, { q: 'Linsen,  Spazle!' })).didYouMean).toBe('Linsen Spätzle');
  });

  it('suggests nothing below 4 characters or when there are hits (AK3)', async () => {
    const { c } = setup(words);
    for (const q of ['Laz', 'Spätzle', 'lasagne', 'Brt']) {
      expect(Object.hasOwn(await list(c, { q }), 'didYouMean'), q).toBe(false);
    }
    // Only the first page suggests: a follow-up page (data changed in between) gets none.
    expect(await list(c, { q: 'Spazle', cursor: cursorOf(['r', 40]) })).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
      totalAll: 3,
    });
  });

  it('suggests no word that only a trashed recipe or an unused tag has', async () => {
    const { c } = setup([
      ...words,
      {
        title: 'Rhabarberkuchen',
        deletedAt: '2026-09-20T10:00:00.000Z',
        tags: ['Steinpilze'],
        ingredients: ['Holunderblüten'],
      },
    ]);
    c.deps.db.prepare("INSERT INTO tags(name, name_key) VALUES ('Pfifferlinge', 'pfifferlinge')").run();
    // One edit from the trashed title, tag and ingredient and from the unused tag. A prefix such as
    // „Steinpilz“ would prove nothing: a term inside a known word is never corrected.
    for (const q of ['Rhababerkuchen', 'Steinpilse', 'Holundrblüten', 'Pfiferlinge']) {
      expect(await list(c, { q }), q).toEqual({ items: [], nextCursor: null, total: 0, totalAll: 3 });
    }
  });

  it('corrects only searched words: a word after the first 8 terms caused no 0 and stays', async () => {
    const { c } = setup(words);
    // No recipe has all of the first 8 words; „Spazle“ as 9th word is not searched at all.
    const known = 'Brot Lasagne Linsen Tomaten Nudelplatten Schwäbisch Spätzle mit';
    expect(await list(c, { q: `${known} Spazle` })).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
      totalAll: 3,
    });
    expect((await list(c, { q: `Spazle ${known}` })).didYouMean).toBe(`Spätzle ${known}`);
    // A repeated word is looked up once and corrected everywhere.
    expect((await list(c, { q: 'Spazle Brot spazle' })).didYouMean).toBe('Spätzle Brot Spätzle');
  });

  it('keeps an ae/oe/ue spelling as typed and corrects only the real typo (F-22)', async () => {
    const { c } = setup([{ title: 'Käse-Lauch-Suppe' }, { title: 'Gurkensalat' }]);
    // Both words exist, just not together: 0 hits, but nothing to correct.
    expect(await list(c, { q: 'kaese gurkensalat' })).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
      totalAll: 2,
    });
    const suggested = (await list(c, { q: 'Kaese Lauhc' })).didYouMean;
    expect(suggested).toBe('Kaese Lauch');
    expect(await titles(c, { q: suggested ?? '' })).toEqual(['Käse-Lauch-Suppe']);
  });

  it('does not suggest with a tag filter, where the 0 may come from the tags', async () => {
    const { c } = setup([...words, { title: 'Salat', tags: ['Vegan'] }]);
    const vegan = tagId(c.deps.db, 'Vegan');
    const page = await list(c, { q: 'Spazle', tags: vegan });
    expect(page).toEqual({ items: [], nextCursor: null, total: 0, totalAll: 4 });
    expect((await list(c, { q: 'Spazle' })).didYouMean).toBe('Spätzle');
  });

  it('picks up new words after a write (revision change)', async () => {
    const { c } = setup([{ title: 'Brot' }]);
    const anna = insertProfile(c.deps.db, 'Anna');
    expect(Object.hasOwn(await list(c, { q: 'Spazle' }), 'didYouMean')).toBe(false);
    const res = await c.app.request(`${BASE}/recipes`, {
      method: 'POST',
      headers: { ...CLIENT_HEADERS, 'X-Profile-Id': String(anna) },
      body: JSON.stringify({ title: 'Schwäbische Spätzle', createKey: 'search-dym-0001' }),
    });
    expect(res.status).toBe(201);
    expect((await list(c, { q: 'Spazle' })).didYouMean).toBe('Spätzle');
  });
});

describe('FTS maintenance through the API (M4 „FTS-Pflege inkl. Purge“)', () => {
  it('finds a recipe until it is trashed, again after restore, and never after the purge', async () => {
    const { c } = setup([{ title: 'Brot' }]);
    const anna = insertProfile(c.deps.db, 'Anna');
    const headers = { ...CLIENT_HEADERS, 'X-Profile-Id': String(anna) };
    const created = await c.app.request(`${BASE}/recipes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Quittengelee', createKey: 'search-purge-0001', tags: ['Einmachen'] }),
    });
    expect(created.status).toBe(201);
    const { recipe } = (await created.json()) as { recipe: { id: number } };
    const call = (method: string, path: string) => c.app.request(`${BASE}${path}`, { method, headers });
    const count = (sql: string) => c.deps.db.prepare(sql).pluck().get() as number;

    expect(await ids(c, { q: 'quitten' })).toEqual([recipe.id]);
    expect((await call('DELETE', `/recipes/${recipe.id}`)).status).toBe(204);
    expect(await ids(c, { q: 'quitten' })).toEqual([]);
    expect((await call('POST', `/recipes/${recipe.id}/restore`)).status).toBe(200);
    expect(await ids(c, { q: 'einmachen' })).toEqual([recipe.id]);
    expect((await call('DELETE', `/recipes/${recipe.id}`)).status).toBe(204);
    expect((await call('DELETE', `/trash/${recipe.id}`)).status).toBe(204);

    expect(await list(c, { q: 'quitten' })).toMatchObject({ items: [], total: 0 });
    expect(count(`SELECT count(*) FROM recipes_fts WHERE recipes_fts MATCH '"quittengelee"*'`)).toBe(0);
    expect(count('SELECT count(*) FROM recipes_fts')).toBe(count('SELECT count(*) FROM recipes'));
  });
});

describe('search statements (NF-04)', () => {
  function plan(c: TestContext, shape: ListShape): string[] {
    const params = {
      take: 41,
      offset: 0,
      profileId: null,
      at: '2026-09-01T10:00:00.000Z',
      key: 'k',
      title: 'K',
      id: 1,
      f0: '"zwieb"*',
      l0a: '%zwieb%',
      l0b: '%zwieb%',
      f1: '"zw"*',
      t1: 'title : ("zw"*)',
      ftsAny: '("zwieb"*) OR ("zw"*)',
      tagIds: '[1,2]',
      tagCount: 2,
    };
    const rows = c.deps.db.prepare(`EXPLAIN QUERY PLAN ${listSql(shape)}`).all(params) as {
      detail: string;
    }[];
    return rows.map((r) => r.detail);
  }

  it('materializes the hits and the bm25 ranking once per statement', () => {
    const { c } = setup();
    const relevance = plan(c, { sort: 'relevance', withCursor: false, terms: ['L', 'S'], tagMode: 'all' });
    expect(relevance).toContain('MATERIALIZE hits');
    expect(relevance).toContain('MATERIALIZE rank');
    expect(plan(c, { sort: 'title', withCursor: true, terms: ['L'], tagMode: 'any' })).toContain(
      'MATERIALIZE hits',
    );
  });

  it('keeps the unfiltered M2 statement: the page walks the sort index without a sort step', () => {
    const { c } = setup();
    const index = {
      newest: 'idx_recipes_created',
      updated: 'idx_recipes_updated',
      title: 'idx_recipes_title',
    };
    for (const [sort, name] of Object.entries(index) as [ListShape['sort'], string][]) {
      for (const withCursor of [false, true]) {
        const detail = plan(c, { sort, withCursor, terms: [], tagMode: null });
        const page = detail.indexOf('MATERIALIZE page');
        expect(detail[page + 1], `${sort} ${withCursor}`).toMatch(
          new RegExp(`^(SCAN|SEARCH) recipes USING INDEX ${name}`),
        );
        expect(detail[page + 2], `${sort} ${withCursor}`).toBe('SCAN t');
        expect(listSql({ sort, withCursor, terms: [], tagMode: null })).not.toMatch(
          /total_all|hits|json_each/,
        );
      }
    }
  });
});
