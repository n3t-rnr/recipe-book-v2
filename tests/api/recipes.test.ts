import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDataRevision } from '../../server/db/repos/meta.ts';
import { purgeExpired } from '../../server/services/trash.ts';
import type { ErrorBody } from '../../shared/error-codes.ts';
import { normalize } from '../../shared/normalize.ts';
import type { InTrashDetails, RecipeDetail, RecipeResponse } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';
import { seed } from '../seed.ts';

const API = 'http://localhost:8080/api/v1';
const NOW = '2026-09-23T10:05:00.000Z';

let ctx: TestContext;
let clock: Date;
let sebastian: number;
let keyCounter = 0;

beforeEach(() => {
  clock = new Date(NOW);
  ctx = createTestContext({ now: () => clock });
  sebastian = addProfile('Sebastian');
});

afterEach(() => {
  ctx.cleanup();
});

function addProfile(name: string): number {
  return Number(
    ctx.deps.db.prepare('INSERT INTO profiles(name, name_key) VALUES (?, ?)').run(name, normalize(name))
      .lastInsertRowid,
  );
}

function newKey(): string {
  keyCounter++;
  return `create-key-${String(keyCounter).padStart(6, '0')}`;
}

interface CallOptions {
  /** Defaults to Sebastian; null sends no X-Profile-Id. */
  profileId?: number | null;
  body?: unknown;
  rawBody?: string;
}

async function call(method: string, urlPath: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...CLIENT_HEADERS };
  const profileId = options.profileId === undefined ? sebastian : options.profileId;
  if (profileId !== null) headers['X-Profile-Id'] = String(profileId);
  const init: RequestInit = { method, headers };
  if (options.rawBody !== undefined) init.body = options.rawBody;
  else if (options.body !== undefined) init.body = JSON.stringify(options.body);
  return ctx.app.request(`${API}${urlPath}`, init);
}

async function errorOf(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

async function recipeOf(res: Response): Promise<RecipeDetail> {
  return ((await res.json()) as RecipeResponse).recipe;
}

async function create(body: Record<string, unknown>, profileId: number = sebastian): Promise<RecipeDetail> {
  const res = await call('POST', '/recipes', { body: { createKey: newKey(), ...body }, profileId });
  expect(res.status).toBe(201);
  return recipeOf(res);
}

function count(table: string): number {
  return ctx.deps.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
}

function ftsMatch(query: string): number[] {
  return ctx.deps.db
    .prepare('SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH ? ORDER BY rowid')
    .pluck()
    .all(query) as number[];
}

function addImage(fileKey: string, recipeId: number | null = null): number {
  return Number(
    ctx.deps.db
      .prepare('INSERT INTO images(recipe_id, file_key, width, height, bytes_total) VALUES (?, ?, ?, ?, ?)')
      .run(recipeId, fileKey, 2048, 1365, 350_000).lastInsertRowid,
  );
}

const KAESESPAETZLE = {
  title: 'Käsespätzle',
  description: 'Schwäbischer Klassiker mit Röstzwiebeln',
  servings: 4,
  servingsUnit: 'Portionen',
  prepMinutes: 20,
  cookMinutes: 25,
  source: 'Omas Kochbuch S. 12',
  ingredients: [
    { group: 'Für den Teig', amount: 400, amountMax: null, unit: 'g', name: 'Mehl', note: 'gesiebt' },
    { group: 'Für den Teig', amount: 4, amountMax: null, unit: '', name: 'Eier', note: 'Größe M' },
    { group: '', amount: 200, amountMax: null, unit: 'g', name: 'Bergkäse', note: 'frisch gerieben' },
  ],
  steps: [
    { text: 'Mehl, Eier und Wasser zu einem zähen Teig schlagen.' },
    { text: 'Spätzle ins kochende Wasser schaben.\nMit Käse schichten.' },
  ],
  tags: ['Vegetarisch', 'Schwäbisch'],
};

describe('POST /recipes (F-06)', () => {
  it('creates a recipe from a title only and returns the full detail', async () => {
    const res = await call('POST', '/recipes', { body: { title: 'Linsensuppe', createKey: newKey() } });
    expect(res.status).toBe(201);
    const recipe = await recipeOf(res);
    expect(recipe).toEqual({
      id: expect.any(Number),
      title: 'Linsensuppe',
      description: '',
      servings: null,
      servingsUnit: 'Portionen',
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      source: '',
      ingredients: [],
      steps: [],
      tags: [],
      image: null,
      rating: { avg: null, count: 0, mine: null, byProfile: [] },
      isFavorite: false,
      createdBy: { id: sebastian, name: 'Sebastian' },
      updatedBy: { id: sebastian, name: 'Sebastian' },
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    });

    const get = await call('GET', `/recipes/${recipe.id}`);
    expect(get.status).toBe(200);
    expect(await recipeOf(get)).toEqual(recipe);
  });

  it('keeps "Käsespätzle" with 3 ingredients, 2 steps and 2 tags unchanged incl. umlauts', async () => {
    const created = await create(KAESESPAETZLE);
    const res = await call('GET', `/recipes/${created.id}`);
    expect(res.status).toBe(200);
    const recipe = await recipeOf(res);

    expect(recipe.title).toBe('Käsespätzle');
    expect(recipe.description).toBe(KAESESPAETZLE.description);
    expect(recipe.servings).toBe(4);
    expect(recipe.prepMinutes).toBe(20);
    expect(recipe.cookMinutes).toBe(25);
    expect(recipe.totalMinutes).toBe(45);
    expect(recipe.source).toBe('Omas Kochbuch S. 12');
    expect(recipe.ingredients.map(({ id: _id, ...rest }) => rest)).toEqual(KAESESPAETZLE.ingredients);
    expect(recipe.steps.map((s) => ({ text: s.text }))).toEqual(KAESESPAETZLE.steps);
    // Ordered by name_key: "schwabisch" before "vegetarisch".
    expect(recipe.tags.map((t) => t.name)).toEqual(['Schwäbisch', 'Vegetarisch']);
    expect(recipe).toEqual(created);
  });

  it('rejects a 121-character title with 400 VALIDATION on field "title"', async () => {
    const res = await call('POST', '/recipes', { body: { title: 'a'.repeat(121), createKey: newKey() } });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toBe('Eingaben prüfen');
    const details = error.details as { field: string; message: string }[];
    expect(details[0]?.field).toBe('title');
    expect(details[0]?.message).toBe('Titel darf höchstens 120 Zeichen lang sein');
    expect(count('recipes')).toBe(0);

    await create({ title: 'a'.repeat(120) });
  });

  it('rejects an empty or blank title', async () => {
    const res = await call('POST', '/recipes', { body: { title: '   ', createKey: newKey() } });
    expect(res.status).toBe(400);
    const details = (await errorOf(res)).details as { field: string }[];
    expect(details[0]?.field).toBe('title');
  });

  it('takes the author from X-Profile-Id and ignores profileId/createdBy in the body (F-05)', async () => {
    const anna = addProfile('Anna');
    const recipe = await create({ title: 'Pfannkuchen', profileId: anna, createdBy: anna, version: 99 });
    expect(recipe.createdBy).toEqual({ id: sebastian, name: 'Sebastian' });
    expect(recipe.updatedBy).toEqual({ id: sebastian, name: 'Sebastian' });
    expect(recipe.version).toBe(1);
    const row = ctx.deps.db
      .prepare('SELECT created_by, updated_by FROM recipes WHERE id = ?')
      .get(recipe.id) as { created_by: number; updated_by: number };
    expect(row).toEqual({ created_by: sebastian, updated_by: sebastian });
  });

  it('requires a profile: 401 PROFILE_REQUIRED without X-Profile-Id, 401 PROFILE_UNKNOWN for an unknown one', async () => {
    const missing = await call('POST', '/recipes', {
      body: { title: 'Linsensuppe', createKey: newKey() },
      profileId: null,
    });
    expect(missing.status).toBe(401);
    expect((await errorOf(missing)).code).toBe('PROFILE_REQUIRED');

    const unknown = await call('POST', '/recipes', {
      body: { title: 'Linsensuppe', createKey: newKey() },
      profileId: 999,
    });
    expect(unknown.status).toBe(401);
    expect((await errorOf(unknown)).code).toBe('PROFILE_UNKNOWN');
    expect(count('recipes')).toBe(0);
  });

  it('answers invalid JSON with 400 VALIDATION "Ungültiges JSON"', async () => {
    const res = await call('POST', '/recipes', { rawBody: '{"title": "Linsen' });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toBe('Ungültiges JSON');
  });

  it('requires a valid createKey', async () => {
    const res = await call('POST', '/recipes', { body: { title: 'Linsensuppe' } });
    expect(res.status).toBe(400);
    const details = (await errorOf(res)).details as { field: string }[];
    expect(details.map((d) => d.field)).toEqual(['createKey']);
  });

  it('bumps the data revision on every successful write', async () => {
    const before = getDataRevision(ctx.deps.db);
    const res = await call('POST', '/recipes', { body: { title: 'Linsensuppe', createKey: newKey() } });
    expect(res.status).toBe(201);
    expect(getDataRevision(ctx.deps.db)).toBe(before + 1);
    expect(res.headers.get('x-data-revision')).toBe(String(before + 1));
    const id = (await recipeOf(res)).id;

    const put = await call('PUT', `/recipes/${id}`, { body: { title: 'Linsen-Eintopf', version: 1 } });
    expect(put.status).toBe(200);
    const del = await call('DELETE', `/recipes/${id}`);
    expect(del.status).toBe(204);
    const restore = await call('POST', `/recipes/${id}/restore`);
    expect(restore.status).toBe(200);
    expect(getDataRevision(ctx.deps.db)).toBe(before + 4);

    const failed = await call('POST', '/recipes', { body: { title: '' } });
    expect(failed.status).toBe(400);
    expect(getDataRevision(ctx.deps.db)).toBe(before + 4);
  });
});

describe('ingredients and steps (F-10, F-11)', () => {
  it('stores group headings, amounts without value, ranges and keeps the order', async () => {
    const ingredients = [
      { group: '', amount: 200, amountMax: null, unit: 'g', name: 'Mehl', note: 'gesiebt' },
      { group: '', amount: null, amountMax: null, unit: '', name: 'Salz', note: '' },
      { group: 'Für die Soße', amount: 2, amountMax: 3, unit: 'EL', name: 'Olivenöl', note: '' },
      { group: 'Für die Soße', amount: 0.5, amountMax: null, unit: 'TL', name: 'Pfeffer', note: '' },
      { group: 'Für die Soße', amount: 1 / 3, amountMax: null, unit: 'Bund', name: 'Petersilie', note: '' },
    ];
    const recipe = await create({ title: 'Nudeln mit Soße', ingredients });
    expect(recipe.ingredients.map(({ id: _id, ...rest }) => rest)).toEqual(ingredients);

    const rows = ctx.deps.db
      .prepare(
        `SELECT position, group_name, amount, amount_max, unit, name, name_key, note
         FROM ingredients WHERE recipe_id = ? ORDER BY position`,
      )
      .all(recipe.id);
    expect(rows[0]).toEqual({
      position: 0,
      group_name: '',
      amount: 200,
      amount_max: null,
      unit: 'g',
      name: 'Mehl',
      name_key: 'mehl',
      note: 'gesiebt',
    });
    expect(rows[2]).toMatchObject({ position: 2, amount: 2, amount_max: 3, name_key: 'olivenol' });
  });

  it('defaults missing optional ingredient fields', async () => {
    const recipe = await create({ title: 'Brot', ingredients: [{ name: 'Mehl' }] });
    expect(recipe.ingredients.map(({ id: _id, ...rest }) => rest)).toEqual([
      { group: '', amount: null, amountMax: null, unit: '', name: 'Mehl', note: '' },
    ]);
  });

  it('rejects amountMax <= amount and amountMax without amount', async () => {
    for (const bad of [
      { amount: 3, amountMax: 3 },
      { amount: 3, amountMax: 2 },
      { amount: null, amountMax: 2 },
    ]) {
      const res = await call('POST', '/recipes', {
        body: {
          title: 'Eier',
          createKey: newKey(),
          ingredients: [{ name: 'Mehl' }, { name: 'Eier', ...bad }],
        },
      });
      expect(res.status).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe('VALIDATION');
      expect(error.details).toEqual([
        { field: 'ingredients.1.amountMax', message: 'Die Obergrenze muss größer als die Menge sein' },
      ]);
    }
    expect(count('recipes')).toBe(0);
  });

  it('rejects an ingredient without name', async () => {
    const res = await call('POST', '/recipes', {
      body: { title: 'Eier', createKey: newKey(), ingredients: [{ name: ' ', amount: 2 }] },
    });
    expect(res.status).toBe(400);
    const details = (await errorOf(res)).details as { field: string }[];
    expect(details[0]?.field).toBe('ingredients.0.name');
  });

  it('keeps steps in order with line breaks and rejects an empty step', async () => {
    const steps = [
      { text: 'Zwiebeln schneiden.' },
      { text: 'Anbraten.\nAblöschen.' },
      { text: 'Servieren.' },
    ];
    const recipe = await create({ title: 'Zwiebelsuppe', steps });
    expect(recipe.steps.map((s) => s.text)).toEqual([
      'Zwiebeln schneiden.',
      'Anbraten.\nAblöschen.',
      'Servieren.',
    ]);

    const res = await call('POST', '/recipes', {
      body: { title: 'Zwiebelsuppe', createKey: newKey(), steps: [{ text: 'Schneiden.' }, { text: '   ' }] },
    });
    expect(res.status).toBe(400);
    const details = (await errorOf(res)).details as { field: string }[];
    expect(details[0]?.field).toBe('steps.1.text');
  });

  it('allows a recipe without steps', async () => {
    const recipe = await create({ title: 'Obstsalat', steps: [] });
    expect(recipe.steps).toEqual([]);
  });
});

describe('tags (F-17)', () => {
  it('stores tag names unchanged', async () => {
    const recipe = await create({
      title: 'Kaiserschmarrn',
      tags: ['Süßspeise', 'Schnell & einfach', 'Für Gäste', 'Low-Carb'],
    });
    expect(recipe.tags.map((t) => t.name)).toEqual([
      'Für Gäste',
      'Low-Carb',
      'Schnell & einfach',
      'Süßspeise',
    ]);
  });

  it('links spellings with the same key to the existing tag and keeps its display name', async () => {
    const first = await create({ title: 'Kaiserschmarrn', tags: ['Süßspeise'] });
    const tagId = first.tags[0]?.id;
    expect(tagId).toBeTypeOf('number');

    for (const spelling of ['süßspeise', 'Süssspeise', 'Süsspeise', 'SÜSSSPEISE']) {
      const recipe = await create({ title: `Grießbrei ${spelling}`, tags: [spelling] });
      expect(recipe.tags).toEqual([{ id: tagId, name: 'Süßspeise' }]);
    }
    const tags = ctx.deps.db.prepare('SELECT name, name_key FROM tags').all();
    expect(tags).toEqual([{ name: 'Süßspeise', name_key: 'susspeise' }]);
  });

  it('collapses duplicates within one recipe', async () => {
    const recipe = await create({ title: 'Salat', tags: ['Vegan', 'vegan', 'VEGAN', 'Salat'] });
    expect(recipe.tags.map((t) => t.name)).toEqual(['Salat', 'Vegan']);
    expect(count('tags')).toBe(2);
    expect(count('recipe_tags')).toBe(2);
  });

  it('accepts 20 tags and rejects a 21st with 400', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `Tag ${i + 1}`);
    const ok = await create({ title: 'Viele Tags', tags: twenty });
    expect(ok.tags).toHaveLength(20);

    const res = await call('POST', '/recipes', {
      body: { title: 'Zu viele Tags', createKey: newKey(), tags: [...twenty, 'Tag 21'] },
    });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe('VALIDATION');
    expect(error.details).toEqual([{ field: 'tags', message: 'Tags: höchstens 20 erlaubt' }]);
    expect(count('tags')).toBe(20);
  });

  it('rejects a tag name with 41 characters', async () => {
    const res = await call('POST', '/recipes', {
      body: { title: 'Langer Tag', createKey: newKey(), tags: ['x'.repeat(41)] },
    });
    expect(res.status).toBe(400);
    const details = (await errorOf(res)).details as { field: string }[];
    expect(details[0]?.field).toBe('tags.0');
  });
});

describe('createKey (NF-09)', () => {
  it('returns the same recipe with 200 when the same createKey is posted twice', async () => {
    const body = { title: 'Käsespätzle', createKey: 'double-tap-0001' };
    const first = await call('POST', '/recipes', { body });
    expect(first.status).toBe(201);
    const second = await call('POST', '/recipes', { body });
    expect(second.status).toBe(200);
    const a = await recipeOf(first);
    const b = await recipeOf(second);
    expect(b.id).toBe(a.id);
    expect(b).toEqual(a);
    expect(count('recipes')).toBe(1);
    expect(count('recipes_fts')).toBe(1);
  });

  it('replays successfully although the image is assigned by the first request', async () => {
    const imageId = addImage('0123456789abcdef');
    const body = { title: 'Pizza', createKey: 'retry-after-timeout', imageId };
    const first = await call('POST', '/recipes', { body });
    expect(first.status).toBe(201);
    const retry = await call('POST', '/recipes', { body });
    expect(retry.status).toBe(200);
    expect((await recipeOf(retry)).image?.id).toBe(imageId);
    expect(count('recipes')).toBe(1);
  });
});

describe('image assignment (Kap. 4.6)', () => {
  it('assigns an uploaded image and returns its URLs', async () => {
    const imageId = addImage('3f9a1c0b7d2e4a61');
    const recipe = await create({ title: 'Flammkuchen', imageId });
    expect(recipe.image).toEqual({
      id: imageId,
      urls: {
        s: '/media/3f9a1c0b7d2e4a61-s.webp',
        m: '/media/3f9a1c0b7d2e4a61-m.webp',
        l: '/media/3f9a1c0b7d2e4a61-l.webp',
      },
      width: 2048,
      height: 1365,
    });
    const assigned = ctx.deps.db.prepare('SELECT recipe_id FROM images WHERE id = ?').pluck().get(imageId);
    expect(assigned).toBe(recipe.id);
  });

  it('rejects an unknown imageId with 400 on field imageId and creates nothing', async () => {
    const res = await call('POST', '/recipes', {
      body: { title: 'Flammkuchen', createKey: newKey(), imageId: 4711, tags: ['Neu'] },
    });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe('VALIDATION');
    expect(error.details).toEqual([{ field: 'imageId', message: 'Bild nicht gefunden' }]);
    expect(count('recipes')).toBe(0);
    expect(count('tags')).toBe(0);
    expect(count('recipes_fts')).toBe(0);
  });

  it('rejects an image that belongs to another recipe', async () => {
    const imageId = addImage('aaaaaaaaaaaaaaaa');
    const owner = await create({ title: 'Erstes Rezept', imageId });
    const res = await call('POST', '/recipes', {
      body: { title: 'Zweites Rezept', createKey: newKey(), imageId },
    });
    expect(res.status).toBe(400);
    const details = (await errorOf(res)).details as { field: string }[];
    expect(details[0]?.field).toBe('imageId');
    const assigned = ctx.deps.db.prepare('SELECT recipe_id FROM images WHERE id = ?').pluck().get(imageId);
    expect(assigned).toBe(owner.id);
  });
});

describe('GET /recipes/:id (F-29)', () => {
  it('answers an unknown id with 404 NOT_FOUND', async () => {
    const res = await call('GET', '/recipes/4711', { profileId: null });
    expect(res.status).toBe(404);
    const error = await errorOf(res);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Rezept nicht gefunden');
  });

  it('does not match non-numeric ids, so /recipes/similar stays free', async () => {
    const res = await call('GET', '/recipes/abc', { profileId: null });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('NOT_FOUND');
  });

  it('works without a profile; personal fields are null then', async () => {
    const recipe = await create({ title: 'Linsensuppe' });
    ctx.deps.db
      .prepare('INSERT INTO ratings(profile_id, recipe_id, stars) VALUES (?, ?, 4)')
      .run(sebastian, recipe.id);
    ctx.deps.db
      .prepare('INSERT INTO favorites(profile_id, recipe_id) VALUES (?, ?)')
      .run(sebastian, recipe.id);

    const anonymous = await recipeOf(await call('GET', `/recipes/${recipe.id}`, { profileId: null }));
    expect(anonymous.rating).toEqual({
      avg: 4,
      count: 1,
      mine: null,
      byProfile: [{ profileId: sebastian, name: 'Sebastian', stars: 4 }],
    });
    expect(anonymous.isFavorite).toBeNull();

    const mine = await recipeOf(await call('GET', `/recipes/${recipe.id}`));
    expect(mine.rating.mine).toBe(4);
    expect(mine.isFavorite).toBe(true);
  });

  it('rounds the average to one decimal and orders the single ratings by profile name', async () => {
    const recipe = await create({ title: 'Apfelkuchen' });
    const bernd = addProfile('Bernd');
    const aenne = addProfile('Änne');
    const rate = ctx.deps.db.prepare('INSERT INTO ratings(profile_id, recipe_id, stars) VALUES (?, ?, ?)');
    rate.run(sebastian, recipe.id, 5);
    rate.run(bernd, recipe.id, 4);
    rate.run(aenne, recipe.id, 4);

    const detail = await recipeOf(await call('GET', `/recipes/${recipe.id}`, { profileId: bernd }));
    expect(detail.rating).toEqual({
      avg: 4.3,
      count: 3,
      mine: 4,
      byProfile: [
        { profileId: aenne, name: 'Änne', stars: 4 },
        { profileId: bernd, name: 'Bernd', stars: 4 },
        { profileId: sebastian, name: 'Sebastian', stars: 5 },
      ],
    });
    expect(detail.isFavorite).toBe(false);
  });

  it('computes totalMinutes from prep and cook time', async () => {
    const both = await create({ title: 'A', prepMinutes: 15, cookMinutes: 30 });
    const onlyCook = await create({ title: 'B', cookMinutes: 30 });
    const onlyPrep = await create({ title: 'C', prepMinutes: 10 });
    const none = await create({ title: 'D' });
    expect([both.totalMinutes, onlyCook.totalMinutes, onlyPrep.totalMinutes, none.totalMinutes]).toEqual([
      45,
      30,
      10,
      null,
    ]);
  });

  it('shows createdBy/updatedBy as null after the profile was deleted ("unbekannt")', async () => {
    const anna = addProfile('Anna');
    const recipe = await create({ title: 'Bratkartoffeln' }, anna);
    ctx.deps.db.prepare('DELETE FROM profiles WHERE id = ?').run(anna);
    const detail = await recipeOf(await call('GET', `/recipes/${recipe.id}`));
    expect(detail.createdBy).toBeNull();
    expect(detail.updatedBy).toBeNull();
  });

  it('answers a trashed recipe with 410 IN_TRASH and who deleted it', async () => {
    const recipe = await create({ title: 'Linsensuppe' });
    clock = new Date('2026-09-24T08:00:00.000Z');
    expect((await call('DELETE', `/recipes/${recipe.id}`)).status).toBe(204);

    const res = await call('GET', `/recipes/${recipe.id}`, { profileId: null });
    expect(res.status).toBe(410);
    const error = await errorOf(res);
    expect(error.code).toBe('IN_TRASH');
    expect(error.message).toBe('Rezept liegt im Papierkorb');
    const details: InTrashDetails = {
      deletedAt: '2026-09-24T08:00:00.000Z',
      deletedBy: { id: sebastian, name: 'Sebastian' },
    };
    expect(error.details).toEqual(details);
  });
});

describe('DELETE /recipes/:id and restore (F-08)', () => {
  it('moves the recipe to the trash and stores deleted_by; the FTS row stays', async () => {
    const recipe = await create(KAESESPAETZLE);
    const anna = addProfile('Anna');
    const res = await call('DELETE', `/recipes/${recipe.id}`, { profileId: anna });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    const row = ctx.deps.db
      .prepare('SELECT deleted_at, deleted_by FROM recipes WHERE id = ?')
      .get(recipe.id) as { deleted_at: string; deleted_by: number };
    expect(row).toEqual({ deleted_at: NOW, deleted_by: anna });
    expect(count('recipes_fts')).toBe(1);

    const get = await call('GET', `/recipes/${recipe.id}`);
    expect(get.status).toBe(410);
    expect(((await errorOf(get)).details as InTrashDetails).deletedBy).toEqual({ id: anna, name: 'Anna' });
  });

  it('answers a second delete with 410 IN_TRASH, unknown ids with 404, no profile with 401', async () => {
    const recipe = await create({ title: 'Linsensuppe' });
    expect((await call('DELETE', `/recipes/${recipe.id}`, { profileId: null })).status).toBe(401);
    expect((await call('DELETE', `/recipes/${recipe.id}`)).status).toBe(204);

    const again = await call('DELETE', `/recipes/${recipe.id}`);
    expect(again.status).toBe(410);
    expect((await errorOf(again)).code).toBe('IN_TRASH');

    const unknown = await call('DELETE', '/recipes/4711');
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe('NOT_FOUND');
  });

  it('restores ingredients, steps, tags, image, ratings and favorites', async () => {
    const imageId = addImage('bbbbbbbbbbbbbbbb');
    const created = await create({ ...KAESESPAETZLE, imageId });
    const anna = addProfile('Anna');
    const db = ctx.deps.db;
    db.prepare('INSERT INTO ratings(profile_id, recipe_id, stars) VALUES (?, ?, ?)').run(anna, created.id, 5);
    db.prepare('INSERT INTO ratings(profile_id, recipe_id, stars) VALUES (?, ?, ?)').run(
      sebastian,
      created.id,
      4,
    );
    db.prepare('INSERT INTO favorites(profile_id, recipe_id) VALUES (?, ?)').run(sebastian, created.id);
    const before = await recipeOf(await call('GET', `/recipes/${created.id}`));

    expect((await call('DELETE', `/recipes/${created.id}`, { profileId: anna })).status).toBe(204);
    const res = await call('POST', `/recipes/${created.id}/restore`);
    expect(res.status).toBe(200);
    const restored = await recipeOf(res);
    expect(restored).toEqual(before);
    expect(restored.rating.count).toBe(2);
    expect(restored.isFavorite).toBe(true);
    expect(restored.image?.id).toBe(imageId);

    const row = db.prepare('SELECT deleted_at, deleted_by FROM recipes WHERE id = ?').get(created.id);
    expect(row).toEqual({ deleted_at: null, deleted_by: null });
    expect((await call('GET', `/recipes/${created.id}`)).status).toBe(200);
  });

  it('restore is idempotent for active recipes and answers 404/401', async () => {
    const recipe = await create({ title: 'Linsensuppe' });
    const res = await call('POST', `/recipes/${recipe.id}/restore`);
    expect(res.status).toBe(200);
    expect(await recipeOf(res)).toEqual(recipe);

    expect((await call('POST', '/recipes/4711/restore')).status).toBe(404);
    const noProfile = await call('POST', `/recipes/${recipe.id}/restore`, { profileId: null });
    expect(noProfile.status).toBe(401);
    expect((await errorOf(noProfile)).code).toBe('PROFILE_REQUIRED');
  });
});

describe('recipe ids are never reused after a purge (F-08)', () => {
  it('gives the next recipe a fresh id after the newest one was purged', async () => {
    const first = await create({ title: 'Linsensuppe', ingredients: [{ name: 'Linsen' }] });
    expect((await call('DELETE', `/recipes/${first.id}`)).status).toBe(204);
    expect((await call('DELETE', `/trash/${first.id}`)).status).toBe(204);

    const second = await create({ title: 'Kürbissuppe' });
    expect(second.id).not.toBe(first.id);
    expect(second.id).toBeGreaterThan(first.id);

    // An old draft or deep link to the purged recipe finds nothing instead of another recipe.
    const old = await call('GET', `/recipes/${first.id}`);
    expect(old.status).toBe(404);
    expect((await errorOf(old)).code).toBe('NOT_FOUND');
    // The FTS rowid is the recipe id: the new recipe got its own row, the purged one is gone.
    expect(ftsMatch('"linsen"*')).toEqual([]);
    expect(ftsMatch('"kurbissuppe"*')).toEqual([second.id]);
    expect(count('recipes_fts')).toBe(count('recipes'));

    // And again in a second round.
    expect((await call('DELETE', `/recipes/${second.id}`)).status).toBe(204);
    expect((await call('DELETE', `/trash/${second.id}`)).status).toBe(204);
    expect([first.id, second.id]).not.toContain((await create({ title: 'Brot' })).id);
  });

  it('keeps the id of an automatically purged row reserved, even one inserted without the counter', async () => {
    const db = ctx.deps.db;
    const old = Number(
      db
        .prepare('INSERT INTO recipes(title, title_key, deleted_at) VALUES (?, ?, ?)')
        .run('Alt', 'alt', '2026-08-01T10:00:00.000Z').lastInsertRowid,
    );
    expect(purgeExpired(ctx.deps)).toBe(1);

    const fresh = await create({ title: 'Neu' });
    expect(fresh.id).not.toBe(old);
    expect((await call('GET', `/recipes/${old}`)).status).toBe(404);
  });

  it('continues after the highest id of rows inserted directly (older databases)', async () => {
    ctx.deps.db.prepare("INSERT INTO recipes(id, title, title_key) VALUES (41, 'Alt', 'alt')").run();
    expect((await create({ title: 'Neu' })).id).toBe(42);
  });

  it('the seed script (pnpm seed --force) takes its ids from the same counters', async () => {
    const purged = await create({ title: 'Linsensuppe' });
    expect((await call('DELETE', `/recipes/${purged.id}`)).status).toBe(204);
    expect((await call('DELETE', `/trash/${purged.id}`)).status).toBe(204);

    seed(ctx.deps.db, { count: 2, now: new Date(NOW) });
    const ids = ctx.deps.db.prepare('SELECT id FROM recipes ORDER BY id').pluck().all() as number[];
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => id > purged.id)).toBe(true);
    // The existing profile is reused, the two new ones get fresh ids.
    const profiles = ctx.deps.db.prepare('SELECT id FROM profiles ORDER BY id').pluck().all() as number[];
    expect(profiles).toHaveLength(3);
    expect(profiles[0]).toBe(sebastian);
    expect((await create({ title: 'Neu' })).id).toBe(Math.max(...ids) + 1);
  });
});

describe('full-text index (Kap. 4.3)', () => {
  it('indexes a new recipe in the same request', async () => {
    const recipe = await create({
      title: 'Käsespätzle',
      ingredients: [{ name: 'Zwiebeln' }],
      tags: ['Schwäbisch'],
      steps: [{ text: 'Im Ofen gratinieren.' }],
    });
    expect(ftsMatch('"kase"*')).toEqual([recipe.id]);
    expect(ftsMatch('"kasespatzle"')).toEqual([recipe.id]);
    expect(ftsMatch('"zwieb"*')).toEqual([recipe.id]);
    expect(ftsMatch('"schwab"*')).toEqual([recipe.id]);
    expect(ftsMatch('"gratinieren"')).toEqual([recipe.id]);
  });

  it('replaces the index row on update: the old title no longer matches', async () => {
    const recipe = await create({ title: 'Käsespätzle' });
    const res = await call('PUT', `/recipes/${recipe.id}`, { body: { title: 'Linsensuppe', version: 1 } });
    expect(res.status).toBe(200);
    expect(ftsMatch('"kase"*')).toEqual([]);
    expect(ftsMatch('"linsen"*')).toEqual([recipe.id]);
    expect(count('recipes_fts')).toBe(1);
  });
});

describe('image files after removal (F-16)', () => {
  it('moves the variant files of a removed image to images/.trash and ignores missing files', async () => {
    const fileKey = 'cccccccccccccccc';
    const imageId = addImage(fileKey);
    const recipe = await create({ title: 'Pizza', imageId });
    const { images, imagesTrash } = ctx.deps.paths;
    // Only two of three variants exist: the missing one must not fail the request.
    fs.writeFileSync(path.join(images, `${fileKey}-s.webp`), 's');
    fs.writeFileSync(path.join(images, `${fileKey}-m.webp`), 'm');

    const res = await call('PUT', `/recipes/${recipe.id}`, {
      body: { title: 'Pizza', version: 1, imageId: null },
    });
    expect(res.status).toBe(200);
    expect((await recipeOf(res)).image).toBeNull();
    expect(count('images')).toBe(0);
    expect(fs.existsSync(path.join(images, `${fileKey}-s.webp`))).toBe(false);
    expect(fs.readFileSync(path.join(imagesTrash, `${fileKey}-s.webp`), 'utf8')).toBe('s');
    expect(fs.readFileSync(path.join(imagesTrash, `${fileKey}-m.webp`), 'utf8')).toBe('m');
    expect(fs.existsSync(path.join(imagesTrash, `${fileKey}-l.webp`))).toBe(false);
  });
});
