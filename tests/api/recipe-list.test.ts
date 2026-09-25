import { afterEach, describe, expect, it } from 'vitest';
import { listRecipes } from '../../server/db/repos/recipe-list.ts';
import { buildSearchSpec } from '../../server/db/search.ts';
import type { DB } from '../../server/db/types.ts';
import type { ErrorBody, ValidationDetail } from '../../shared/error-codes.ts';
import { normalize } from '../../shared/normalize.ts';
import type { RecipeCard, RecipeListPage } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';
import { createTestDb } from '../helpers/db.ts';
import { insertProfile, insertRecipe, tracedDb } from '../helpers/recipes.ts';
import { seed } from '../seed.ts';

const BASE = 'http://localhost:8080/api/v1';
const HOST = { Host: 'localhost:8080' };

let ctx: TestContext | undefined;

function setup(db?: DB): TestContext {
  ctx = createTestContext(db ? { db } : {});
  return ctx;
}

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

async function getList(
  c: TestContext,
  query = '',
  headers: Record<string, string> = {},
): Promise<{ status: number; body: RecipeListPage }> {
  const res = await c.app.request(`${BASE}/recipes${query}`, { headers: { ...HOST, ...headers } });
  return { status: res.status, body: (await res.json()) as RecipeListPage };
}

async function getError(c: TestContext, query: string): Promise<{ status: number; body: ErrorBody }> {
  const res = await c.app.request(`${BASE}/recipes${query}`, { headers: HOST });
  return { status: res.status, body: (await res.json()) as ErrorBody };
}

/** Follows nextCursor until the end and returns all ids in list order. */
async function walk(c: TestContext, query: string): Promise<number[]> {
  const ids: number[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 1000; guard++) {
    const sep = query ? '&' : '?';
    const q = cursor ? `${query}${sep}cursor=${cursor}` : query;
    const { status, body } = await getList(c, q);
    expect(status).toBe(200);
    ids.push(...body.items.map((i) => i.id));
    cursor = body.nextCursor;
    if (!cursor) return ids;
  }
  throw new Error('pagination did not end');
}

function card(body: RecipeListPage, id: number): RecipeCard {
  const found = body.items.find((i) => i.id === id);
  if (!found) throw new Error(`card ${id} missing`);
  return found;
}

describe('GET /api/v1/recipes – pagination', () => {
  it('returns an empty first page on a fresh installation', async () => {
    const c = setup();
    const { status, body } = await getList(c);
    expect(status).toBe(200);
    expect(body).toEqual({ items: [], nextCursor: null, total: 0, totalAll: 0 });
  });

  it('pages 45 recipes as 40 + 5 without duplicates, newest first', async () => {
    const c = setup();
    const ids: number[] = [];
    for (let i = 0; i < 45; i++) {
      const minute = String(i).padStart(2, '0');
      ids.push(
        insertRecipe(c.deps.db, { title: `Rezept ${i}`, createdAt: `2026-09-01T10:${minute}:00.000Z` }),
      );
    }

    const first = await getList(c);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(40);
    expect(first.body.total).toBe(45);
    expect(first.body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);

    const second = await getList(c, `?cursor=${first.body.nextCursor}`);
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(5);
    expect(second.body.total).toBe(45);
    expect(second.body.nextCursor).toBeNull();

    const listed = [...first.body.items, ...second.body.items].map((i) => i.id);
    expect(new Set(listed).size).toBe(45);
    expect(listed).toEqual([...ids].reverse());
  });

  it('keeps the order stable across equal timestamps via the id tie-break', async () => {
    const c = setup();
    // Three timestamps shared by 15 recipes each; page boundaries fall inside the groups.
    const stamps = ['2026-09-01T10:00:00.000Z', '2026-09-02T10:00:00.000Z', '2026-09-03T10:00:00.000Z'];
    for (let i = 0; i < 45; i++) {
      insertRecipe(c.deps.db, { title: `Gleich ${i}`, createdAt: stamps[i % 3] ?? '' });
    }
    const expected = c.deps.db
      .prepare('SELECT id FROM recipes ORDER BY created_at DESC, id DESC')
      .pluck()
      .all() as number[];
    expect(await walk(c, '?limit=7')).toEqual(expected);
  });

  it('honours limit and rejects values outside 1..100', async () => {
    const c = setup();
    for (let i = 0; i < 12; i++) insertRecipe(c.deps.db, { title: `R${i}` });

    const { body } = await getList(c, '?limit=5');
    expect(body.items).toHaveLength(5);
    expect(body.nextCursor).not.toBeNull();
    expect((await getList(c, '?limit=100')).body.items).toHaveLength(12);

    for (const limit of ['0', '101', 'abc', '1.5', '-3']) {
      const res = await getError(c, `?limit=${limit}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(res.body.error.details).toEqual([
        { field: 'limit', message: 'Die Seitengröße muss zwischen 1 und 100 liegen' },
      ]);
    }
  });

  it('rejects a malformed cursor or one from another sort order with 400', async () => {
    const c = setup();
    for (let i = 0; i < 3; i++) insertRecipe(c.deps.db, { title: `R${i}` });
    const { body } = await getList(c, '?limit=1');
    const newestCursor = body.nextCursor;
    expect(newestCursor).not.toBeNull();

    const forged = Buffer.from(JSON.stringify(['n', 'kein Datum', 1])).toString('base64url');
    for (const query of [
      '?cursor=%%%',
      '?cursor=abc',
      `?cursor=${forged}`,
      `?sort=title&cursor=${newestCursor}`,
      `?sort=updated&cursor=${newestCursor}`,
    ]) {
      const res = await getError(c, query);
      expect(res.status, query).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      const details = res.body.error.details as ValidationDetail[];
      expect(details[0]?.field).toBe('cursor');
    }
  });

  it('answers the M5 filters and sort orders with 400', async () => {
    const c = setup();
    const cases: [string, string][] = [
      ['?fav=1', 'fav'],
      ['?minRating=4', 'minRating'],
      ['?sort=rating', 'sort'],
      ['?sort=myRating', 'sort'],
      ['?q=kaese&fav=1', 'fav'],
    ];
    for (const [query, field] of cases) {
      const res = await getError(c, query);
      expect(res.status, query).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION',
        message: 'Diese Filter folgen in einer späteren Version',
        details: [{ field, message: 'Diese Filter folgen in einer späteren Version' }],
      });
    }
    // Unknown sort values are a plain validation error; empty parameters count as absent.
    const unknown = await getError(c, '?sort=zufall');
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details).toEqual([{ field: 'sort', message: 'Unbekannte Sortierung' }]);
    expect((await getList(c, '?q=&sort=&tags=&tagMode=')).status).toBe(200);
    // Search, tags, tag mode and relevance are M4 features now.
    for (const query of ['?q=kaese', '?tags=1,2', '?tagMode=any', '?sort=relevance']) {
      expect((await getList(c, query)).status, query).toBe(200);
    }
  });
});

describe('GET /api/v1/recipes – sorting', () => {
  it('sorts titles A–Z per DIN 5007-1 (F-26)', async () => {
    const c = setup();
    for (const title of ['Zucchini', 'Öl', 'Birne', 'Äpfel', 'Apfelkuchen', 'Ananas']) {
      insertRecipe(c.deps.db, { title });
    }
    const { body } = await getList(c, '?sort=title');
    expect(body.items.map((i) => i.title)).toEqual([
      'Ananas',
      'Äpfel',
      'Apfelkuchen',
      'Birne',
      'Öl',
      'Zucchini',
    ]);
  });

  it('breaks equal title keys by the original title, then by id', async () => {
    const c = setup();
    const a = insertRecipe(c.deps.db, { title: 'Süßspeise' });
    const b = insertRecipe(c.deps.db, { title: 'Süssspeise' });
    const d = insertRecipe(c.deps.db, { title: 'Süßspeise' });
    // normalize: all three are "susspeise"; binary order "Süs…" < "Süß…".
    expect(await walk(c, '?sort=title&limit=1')).toEqual([b, a, d]);
  });

  it('sorts by newest (default) and by last change', async () => {
    const c = setup();
    const old = insertRecipe(c.deps.db, {
      title: 'Alt, gerade bearbeitet',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    });
    const mid = insertRecipe(c.deps.db, { title: 'Mitte', createdAt: '2026-05-01T10:00:00.000Z' });
    const fresh = insertRecipe(c.deps.db, { title: 'Neu', createdAt: '2026-09-01T10:00:00.000Z' });

    expect((await getList(c)).body.items.map((i) => i.id)).toEqual([fresh, mid, old]);
    expect((await getList(c, '?sort=newest')).body.items.map((i) => i.id)).toEqual([fresh, mid, old]);
    expect((await getList(c, '?sort=updated')).body.items.map((i) => i.id)).toEqual([old, fresh, mid]);
  });

  it('never lists recipes in the trash and counts only active ones', async () => {
    const c = setup();
    const active = insertRecipe(c.deps.db, { title: 'Aktiv' });
    insertRecipe(c.deps.db, { title: 'Weg', deletedAt: '2026-09-20T10:00:00.000Z' });
    for (const sort of ['newest', 'updated', 'title']) {
      const { body } = await getList(c, `?sort=${sort}`);
      expect(body.items.map((i) => i.id)).toEqual([active]);
      expect(body.total).toBe(1);
    }
  });
});

describe('GET /api/v1/recipes – cards', () => {
  it('builds cards with tags, times, ratings, image and per-profile fields', async () => {
    const c = setup();
    const db = c.deps.db;
    const anna = insertProfile(db, 'Anna');
    const jonas = insertProfile(db, 'Jonas');
    const full = insertRecipe(db, {
      title: 'Käsespätzle',
      prep: 20,
      cook: 25,
      updatedAt: '2026-09-02T08:00:00.000Z',
      tags: ['Vegetarisch', 'Abendessen', 'Österreichisch', 'Schnell', 'Käse'],
    });
    const prepOnly = insertRecipe(db, { title: 'Salat', prep: 10, tags: ['Sommer'] });
    const bare = insertRecipe(db, { title: 'Brot' });

    const rate = db.prepare('INSERT INTO ratings(profile_id, recipe_id, stars) VALUES (?, ?, ?)');
    rate.run(anna, full, 5);
    rate.run(jonas, full, 4);
    const sebastian = insertProfile(db, 'Sebastian');
    rate.run(sebastian, full, 4);
    db.prepare('INSERT INTO favorites(profile_id, recipe_id) VALUES (?, ?)').run(anna, full);
    db.prepare(
      'INSERT INTO images(recipe_id, file_key, width, height, bytes_total) VALUES (?, ?, ?, ?, ?)',
    ).run(full, '3f9a1c0b7d2e4a61', 2048, 1365, 123456);

    const anonymous = (await getList(c)).body;
    expect(card(anonymous, full)).toEqual({
      id: full,
      title: 'Käsespätzle',
      image: {
        urls: { s: '/media/3f9a1c0b7d2e4a61-s.webp', m: '/media/3f9a1c0b7d2e4a61-m.webp' },
        width: 2048,
        height: 1365,
      },
      // Ordered by name key: abendessen, kase, osterreichisch | schnell, vegetarisch
      tags: [
        { id: expect.any(Number), name: 'Abendessen' },
        { id: expect.any(Number), name: 'Käse' },
        { id: expect.any(Number), name: 'Österreichisch' },
      ],
      moreTags: 2,
      ratingAvg: 4.3,
      ratingCount: 3,
      myRating: null,
      isFavorite: null,
      totalMinutes: 45,
      updatedAt: '2026-09-02T08:00:00.000Z',
    });
    expect(card(anonymous, prepOnly)).toMatchObject({
      tags: [{ name: 'Sommer' }],
      moreTags: 0,
      totalMinutes: 10,
      ratingAvg: null,
      ratingCount: 0,
      image: null,
    });
    expect(card(anonymous, bare)).toMatchObject({ tags: [], moreTags: 0, totalMinutes: null });

    const asAnna = (await getList(c, '', { 'X-Profile-Id': String(anna) })).body;
    expect(card(asAnna, full)).toMatchObject({ myRating: 5, isFavorite: true });
    expect(card(asAnna, bare)).toMatchObject({ myRating: null, isFavorite: false });

    const asJonas = (await getList(c, '', { 'X-Profile-Id': String(jonas) })).body;
    expect(card(asJonas, full)).toMatchObject({ myRating: 4, isFavorite: false });
  });

  it('answers an unknown X-Profile-Id with 401', async () => {
    const c = setup();
    const res = await c.app.request(`${BASE}/recipes`, { headers: { ...HOST, 'X-Profile-Id': '999' } });
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBody).error.code).toBe('PROFILE_UNKNOWN');
  });
});

describe('GET /api/v1/recipes – statement budget (NF-04)', () => {
  const NOW = new Date('2026-09-23T10:00:00Z');

  /** 120 seeded recipes on a traced DB; returns the app, Anna's header and two tag ids ("a,b"). */
  function tracedApp(): {
    c: TestContext;
    statements: string[];
    headers: Record<string, string>;
    tags: string;
  } {
    const { db, statements } = tracedDb();
    seed(db, { count: 120, now: NOW });
    const c = setup(db);
    const profileId = db.prepare("SELECT id FROM profiles WHERE name = 'Anna'").pluck().get() as number;
    // The two tags that share the most recipes, so "all" still leaves several hits to page through.
    const pair = db
      .prepare(
        `SELECT a.tag_id AS a, b.tag_id AS b FROM recipe_tags a
         JOIN recipe_tags b ON b.recipe_id = a.recipe_id AND b.tag_id > a.tag_id
         GROUP BY a.tag_id, b.tag_id ORDER BY count(*) DESC, a.tag_id, b.tag_id LIMIT 1`,
      )
      .get() as { a: number; b: number };
    statements.length = 0;
    return { c, statements, headers: { 'X-Profile-Id': String(profileId) }, tags: `${pair.a},${pair.b}` };
  }

  /** Runs the request twice (the first compiles the statement shape) and returns the second count. */
  async function counted(
    t: ReturnType<typeof tracedApp>,
    query: string,
  ): Promise<{ body: RecipeListPage; count: number; sql: string }> {
    await getList(t.c, query, t.headers);
    t.statements.length = 0;
    const { status, body } = await getList(t.c, query, t.headers);
    expect(status, query).toBe(200);
    return { body, count: t.statements.length, sql: t.statements.join('\n---\n') };
  }

  it('needs at most 4 SQL statements per list request, including middleware', async () => {
    const t = tracedApp();
    for (const sort of ['newest', 'updated', 'title']) {
      const first = await counted(t, `?sort=${sort}`);
      expect(first.count, first.sql).toBeLessThanOrEqual(4);
      const next = await counted(t, `?sort=${sort}&cursor=${first.body.nextCursor}`);
      expect(next.body.items).toHaveLength(40);
      expect(next.count, next.sql).toBeLessThanOrEqual(4);
    }
  });

  it('stays at 4 statements with search, two tags, both modes and every sort, on every page', async () => {
    const t = tracedApp();
    const withNextPage = new Set<string>();
    for (const q of ['kartoffel kase', 'zwiebeln', 'den', 'zw']) {
      for (const tagPart of ['', `&tags=${t.tags}&tagMode=all`, `&tags=${t.tags}&tagMode=any`]) {
        for (const sort of ['relevance', 'newest', 'title']) {
          const query = `?q=${encodeURIComponent(q)}${tagPart}&sort=${sort}&limit=1`;
          const first = await counted(t, query);
          expect(first.count, `${query}\n${first.sql}`).toBeLessThanOrEqual(4);
          if (first.body.nextCursor === null) continue;
          withNextPage.add(`${tagPart}|${sort}`);
          const next = await counted(t, `${query}&cursor=${first.body.nextCursor}`);
          expect(next.body.items.length, query).toBeGreaterThan(0);
          expect(next.count, `${query} (cursor)\n${next.sql}`).toBeLessThanOrEqual(4);
        }
      }
    }
    // Every sort had a follow-up page, in plain search and with each tag mode.
    expect(withNextPage.size).toBe(9);
  });

  it('rebuilds the word list of a zero-hit search within the budget, also right after a write', async () => {
    const t = tracedApp();
    const warm = await counted(t, '?q=Spazle');
    expect(warm.body).toMatchObject({ items: [], total: 0, didYouMean: 'Spätzle' });
    // profile + page + revision header; the empty page needs no card tags, the word list is fresh.
    expect(warm.count, warm.sql).toBe(3);

    const write = await t.c.app.request(`${BASE}/profiles`, {
      method: 'POST',
      headers: CLIENT_HEADERS,
      body: JSON.stringify({ name: 'Mia' }),
    });
    expect(write.status).toBe(201);
    t.statements.length = 0;
    const stale = await getList(t.c, '?q=Spazle', t.headers);
    expect(stale.body.didYouMean).toBe('Spätzle');
    // The revision changed, so the list is rebuilt: one statement in place of the card tags.
    expect(t.statements.length, t.statements.join('\n---\n')).toBe(4);
    expect(t.statements.filter((sql) => sql.includes('UNION ALL'))).toHaveLength(1);
  });

  it('needs as many statements for 100 cards as for 40 (no N+1)', async () => {
    const t = tracedApp();
    for (const query of ['?limit=40', '?limit=100', '?q=suppe&limit=40', '?q=suppe&limit=100']) {
      const { body, count, sql } = await counted(t, query);
      expect(body.items.length, query).toBeGreaterThan(0);
      expect(count, `${query}\n${sql}`).toBe(4);
    }
  });

  it('runs the list itself in exactly 2 statements, with search and tag filter too', () => {
    const { db, statements } = tracedDb();
    seed(db, { count: 120, now: NOW });
    const profileId = db.prepare("SELECT id FROM profiles WHERE name = 'Anna'").pluck().get() as number;
    const ids = db
      .prepare('SELECT tag_id FROM recipe_tags GROUP BY tag_id ORDER BY count(*) DESC')
      .pluck()
      .all();
    const base = { cursor: null, limit: 40, profileId } as const;

    statements.length = 0;
    listRecipes(db, { ...base, sort: 'newest', search: null, tagFilter: null });
    expect(statements).toHaveLength(2);

    statements.length = 0;
    const page = listRecipes(db, {
      ...base,
      sort: 'relevance',
      search: buildSearchSpec('zwieb'),
      tagFilter: { ids: ids.slice(0, 5) as number[], mode: 'any' },
    });
    expect(page.items.length).toBeGreaterThan(0);
    // Page, filtered total, total of all recipes and revision in one statement; card tags in the other.
    expect(statements).toHaveLength(2);
    expect(page.totalAll).toBe(120);
    expect(page.revision).toBe(1);
    db.close();
  });
});

describe('tests/seed.ts', () => {
  const now = new Date('2026-09-23T10:00:00Z');

  it('seeds 120 recipes deterministically with a consistent search index', () => {
    const db = createTestDb();
    const summary = seed(db, { count: 120, now });
    const count = (sql: string) => db.prepare(sql).pluck().get() as number;

    expect(summary).toMatchObject({ recipes: 120, profiles: 3, tags: 40, ingredients: 1200, steps: 720 });
    expect(count('SELECT count(*) FROM recipes WHERE deleted_at IS NULL')).toBe(120);
    expect(count('SELECT count(*) FROM ingredients')).toBe(1200);
    expect(count('SELECT count(*) FROM steps')).toBe(720);
    expect(count('SELECT count(*) FROM recipe_tags')).toBe(360);
    expect(count('SELECT count(*) FROM tags')).toBe(40);
    expect(count('SELECT count(*) FROM ratings')).toBe(summary.ratings);
    expect(count('SELECT count(*) FROM favorites')).toBe(summary.favorites);
    expect(summary.ratings).toBeGreaterThan(0);
    expect(summary.favorites).toBeGreaterThan(0);
    expect(count('SELECT count(*) FROM recipes_fts')).toBe(count('SELECT count(*) FROM recipes'));
    expect(count("SELECT count(*) FROM recipes WHERE created_at > '2026-09-23T10:00:00.000Z'")).toBe(0);
    expect(count("SELECT count(*) FROM recipes WHERE updated_at > '2026-09-23T10:00:00.000Z'")).toBe(0);
    const keyed = db.prepare('SELECT title, title_key FROM recipes').all() as {
      title: string;
      title_key: string;
    }[];
    expect(keyed.every((r) => r.title_key === normalize(r.title))).toBe(true);

    const names = db.prepare('SELECT name FROM profiles ORDER BY created_at').pluck().all();
    expect(names).toEqual(['Sebastian', 'Anna', 'Jonas']);
    const titles = db.prepare('SELECT title FROM recipes ORDER BY id').pluck().all() as string[];
    for (const t of ['Kürbissuppe', 'Käsekuchen', 'Weißkohlsalat', 'Apfelstrudel', 'Spätzle mit Linsen'])
      expect(titles).toContain(t);
    // Search finds compounds through the index built by the seed.
    const hits = db
      .prepare(`SELECT count(*) FROM recipes_fts WHERE recipes_fts MATCH '"kurbissuppe"*'`)
      .pluck()
      .get() as number;
    expect(hits).toBeGreaterThan(0);

    const again = createTestDb();
    seed(again, { count: 120, now });
    expect(again.prepare('SELECT title FROM recipes ORDER BY id').pluck().all()).toEqual(titles);
    expect(again.prepare('SELECT count(*) FROM ratings').pluck().get()).toBe(summary.ratings);
    db.close();
    again.close();
  });

  it('pages through seeded data in every sort order without gaps or duplicates', async () => {
    const db = createTestDb();
    seed(db, { count: 120, now });
    db.prepare("UPDATE recipes SET deleted_at = '2026-09-20T10:00:00.000Z' WHERE id % 10 = 0").run();
    const c = setup(db);
    const orders: Record<string, string> = {
      newest: 'created_at DESC, id DESC',
      updated: 'updated_at DESC, id DESC',
      title: 'title_key, title, id',
    };
    for (const [sort, order] of Object.entries(orders)) {
      const expected = db
        .prepare(`SELECT id FROM recipes WHERE deleted_at IS NULL ORDER BY ${order}`)
        .pluck()
        .all() as number[];
      expect(expected).toHaveLength(108);
      expect(await walk(c, `?sort=${sort}&limit=13`)).toEqual(expected);
    }
  });
});
