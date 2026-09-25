import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalize, queryVariants, searchTerms } from '../../shared/normalize.ts';
import type { RecipeListPage } from '../../shared/types.ts';
import { createTestContext, type TestContext } from '../helpers/app.ts';
import { createTestDb } from '../helpers/db.ts';
import { seed } from '../seed.ts';

/**
 * The search on the 1,000 seeded recipes of the NF-04 benchmark (Kap. 9.3): the M4 DoD searches
 * „kaese“, „suppe“, „zwieb“, the ranking invariants and 20 filtered searches against a brute-force
 * oracle written only with normalize, searchTerms and queryVariants. Read-only, so one DB for all.
 */

const BASE = 'http://localhost:8080/api/v1';
const HOST = { Host: 'localhost:8080' };

interface Doc {
  id: number;
  title: string;
  titleKey: string;
  createdAt: string;
  /** Word tokens of the four FTS columns (normalized like the index). */
  tokens: string[];
  /** title_key plus tag and ingredient keys: the substring sources of terms with 3+ characters. */
  keys: string[];
  tagIds: Set<number>;
}

let ctx: TestContext;
let docs: Doc[];
let tagsByUse: number[];

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== '');
}

beforeAll(() => {
  const db = createTestDb();
  seed(db, { count: 1000, now: new Date('2026-09-23T10:00:00Z') });
  ctx = createTestContext({ db });

  const recipes = db
    .prepare(
      'SELECT id, title, title_key, description, created_at FROM recipes WHERE deleted_at IS NULL ORDER BY id',
    )
    .all() as { id: number; title: string; title_key: string; description: string; created_at: string }[];
  const ingredients = db
    .prepare('SELECT recipe_id, group_name, name, name_key FROM ingredients ORDER BY recipe_id, position')
    .all() as { recipe_id: number; group_name: string; name: string; name_key: string }[];
  const steps = db.prepare('SELECT recipe_id, text FROM steps').all() as {
    recipe_id: number;
    text: string;
  }[];
  const links = db
    .prepare(
      'SELECT rt.recipe_id, t.id, t.name, t.name_key FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id',
    )
    .all() as { recipe_id: number; id: number; name: string; name_key: string }[];

  const byId = new Map<number, Doc>();
  docs = recipes.map((r) => {
    const doc: Doc = {
      id: r.id,
      title: r.title,
      titleKey: r.title_key,
      createdAt: r.created_at,
      tokens: [...tokenize(r.title), ...tokenize(r.description)],
      keys: [r.title_key],
      tagIds: new Set(),
    };
    byId.set(r.id, doc);
    return doc;
  });
  for (const i of ingredients) {
    const doc = byId.get(i.recipe_id);
    if (!doc) continue;
    doc.tokens.push(...tokenize(i.group_name), ...tokenize(i.name));
    doc.keys.push(i.name_key);
  }
  for (const s of steps) byId.get(s.recipe_id)?.tokens.push(...tokenize(s.text));
  for (const l of links) {
    const doc = byId.get(l.recipe_id);
    if (!doc) continue;
    doc.tokens.push(...tokenize(l.name));
    doc.keys.push(l.name_key);
    doc.tagIds.add(l.id);
  }
  tagsByUse = db
    .prepare('SELECT tag_id FROM recipe_tags GROUP BY tag_id ORDER BY count(*) DESC, tag_id')
    .pluck()
    .all() as number[];
});

afterAll(() => {
  ctx.cleanup();
});

/**
 * Kap. 4.5 by brute force: word prefix in any column, or substring of a title, tag or ingredient key
 * when every spelling of the term has 3+ characters ("oel" is „Öl“ and stays prefix-only).
 */
function oracle(q: string, tags: number[], mode: 'all' | 'any'): Doc[] {
  const terms = [...new Set(searchTerms(q))].slice(0, 8);
  return docs.filter((doc) => {
    const searched = terms.every((term) => {
      const variants = queryVariants(term).filter((v) => v.length >= 2);
      const substrings = variants.every((v) => v.length >= 3);
      return variants.some(
        (v) =>
          doc.tokens.some((token) => token.startsWith(v)) ||
          (substrings && doc.keys.some((key) => key.includes(v))),
      );
    });
    const tagged =
      mode === 'all' ? tags.every((t) => doc.tagIds.has(t)) : tags.some((t) => doc.tagIds.has(t));
    return searched && (tags.length === 0 || tagged);
  });
}

async function page(params: Record<string, string | number>): Promise<RecipeListPage> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]));
  const res = await ctx.app.request(`${BASE}/recipes?${query.toString()}`, { headers: HOST });
  expect(res.status, query.toString()).toBe(200);
  return (await res.json()) as RecipeListPage;
}

async function walk(params: Record<string, string | number>): Promise<RecipeListPage['items']> {
  const items: RecipeListPage['items'] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const p: RecipeListPage = await page(cursor ? { ...params, cursor } : params);
    items.push(...p.items);
    cursor = p.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error('pagination did not end');
}

function doc(id: number): Doc {
  const found = docs.find((d) => d.id === id);
  if (!found) throw new Error(`recipe ${id} is not active`);
  return found;
}

describe('M4 DoD searches on 1,000 seeded recipes', () => {
  it('„kaese“ finds Käsekuchen and Käsespätzle on the first page', async () => {
    const first = (await page({ q: 'kaese' })).items.map((i) => i.title);
    expect(first).toContain('Käsekuchen');
    expect(first).toContain('Käsespätzle');
  });

  it('„suppe“ finds Kürbissuppe and Tomatensuppe on the first page', async () => {
    const first = (await page({ q: 'suppe' })).items.map((i) => i.title);
    expect(first).toContain('Kürbissuppe');
    expect(first).toContain('Tomatensuppe');
  });

  it('„zwieb“ finds Zwiebelkuchen and more than 10 recipes with onions only as an ingredient', async () => {
    const all = await walk({ q: 'zwieb', limit: 100 });
    expect(all.map((i) => i.title)).toContain('Zwiebelkuchen');
    const ingredientOnly = all.filter((i) => !doc(i.id).titleKey.includes('zwieb'));
    expect(ingredientOnly.length).toBeGreaterThan(10);
    expect((await page({ q: 'zwieb' })).total).toBe(all.length);
  });

  it('„oel“ and „öl“ find the same recipes, and „aes“ the same as „äs“ (F-22 on the seed)', async () => {
    for (const [umlaut, plain] of [
      ['öl', 'oel'],
      ['äs', 'aes'],
    ] as const) {
      const expected = (await walk({ q: umlaut, limit: 100 })).map((i) => i.id).sort((a, b) => a - b);
      expect(expected.length, umlaut).toBeGreaterThan(40);
      const found = (await walk({ q: plain, limit: 100 })).map((i) => i.id).sort((a, b) => a - b);
      expect(found, plain).toEqual(expected);
      expect(found, plain).toEqual(oracle(plain, [], 'all').map((d) => d.id));
    }
  });

  it('„Spazle“ has no hit and suggests „Spätzle“ (F-23 on the seed)', async () => {
    expect(await page({ q: 'Spazle' })).toMatchObject({ items: [], total: 0, didYouMean: 'Spätzle' });
    expect((await page({ q: 'Lasange' })).didYouMean).toBe('Lasagne');
  });
});

describe('ranking invariants on the seed', () => {
  it.each(['tomate', 'suppe', 'kase'])('„%s“ lists every title hit before all other hits', async (q) => {
    const variants = queryVariants(q);
    const inTitle = (await walk({ q, limit: 100 })).map((i) =>
      variants.some((v) => doc(i.id).titleKey.includes(v)),
    );
    const firstOther = inTitle.indexOf(false);
    expect(inTitle.filter(Boolean).length).toBeGreaterThan(5);
    expect(firstOther).toBeGreaterThan(0);
    expect(inTitle.slice(firstOther)).not.toContain(true);
  });

  it('walks the relevance order in pages of 13 exactly like in pages of 100', async () => {
    for (const q of ['zwieb', 'kartoffel', 'mit']) {
      const big = (await walk({ q, limit: 100 })).map((i) => i.id);
      const small = (await walk({ q, limit: 13 })).map((i) => i.id);
      expect(small, q).toEqual(big);
      expect(new Set(small).size, q).toBe(small.length);
    }
  });
});

describe('20 filtered searches against the brute-force oracle', () => {
  const words = [
    'kaese',
    'suppe',
    'zwieb',
    'kartoffel käse',
    'tomate',
    'apfel',
    'creme',
    'zw',
    'michael',
    'teig',
  ];
  const sorts = ['relevance', 'title', 'newest'] as const;
  const cases = Array.from({ length: 20 }, (_, i) => ({
    q: words[i % words.length] ?? '',
    pair: Math.floor(i / 2),
    mode: i % 2 === 0 ? ('all' as const) : ('any' as const),
    sort: sorts[i % sorts.length] ?? 'relevance',
  }));
  let nonEmpty = 0;

  it.each(cases)('q=$q, tag pair $pair ($mode), sort=$sort', async ({ q, pair, mode, sort }) => {
    const tags = [tagsByUse[pair] ?? 0, tagsByUse[(pair + 3) % 10] ?? 0];
    const expected = oracle(q, tags, mode);
    const items = await walk({ q, tags: tags.join(','), tagMode: mode, sort, limit: 100 });
    expect(items.map((i) => i.id).sort((a, b) => a - b)).toEqual(expected.map((d) => d.id));
    expect((await page({ q, tags: tags.join(','), tagMode: mode, sort })).total).toBe(expected.length);
    if (sort === 'newest') {
      const order = [...expected].sort((a, b) =>
        a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1,
      );
      expect(items.map((i) => i.id)).toEqual(order.map((d) => d.id));
    }
    if (sort === 'title') {
      const order = [...expected].sort((a, b) =>
        a.titleKey !== b.titleKey
          ? a.titleKey < b.titleKey
            ? -1
            : 1
          : a.title !== b.title
            ? a.title < b.title
              ? -1
              : 1
            : a.id - b.id,
      );
      expect(items.map((i) => i.id)).toEqual(order.map((d) => d.id));
    }
    if (expected.length > 0) nonEmpty++;
  });

  it('compared real result sets, not only empty ones', () => {
    expect(nonEmpty).toBeGreaterThanOrEqual(14);
  });
});
