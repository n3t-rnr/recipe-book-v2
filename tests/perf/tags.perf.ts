import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection.ts';
import { reindexAll } from '../../server/db/fts.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../server/db/migrate.ts';
import type { DB } from '../../server/db/types.ts';
import { createMemoryLogger } from '../../server/log.ts';
import { normalize } from '../../shared/normalize.ts';
import type { TagCount, TagsResponse } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';
import { seed } from '../seed.ts';

/**
 * NF-04 AK3 for tag writes: rename, merge and delete run in one transaction that raises the version and
 * rebuilds the FTS row of every linked recipe, so their time grows with the tag's recipes. Measured on a
 * file database with the production PRAGMAs (openDatabase: WAL, synchronous=NORMAL), 1,000 seed recipes
 * (NF-04 AK1), once for the largest seed tag and once for tags linked to 600 of the 1,000 recipes.
 * The durations come from the one 'request' log line per request (NF-25), as in production.
 *
 * The WAL is checkpointed before every measured request. Otherwise the request whose commit pushes the
 * WAL past 1,000 pages (SQLite's wal_autocheckpoint) also pays for copying the pages into the database
 * file. That cost depends on everything written since the last checkpoint and can hit any write request,
 * not only tag writes; it is measured once and reported as an annotation, without an assertion.
 * PASSIVE, like the automatic checkpoint: the WAL file keeps its size and is reused from the start
 * (TRUNCATE would make the next write grow the file again, which production never does).
 *
 * Runs only in `pnpm perf`, never in `pnpm verify`: timings on shared runners vary too much. Run it on an
 * otherwise idle PC; with parallel E2E runs single requests were seen at 250–430 ms instead of 60–80 ms.
 */

const LIMIT_MS = 100;
const NOW = new Date('2026-09-01T12:00:00.000Z');

let dir: string;
let db: DB;
let ctx: TestContext;
let profileId: number;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-perf-tags-'));
  const log = createMemoryLogger('warn');
  const opened = openDatabase(path.join(dir, 'rezepte.sqlite'), log);
  expect(opened.status).toBe('ok');
  db = opened.db;
  runMigrations(db, { migrationsDir: MIGRATIONS_DIR, backupsDir: path.join(dir, 'backups'), log });
  seed(db, { count: 1000, now: NOW });
  ctx = createTestContext({ db });
  profileId = db.prepare('SELECT min(id) FROM profiles').pluck().get() as number;
});

afterAll(() => {
  ctx?.cleanup();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function tags(): Promise<TagCount[]> {
  const res = await ctx.app.request('http://localhost:8080/api/v1/tags');
  expect(res.status).toBe(200);
  return ((await res.json()) as TagsResponse).tags;
}

function tagByName(list: readonly TagCount[], name: string): TagCount {
  const tag = list.find((t) => t.name === name);
  if (!tag) throw new Error(`Tag "${name}" fehlt`);
  return tag;
}

function linkedRecipes(tagId: number): number {
  return db.prepare('SELECT count(*) FROM recipe_tags WHERE tag_id = ?').pluck().get(tagId) as number;
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

interface Timing {
  status: number;
  durationMs: number;
}

/** Sends one write on an empty WAL and returns the durationMs of its 'request' log line. */
async function timed(method: string, urlPath: string, body?: unknown): Promise<Timing> {
  db.pragma('wal_checkpoint(PASSIVE)');
  const init: RequestInit = { method, headers: { ...CLIENT_HEADERS, 'X-Profile-Id': String(profileId) } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await ctx.app.request(`http://localhost:8080/api/v1${urlPath}`, init);
  const requestId = res.headers.get('X-Request-Id');
  const entry = ctx.log.entries.find((e) => e.msg === 'request' && e.requestId === requestId);
  const durationMs = entry?.durationMs;
  if (typeof durationMs !== 'number') throw new Error(`Kein request-Log für ${method} ${urlPath}`);
  return { status: res.status, durationMs };
}

function expectFast(timings: Record<string, Timing>): void {
  for (const [label, timing] of Object.entries(timings)) {
    expect(timing.durationMs, label).toBeLessThan(LIMIT_MS);
  }
}

describe('tag writes stay under 100 ms with 1,000 recipes (NF-04 AK3)', () => {
  it('on the largest seed tag: rename, merge, delete', async ({ annotate }) => {
    // The tag page loads the list before any write, as in normal use.
    const list = await tags();
    const largest = list[0];
    if (!largest) throw new Error('Keine Tags im Seed');
    const sommer = tagByName(list, 'Sommer');

    const rename = await timed('PATCH', `/tags/${largest.id}`, { name: `${largest.name} neu` });
    expect(rename.status).toBe(200);
    const merge = await timed('POST', `/tags/${sommer.id}/merge`, { intoTagId: largest.id });
    expect(merge.status).toBe(200);
    const merged = linkedRecipes(largest.id);
    const remaining = (await tags())[0];
    if (!remaining) throw new Error('Keine Tags mehr');
    const remainingLinks = linkedRecipes(remaining.id);
    const remove = await timed('DELETE', `/tags/${remaining.id}`);
    expect(remove.status).toBe(204);

    await annotate(
      [
        `rename ${largest.name} (${largest.count} Rezepte): ${rename.durationMs} ms`,
        `merge ${sommer.name} (${sommer.count}) → ${largest.name} neu (danach ${merged}): ${merge.durationMs} ms`,
        `delete ${remaining.name} (${remainingLinks} verknüpft): ${remove.durationMs} ms`,
      ].join('\n'),
      'notice',
    );
    expectFast({ rename, merge, delete: remove });
  });

  it('on tags linked to at least 500 of 1,000 recipes: rename, merge, delete', async ({ annotate }) => {
    // Three extra tags on 600, 550 and 600 of the recipes (overlapping), written like the seed does.
    const ids = db.prepare('SELECT id FROM recipes ORDER BY id').pluck().all() as number[];
    const insertTag = db.prepare('INSERT INTO tags(name, name_key) VALUES (?, ?)');
    const link = db.prepare('INSERT INTO recipe_tags(recipe_id, tag_id) VALUES (?, ?)');
    const extra: [string, number[]][] = [
      ['Groß A', ids.slice(0, 600)],
      ['Groß B', ids.slice(450)],
      ['Groß C', ids.slice(200, 800)],
    ];
    db.transaction(() => {
      for (const [name, linked] of extra) {
        const id = Number(insertTag.run(name, normalize(name)).lastInsertRowid);
        for (const recipeId of linked) link.run(recipeId, id);
      }
      reindexAll(db);
    })();

    const list = await tags();
    const a = tagByName(list, 'Groß A');
    const b = tagByName(list, 'Groß B');
    const c = tagByName(list, 'Groß C');
    expect([a.count, b.count, c.count]).toEqual([600, 550, 600]);

    const rename = await timed('PATCH', `/tags/${a.id}`, { name: 'Riesig A' });
    expect(rename.status).toBe(200);
    const merge = await timed('POST', `/tags/${a.id}/merge`, { intoTagId: b.id });
    expect(merge.status).toBe(200);
    const remove = await timed('DELETE', `/tags/${c.id}`);
    expect(remove.status).toBe(204);

    // Beyond the AK, for information: after the merge Groß B is on every recipe. Deleting it rebuilds all
    // 1,000 FTS rows; normalize() and the FTS insert dominate, both outside the tag code.
    const merged = linkedRecipes(b.id);
    expect(merged).toBe(ids.length);
    const removeAll = await timed('DELETE', `/tags/${b.id}`);
    expect(removeAll.status).toBe(204);
    expect(db.prepare('SELECT count(*) FROM recipes_fts').pluck().get()).toBe(ids.length);

    // What the auto-checkpoint would add to the request that pushes the WAL past 1,000 pages.
    const startCheckpoint = performance.now();
    const [checkpoint] = db.pragma('wal_checkpoint(PASSIVE)') as { log: number }[];
    const checkpointMs = round(performance.now() - startCheckpoint);

    await annotate(
      [
        `rename Groß A (${a.count} verknüpft): ${rename.durationMs} ms`,
        `merge Riesig A (${a.count}) → Groß B (${b.count}, danach ${merged}): ${merge.durationMs} ms`,
        `delete Groß C (${c.count} verknüpft): ${remove.durationMs} ms`,
        `nur zur Info, ohne Grenze: delete Groß B (${merged} verknüpft): ${removeAll.durationMs} ms`,
        `nur zur Info, ohne Grenze: Checkpoint der ${checkpoint?.log ?? 0} WAL-Seiten danach: ${checkpointMs} ms`,
      ].join('\n'),
      'notice',
    );
    expectFast({ rename, merge, delete: remove });
  });
});
