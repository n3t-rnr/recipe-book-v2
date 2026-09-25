import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../server/db/migrate.ts';
import { bumpDataRevision } from '../../server/db/repos/meta.ts';
import { listSql } from '../../server/db/repos/recipe-list.ts';
import { searchWordTexts } from '../../server/db/repos/search-words.ts';
import { buildSearchSpec } from '../../server/db/search.ts';
import type { DB } from '../../server/db/types.ts';
import { createMemoryLogger } from '../../server/log.ts';
import { buildWordList } from '../../server/services/did-you-mean.ts';
import type { RecipeListPage } from '../../shared/types.ts';
import { createTestContext, type TestContext } from '../helpers/app.ts';
import { seed } from '../seed.ts';

/**
 * NF-04 benchmark (Kap. 9.1 "Performance", 9.5): server time of GET /recipes with q, 2 tags and a sort
 * (p95 ≤ 30 ms) and of GET /recipes/:id (p95 ≤ 10 ms) on 1,000 seed recipes (10 ingredients,
 * 6 steps, 3 tags each), no request over 100 ms (AK3). File database with the production PRAGMAs
 * (openDatabase: WAL, synchronous=NORMAL, cache_size) and all middleware; the server time is the
 * durationMs of the one 'request' log line per request (NF-25), exactly what the log shows later.
 * Runs only in `pnpm perf`; the result is written to test-results/perf/nf04.json.
 */

const NOW = new Date('2026-09-23T10:00:00Z');
const BASE = 'http://localhost:8080/api/v1';
const WARM_UP = 50;
const MEASURED = 500;
const LIMITS = { listP95: 30, detailP95: 10, max: 100 };
const QUERIES = [
  'kaese',
  'suppe',
  'zwieb',
  'kartoffel käse',
  'tomate',
  'apfel',
  'creme brulee',
  'weiss',
  'kuchen',
  'spazle',
];
const SORTS = ['relevance', 'title', 'newest'] as const;
const RESULT_FILE = fileURLToPath(new URL('../../test-results/perf/nf04.json', import.meta.url));

interface Stats {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

let dir: string;
let db: DB;
let ctx: TestContext;
let headers: Record<string, string>;
let topTags: number[];
const result: Record<string, unknown> = {};

/** p-quantile by the nearest-rank method: sorted[ceil(p·n) − 1]. */
function quantile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? Number.NaN;
}

function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted.at(-1) ?? Number.NaN,
  };
}

function ms(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} ms`;
}

function describeStats(label: string, s: Stats): string {
  return `${label}: n ${s.n}, p50 ${ms(s.p50)}, p95 ${ms(s.p95)}, max ${ms(s.max)}`;
}

/** Sends one request and returns its status, body and server time from the request log line. */
async function timed(pathAndQuery: string): Promise<{ status: number; body: unknown; durationMs: number }> {
  ctx.log.entries.length = 0;
  const res = await ctx.app.request(`${BASE}${pathAndQuery}`, { headers });
  const body: unknown = await res.json();
  const line = ctx.log.entries.find((e) => e.msg === 'request');
  if (typeof line?.durationMs !== 'number') throw new Error('request log line missing');
  return { status: res.status, body, durationMs: line.durationMs };
}

function listQuery(i: number): string {
  const pairs: [number, number][] = [];
  for (let a = 0; a < topTags.length; a++) {
    for (let b = a + 1; b < topTags.length; b++) pairs.push([topTags[a] ?? 0, topTags[b] ?? 0]);
  }
  const pair = pairs[i % pairs.length] ?? [0, 0];
  // The rotations are shifted against each other, so every query meets every sort, both tag modes
  // and the page-2 requests (i % 5 === 4).
  const params = new URLSearchParams({
    q: QUERIES[(i + Math.floor(i / QUERIES.length)) % QUERIES.length] ?? '',
    tags: pair.join(','),
    tagMode: Math.floor(i / SORTS.length) % 2 === 0 ? 'all' : 'any',
    sort: SORTS[i % SORTS.length] ?? 'relevance',
  });
  return `/recipes?${params.toString()}`;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-perf-nf04-'));
  const log = createMemoryLogger('warn');
  const opened = openDatabase(path.join(dir, 'rezepte.sqlite'), log);
  expect(opened.status).toBe('ok');
  db = opened.db;
  runMigrations(db, { migrationsDir: MIGRATIONS_DIR, backupsDir: path.join(dir, 'backups'), log });
  seed(db, { count: 1000, now: NOW });
  db.pragma('wal_checkpoint(TRUNCATE)');
  ctx = createTestContext({ db });
  const anna = db.prepare("SELECT id FROM profiles WHERE name = 'Anna'").pluck().get() as number;
  headers = { Host: 'localhost:8080', 'X-Profile-Id': String(anna) };
  topTags = db
    .prepare('SELECT tag_id FROM recipe_tags GROUP BY tag_id ORDER BY count(*) DESC, tag_id LIMIT 10')
    .pluck()
    .all() as number[];
  Object.assign(result, {
    date: new Date().toISOString(),
    node: process.version,
    sqlite: db.prepare('SELECT sqlite_version()').pluck().get(),
    recipes: 1000,
  });
});

afterAll(() => {
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`);
  ctx?.cleanup();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe('NF-04 server time on 1,000 recipes', () => {
  it('GET /recipes with q, 2 tags and a sort: p95 ≤ 30 ms, no request over 100 ms', async ({ annotate }) => {
    const times: number[] = [];
    let secondPages = 0;
    let hits = 0;
    for (let i = 0; i < WARM_UP + MEASURED; i++) {
      let query = listQuery(i);
      // Every 5th request loads page 2 of the same search, when there is one.
      if (i % 5 === 4) {
        const first = await timed(query);
        const next = (first.body as RecipeListPage).nextCursor;
        if (next !== null) {
          query = `${query}&cursor=${next}`;
          if (i >= WARM_UP) secondPages++;
        }
      }
      const { status, body, durationMs } = await timed(query);
      expect(status, query).toBe(200);
      if (i < WARM_UP) continue;
      times.push(durationMs);
      if ((body as RecipeListPage).total > 0) hits++;
    }
    const s = stats(times);
    result.list = { ...s, secondPages, withHits: hits };
    await annotate(
      `${describeStats('Liste/Suche', s)}; ${secondPages} × Seite 2, ${hits} mit Treffern`,
      'notice',
    );
    // The mix really searched: most requests have hits, and page 2 exists for the broader ones
    // (two tags in "all" mode rarely leave more than 40 recipes).
    expect(hits).toBeGreaterThan(MEASURED / 2);
    expect(secondPages).toBeGreaterThanOrEqual(10);
    expect(s.p95).toBeLessThanOrEqual(LIMITS.listP95);
    expect(s.max).toBeLessThan(LIMITS.max);
  });

  it('GET /recipes/:id: p95 ≤ 10 ms, no request over 100 ms', async ({ annotate }) => {
    const times: number[] = [];
    for (let i = 0; i < WARM_UP + MEASURED; i++) {
      // Spread over all ids: 1, 3, 5, … wraps around 1,000 twice.
      const id = ((i * 2) % 1000) + 1;
      const { status, body, durationMs } = await timed(`/recipes/${id}`);
      expect(status, `recipe ${id}`).toBe(200);
      expect((body as { recipe: { id: number } }).recipe.id).toBe(id);
      if (i >= WARM_UP) times.push(durationMs);
    }
    const s = stats(times);
    result.detail = s;
    await annotate(describeStats('Detail', s), 'notice');
    expect(s.p95).toBeLessThanOrEqual(LIMITS.detailP95);
    expect(s.max).toBeLessThan(LIMITS.max);
  });

  it('reports the plain list, GET /tags, a 200-character search, a suggestion and the word list', async ({
    annotate,
  }) => {
    const lines: string[] = [];
    const extras: Record<string, unknown> = {};

    // All 25 pages of the unfiltered list, newest first.
    const plain: number[] = [];
    let cursor: string | null = null;
    do {
      const r = await timed(`/recipes${cursor ? `?cursor=${cursor}` : ''}`);
      expect(r.status).toBe(200);
      plain.push(r.durationMs);
      cursor = (r.body as RecipeListPage).nextCursor;
    } while (cursor !== null);
    extras.plainList = stats(plain);
    lines.push(describeStats('Liste ohne Filter (alle Seiten)', stats(plain)));

    // GET /tags (F-19, package A1); reported with its status in case the route is missing.
    const tags: number[] = [];
    let tagsStatus = 0;
    for (let i = 0; i < 20; i++) {
      const r = await timed('/tags');
      tagsStatus = r.status;
      tags.push(r.durationMs);
    }
    extras.tags = { status: tagsStatus, ...stats(tags) };
    lines.push(`${describeStats('GET /tags', stats(tags))} (Status ${tagsStatus})`);

    // The longest allowed search text: more than 8 distinct words, so MAX_TERMS applies.
    let longQ = '';
    for (const word of ['kartoffel', 'käse', 'zwiebel', 'tomate', 'apfel', 'suppe', 'kuchen', 'creme']) {
      longQ += `${word} `;
    }
    longQ = `${longQ}${'x'.repeat(200)}`.slice(0, 200);
    const long: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await timed(`/recipes?q=${encodeURIComponent(longQ)}`);
      expect(r.status).toBe(200);
      long.push(r.durationMs);
    }
    extras.longQuery = stats(long);
    lines.push(describeStats('Suche mit 200 Zeichen', stats(long)));

    // A zero-hit search right after a write: the request rebuilds the word list and suggests (F-23).
    // The list mix above always has 2 tags, where „Meintest du“ is never computed (amendment 15).
    const suggest: number[] = [];
    for (let i = 0; i < 20; i++) {
      bumpDataRevision(db);
      const r = await timed('/recipes?q=Spazle');
      expect(r.status).toBe(200);
      expect((r.body as RecipeListPage).didYouMean).toBe('Spätzle');
      suggest.push(r.durationMs);
    }
    extras.didYouMean = stats(suggest);
    lines.push(describeStats('„Spazle“ nach einer Änderung (Wortliste neu)', stats(suggest)));

    // Word-list rebuild of „Meintest du“ (Kap. 4.5 point 7: < 5,000 words, < 5 ms), timed directly.
    const rebuild: number[] = [];
    let words = 0;
    for (let i = 0; i < 23; i++) {
      const start = performance.now();
      words = buildWordList(searchWordTexts(db)).size;
      if (i >= 3) rebuild.push(Math.round((performance.now() - start) * 10) / 10);
    }
    extras.wordList = { words, ...stats(rebuild) };
    lines.push(`${describeStats('Wortliste neu aufbauen', stats(rebuild))}, ${words} Wörter`);

    // Query plan of one search statement (report only).
    const spec = buildSearchSpec('kartoffel käse');
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN ${listSql({ sort: 'relevance', withCursor: false, terms: ['L', 'L'], tagMode: 'all' })}`,
      )
      .all({
        take: 41,
        offset: 0,
        profileId: null,
        f0: spec?.terms[0]?.fts,
        l0a: spec?.terms[0]?.likes?.[0],
        l0b: spec?.terms[0]?.likes?.[1],
        f1: spec?.terms[1]?.fts,
        l1a: spec?.terms[1]?.likes?.[0],
        l1b: spec?.terms[1]?.likes?.[1],
        ftsAny: spec?.ftsAny,
        tagIds: JSON.stringify(topTags.slice(0, 2)),
        tagCount: 2,
      }) as { detail: string }[];
    extras.searchPlan = plan.map((row) => row.detail);

    result.extras = extras;
    await annotate(lines.join('\n'), 'notice');
    for (const s of [stats(plain), stats(long), stats(suggest)]) expect(s.max).toBeLessThan(LIMITS.max);
    if (tagsStatus === 200) expect(stats(tags).max).toBeLessThan(LIMITS.max);
  });
});
