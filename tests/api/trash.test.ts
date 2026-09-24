import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reindexRecipe } from '../../server/db/fts.ts';
import { getDataRevision } from '../../server/db/repos/meta.ts';
import type { DB } from '../../server/db/types.ts';
import { purgeExpired } from '../../server/services/trash.ts';
import type { ErrorBody } from '../../shared/error-codes.ts';
import { normalize } from '../../shared/normalize.ts';
import type { TrashResponse } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';

const BASE = 'http://localhost:8080/api/v1';

let ctx: TestContext | undefined;

function setup(): TestContext {
  ctx = createTestContext();
  return ctx;
}

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

function insertProfile(db: DB, name: string): number {
  return Number(
    db.prepare('INSERT INTO profiles(name, name_key) VALUES (?, ?)').run(name, normalize(name))
      .lastInsertRowid,
  );
}

interface FullRecipe {
  title: string;
  deletedAt?: string | null;
  deletedBy?: number | null;
  fileKey?: string;
  ratedBy?: number;
}

/** A recipe with a row in every dependent table, so the purge can be checked table by table. */
function insertFullRecipe(db: DB, r: FullRecipe): number {
  const id = Number(
    db
      .prepare('INSERT INTO recipes(title, title_key, deleted_at, deleted_by) VALUES (?, ?, ?, ?)')
      .run(r.title, normalize(r.title), r.deletedAt ?? null, r.deletedBy ?? null).lastInsertRowid,
  );
  db.prepare('INSERT INTO ingredients(recipe_id, position, name, name_key) VALUES (?, 0, ?, ?)').run(
    id,
    'Zwiebeln',
    'zwiebeln',
  );
  db.prepare('INSERT INTO steps(recipe_id, position, text) VALUES (?, 0, ?)').run(id, 'Alles verrühren.');
  db.prepare("INSERT OR IGNORE INTO tags(name, name_key) VALUES ('Schnell', 'schnell')").run();
  db.prepare(
    "INSERT INTO recipe_tags(recipe_id, tag_id) SELECT ?, id FROM tags WHERE name_key = 'schnell'",
  ).run(id);
  if (r.ratedBy !== undefined) {
    db.prepare('INSERT INTO ratings(profile_id, recipe_id, stars) VALUES (?, ?, 4)').run(r.ratedBy, id);
    db.prepare('INSERT INTO favorites(profile_id, recipe_id) VALUES (?, ?)').run(r.ratedBy, id);
  }
  if (r.fileKey) {
    db.prepare(
      'INSERT INTO images(recipe_id, file_key, width, height, bytes_total) VALUES (?, ?, 2048, 1365, 1000)',
    ).run(id, r.fileKey);
  }
  reindexRecipe(db, id);
  return id;
}

function rowsOf(db: DB, recipeId: number): Record<string, number> {
  const count = (sql: string) => db.prepare(sql).pluck().get(recipeId) as number;
  return {
    recipes: count('SELECT count(*) FROM recipes WHERE id = ?'),
    ingredients: count('SELECT count(*) FROM ingredients WHERE recipe_id = ?'),
    steps: count('SELECT count(*) FROM steps WHERE recipe_id = ?'),
    recipe_tags: count('SELECT count(*) FROM recipe_tags WHERE recipe_id = ?'),
    ratings: count('SELECT count(*) FROM ratings WHERE recipe_id = ?'),
    favorites: count('SELECT count(*) FROM favorites WHERE recipe_id = ?'),
    images: count('SELECT count(*) FROM images WHERE recipe_id = ?'),
    recipes_fts: count('SELECT count(*) FROM recipes_fts WHERE rowid = ?'),
  };
}

function ftsMatchesRecipes(db: DB): boolean {
  const fts = db.prepare('SELECT count(*) FROM recipes_fts').pluck().get() as number;
  const recipes = db.prepare('SELECT count(*) FROM recipes').pluck().get() as number;
  return fts === recipes;
}

function writeImageFiles(c: TestContext, fileKey: string, variants: string[]): void {
  for (const v of variants) fs.writeFileSync(path.join(c.deps.paths.images, `${fileKey}-${v}.webp`), v);
}

function imageFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

function purge(c: TestContext, id: number | string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    c.app.request(`${BASE}/trash/${id}`, { method: 'DELETE', headers: { ...CLIENT_HEADERS, ...headers } }),
  );
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as ErrorBody).error.code;
}

describe('GET /api/v1/trash', () => {
  it('is empty on a fresh installation', async () => {
    const c = setup();
    const res = await c.app.request(`${BASE}/trash`, { headers: { Host: 'localhost:8080' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it('lists trashed recipes, newest deletion first, with deletedBy and purgeAt', async () => {
    const c = setup();
    const db = c.deps.db;
    const anna = insertProfile(db, 'Anna');
    const older = insertFullRecipe(db, {
      title: 'Käsekuchen',
      deletedAt: '2026-09-01T08:00:00.000Z',
      deletedBy: anna,
    });
    const newer = insertFullRecipe(db, {
      title: 'Kürbissuppe',
      deletedAt: '2026-09-20T18:30:00.000Z',
      deletedBy: null,
    });
    insertFullRecipe(db, { title: 'Aktiv' });

    const res = await c.app.request(`${BASE}/trash`, { headers: { Host: 'localhost:8080' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrashResponse;
    expect(body.items).toEqual([
      {
        id: newer,
        title: 'Kürbissuppe',
        deletedAt: '2026-09-20T18:30:00.000Z',
        deletedBy: null,
        purgeAt: '2026-10-20T18:30:00.000Z',
      },
      {
        id: older,
        title: 'Käsekuchen',
        deletedAt: '2026-09-01T08:00:00.000Z',
        deletedBy: { id: anna, name: 'Anna' },
        purgeAt: '2026-10-01T08:00:00.000Z',
      },
    ]);
  });
});

describe('DELETE /api/v1/trash/:id', () => {
  const FILE_KEY = '3f9a1c0b7d2e4a61';

  it('purges a trashed recipe with all rows, index entry and image files (F-08)', async () => {
    const c = setup();
    const db = c.deps.db;
    const anna = insertProfile(db, 'Anna');
    const keep = insertFullRecipe(db, { title: 'Bleibt', fileKey: 'aaaaaaaaaaaaaaaa', ratedBy: anna });
    const id = insertFullRecipe(db, {
      title: 'Käsespätzle',
      deletedAt: '2026-09-20T10:00:00.000Z',
      deletedBy: anna,
      fileKey: FILE_KEY,
      ratedBy: anna,
    });
    // l is missing on purpose: missing files are skipped, the rest still moves.
    writeImageFiles(c, FILE_KEY, ['s', 'm']);
    writeImageFiles(c, 'aaaaaaaaaaaaaaaa', ['s', 'm', 'l']);
    const revisionBefore = getDataRevision(db);

    const res = await purge(c, id, { 'X-Profile-Id': String(anna) });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    expect(rowsOf(db, id)).toEqual({
      recipes: 0,
      ingredients: 0,
      steps: 0,
      recipe_tags: 0,
      ratings: 0,
      favorites: 0,
      images: 0,
      recipes_fts: 0,
    });
    expect(ftsMatchesRecipes(db)).toBe(true);
    // Shared data of other recipes is untouched.
    expect(rowsOf(db, keep)).toMatchObject({
      recipes: 1,
      recipe_tags: 1,
      ratings: 1,
      images: 1,
      recipes_fts: 1,
    });
    expect(db.prepare('SELECT count(*) FROM tags').pluck().get()).toBe(1);

    expect(imageFiles(c.deps.paths.imagesTrash)).toEqual([`${FILE_KEY}-m.webp`, `${FILE_KEY}-s.webp`]);
    expect(imageFiles(c.deps.paths.images)).toEqual([
      'aaaaaaaaaaaaaaaa-l.webp',
      'aaaaaaaaaaaaaaaa-m.webp',
      'aaaaaaaaaaaaaaaa-s.webp',
    ]);
    // The 14-day retention in .trash starts with the move (F-16).
    const mtime = fs.statSync(path.join(c.deps.paths.imagesTrash, `${FILE_KEY}-s.webp`)).mtime;
    expect(mtime.toISOString()).toBe(c.deps.now().toISOString());

    expect(getDataRevision(db)).toBe(revisionBefore + 1);
    const trash = (await (await c.app.request(`${BASE}/trash`)).json()) as TrashResponse;
    expect(trash.items).toEqual([]);
  });

  it('refuses an active recipe with 409 NOT_IN_TRASH and keeps it', async () => {
    const c = setup();
    const anna = insertProfile(c.deps.db, 'Anna');
    const id = insertFullRecipe(c.deps.db, { title: 'Aktiv', ratedBy: anna });

    const res = await purge(c, id, { 'X-Profile-Id': String(anna) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toMatchObject({
      code: 'NOT_IN_TRASH',
      message: 'Nur Rezepte im Papierkorb können endgültig gelöscht werden',
    });
    expect(rowsOf(c.deps.db, id)).toMatchObject({ recipes: 1, ingredients: 1, ratings: 1, recipes_fts: 1 });
  });

  it('answers unknown or malformed ids with 404', async () => {
    const c = setup();
    const anna = insertProfile(c.deps.db, 'Anna');
    for (const id of ['4711', 'abc', '0', '-1', '1.5']) {
      const res = await purge(c, id, { 'X-Profile-Id': String(anna) });
      expect(res.status, id).toBe(404);
      expect(await errorCode(res)).toBe('NOT_FOUND');
    }
  });

  it('requires a profile (401) and the client header (400)', async () => {
    const c = setup();
    const id = insertFullRecipe(c.deps.db, { title: 'Weg', deletedAt: '2026-09-20T10:00:00.000Z' });

    const noProfile = await purge(c, id);
    expect(noProfile.status).toBe(401);
    expect(await errorCode(noProfile)).toBe('PROFILE_REQUIRED');

    const unknown = await purge(c, id, { 'X-Profile-Id': '999' });
    expect(unknown.status).toBe(401);
    expect(await errorCode(unknown)).toBe('PROFILE_UNKNOWN');

    const anna = insertProfile(c.deps.db, 'Anna');
    const noClient = await c.app.request(`${BASE}/trash/${id}`, {
      method: 'DELETE',
      headers: { Host: 'localhost:8080', 'X-Profile-Id': String(anna) },
    });
    expect(noClient.status).toBe(400);
    expect(await errorCode(noClient)).toBe('BAD_REQUEST');

    expect(rowsOf(c.deps.db, id).recipes).toBe(1);
  });
});

describe('purgeExpired (F-08, 30 days)', () => {
  it('purges recipes that have been in the trash for 30 days or longer', () => {
    const c = setup();
    const db = c.deps.db;
    const now = new Date('2026-09-23T10:05:00.000Z');
    const expired = insertFullRecipe(db, {
      title: 'Vor 31 Tagen',
      deletedAt: '2026-08-23T10:05:00.000Z',
      fileKey: '0123456789abcdef',
    });
    const exactly = insertFullRecipe(db, {
      title: 'Vor genau 30 Tagen',
      deletedAt: '2026-08-24T10:05:00.000Z',
    });
    const recent = insertFullRecipe(db, { title: 'Vor 29 Tagen', deletedAt: '2026-08-25T10:05:00.000Z' });
    const active = insertFullRecipe(db, { title: 'Aktiv' });
    writeImageFiles(c, '0123456789abcdef', ['s', 'm', 'l']);
    const revisionBefore = getDataRevision(db);

    expect(purgeExpired(c.deps, now)).toBe(2);
    expect(rowsOf(db, expired).recipes).toBe(0);
    expect(rowsOf(db, exactly).recipes).toBe(0);
    expect(rowsOf(db, recent).recipes).toBe(1);
    expect(rowsOf(db, active).recipes).toBe(1);
    expect(ftsMatchesRecipes(db)).toBe(true);
    expect(imageFiles(c.deps.paths.imagesTrash)).toEqual([
      '0123456789abcdef-l.webp',
      '0123456789abcdef-m.webp',
      '0123456789abcdef-s.webp',
    ]);
    expect(getDataRevision(db)).toBe(revisionBefore + 1);

    // Nothing left to do: no purge, no revision bump.
    expect(purgeExpired(c.deps, now)).toBe(0);
    expect(getDataRevision(db)).toBe(revisionBefore + 1);

    // One day later the 29-day recipe is due as well; active recipes are never purged.
    expect(purgeExpired(c.deps, new Date('2026-09-24T10:05:00.000Z'))).toBe(1);
    expect(rowsOf(db, recent).recipes).toBe(0);
    expect(purgeExpired(c.deps, new Date('2030-01-01T00:00:00.000Z'))).toBe(0);
    expect(rowsOf(db, active).recipes).toBe(1);
    expect(ftsMatchesRecipes(db)).toBe(true);
  });

  it('uses deps.now() and TRASH_DAYS by default', () => {
    const c = setup();
    const db = c.deps.db;
    // Helper clock: 2026-09-23T10:05Z; with TRASH_DAYS = 7 a deletion 8 days ago is due.
    const due = insertFullRecipe(db, { title: 'Alt', deletedAt: '2026-09-15T10:05:00.000Z' });
    const young = insertFullRecipe(db, { title: 'Jung', deletedAt: '2026-09-17T10:05:00.000Z' });
    expect(purgeExpired(c.deps)).toBe(0);
    expect(purgeExpired({ ...c.deps, config: { trashDays: 7 } })).toBe(1);
    expect(rowsOf(db, due).recipes).toBe(0);
    expect(rowsOf(db, young).recipes).toBe(1);
  });
});
