import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ftsRowFor } from '../../server/db/fts.ts';
import { bumpDataRevision, getDataRevision } from '../../server/db/repos/meta.ts';
import { ftsRowsFor } from '../../server/db/repos/tags.ts';
import type { ErrorBody } from '../../shared/error-codes.ts';
import { normalize } from '../../shared/normalize.ts';
import type {
  RecipeDetail,
  RecipeResponse,
  TagCount,
  TagExistsDetails,
  TagMergeResponse,
  TagResponse,
  TagsResponse,
} from '../../shared/types.ts';
import { INVALID_TAG_NAMES, VALID_TAG_NAMES } from '../fixtures/tag-names.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';
import { insertProfile, insertRecipe, tagId } from '../helpers/recipes.ts';
import { seed } from '../seed.ts';

/** Tag API (Kap. 7.6): F-17, F-19, NF-19 and the manipulation test „veralteter PUT nach Tag-Merge“ (Kap. 9.1). */

const API = 'http://localhost:8080/api/v1';
const T0 = '2026-09-23T10:05:00.000Z';
const T1 = '2026-09-24T18:30:00.000Z';
const TRASHED_AT = '2026-09-20T08:00:00.000Z';

let ctx: TestContext;
let clock: Date;
let sebastian: number;

beforeEach(() => {
  clock = new Date(T0);
  ctx = createTestContext({ now: () => clock });
  sebastian = insertProfile(ctx.deps.db, 'Sebastian');
});

afterEach(() => {
  try {
    // Every write, a failed one too, leaves exactly one FTS row per recipe (Kap. 4.3).
    expect(count('recipes_fts')).toBe(count('recipes'));
  } finally {
    ctx.cleanup();
  }
});

interface CallOptions {
  /** Defaults to Sebastian; null sends no X-Profile-Id. */
  profileId?: number | null;
  body?: unknown;
  rawBody?: string;
  /** false leaves out X-Rezepte-Client. */
  client?: boolean;
}

async function call(method: string, urlPath: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...CLIENT_HEADERS };
  if (options.client === false) delete headers['X-Rezepte-Client'];
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

async function listTags(): Promise<TagCount[]> {
  const res = await call('GET', '/tags');
  expect(res.status).toBe(200);
  return ((await res.json()) as TagsResponse).tags;
}

async function detail(id: number): Promise<RecipeDetail> {
  const res = await call('GET', `/recipes/${id}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as RecipeResponse).recipe;
}

function db() {
  return ctx.deps.db;
}

function count(table: string): number {
  return db().prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
}

function revision(): number {
  return getDataRevision(db());
}

/** A tag without recipes, written directly (GET tests must not depend on POST). */
function addTag(name: string): number {
  return Number(
    db().prepare('INSERT INTO tags(name, name_key) VALUES (?, ?)').run(name, normalize(name)).lastInsertRowid,
  );
}

function versions(): Record<number, number> {
  const rows = db().prepare('SELECT id, version FROM recipes ORDER BY id').all() as {
    id: number;
    version: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.version]));
}

/** Recipe ids whose FTS tags column matches the term (trashed ones included, like the index). */
function ftsTags(term: string): number[] {
  return db()
    .prepare('SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH ? ORDER BY rowid')
    .pluck()
    .all(`tags : ${term}`) as number[];
}

function linksOf(recipeId: number): string[] {
  return db()
    .prepare(
      'SELECT t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = ? ORDER BY t.name_key',
    )
    .pluck()
    .all(recipeId) as string[];
}

interface Snapshot {
  tags: unknown[];
  links: unknown[];
  recipes: unknown[];
  nachtisch: number[];
  dessert: number[];
  fts: number;
  revision: number;
}

/** Everything a tag write may touch; compared before and after a refused or failed write. */
function snapshot(): Snapshot {
  return {
    tags: db().prepare('SELECT id, name, name_key FROM tags ORDER BY id').all(),
    links: db().prepare('SELECT recipe_id, tag_id FROM recipe_tags ORDER BY recipe_id, tag_id').all(),
    recipes: db().prepare('SELECT id, version, updated_at, updated_by FROM recipes ORDER BY id').all(),
    nachtisch: ftsTags('nachtisch'),
    dessert: ftsTags('dessert'),
    fts: count('recipes_fts'),
    revision: revision(),
  };
}

interface DessertFixture {
  /** 7 active recipes with Nachtisch; the first 2 also have Dessert. */
  nachtisch: number[];
  /** 3 active recipes with only Dessert. */
  dessertOnly: number[];
  /** A recipe without either tag. */
  other: number;
  nachtischId: number;
  dessertId: number;
}

/** The F-19 AK1 case: „‚Nachtisch‘ in ‚Dessert‘ zusammenführen? 7 Rezepte betroffen“. */
function dessertFixture(): DessertFixture {
  const nachtisch = [1, 2, 3, 4, 5, 6, 7].map((i) =>
    insertRecipe(db(), { title: `Rezept N${i}`, tags: i <= 2 ? ['Nachtisch', 'Dessert'] : ['Nachtisch'] }),
  );
  const dessertOnly = [1, 2, 3].map((i) => insertRecipe(db(), { title: `Rezept D${i}`, tags: ['Dessert'] }));
  const other = insertRecipe(db(), { title: 'Linsensuppe', tags: ['Suppe'] });
  return {
    nachtisch,
    dessertOnly,
    other,
    nachtischId: tagId(db(), 'Nachtisch'),
    dessertId: tagId(db(), 'Dessert'),
  };
}

function trashedNachtisch(): number {
  return insertRecipe(db(), { title: 'Rezept im Papierkorb', tags: ['Nachtisch'], deletedAt: TRASHED_AT });
}

describe('GET /tags', () => {
  it('returns { tags: [{ id, name, count }], revision } with the revision of X-Data-Revision', async () => {
    insertRecipe(db(), { title: 'Linsensuppe', tags: ['Suppe'] });
    bumpDataRevision(db());
    bumpDataRevision(db());

    const res = await call('GET', '/tags', { profileId: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TagsResponse;
    expect(body).toEqual({ tags: [{ id: tagId(db(), 'Suppe'), name: 'Suppe', count: 1 }], revision: 2 });
    expect(body.revision).toBe(Number(res.headers.get('X-Data-Revision')));
    expect(Object.keys(body.tags[0] ?? {}).sort()).toEqual(['count', 'id', 'name']);
  });

  it('orders by count descending, then by name_key (DIN 5007-1); unused tags come last', async () => {
    addTag('Zimt');
    addTag('Aal');
    for (let i = 0; i < 3; i++) insertRecipe(db(), { title: `Suppe ${i}`, tags: ['Suppe'] });
    for (let i = 0; i < 2; i++) insertRecipe(db(), { title: `Beilage ${i}`, tags: ['Beilage', 'Äpfel'] });
    insertRecipe(db(), { title: 'Zucchini-Pfanne', tags: ['Zucchini'] });

    expect((await listTags()).map((t) => `${t.name} ${t.count}`)).toEqual([
      'Suppe 3',
      'Äpfel 2',
      'Beilage 2',
      'Zucchini 1',
      'Aal 0',
      'Zimt 0',
    ]);
  });

  it('does not count recipes in the trash', async () => {
    insertRecipe(db(), { title: 'Aktiv', tags: ['Zucchini'] });
    insertRecipe(db(), { title: 'Weg', tags: ['Zucchini', 'Zimt'], deletedAt: TRASHED_AT });

    expect(await listTags()).toEqual([
      { id: tagId(db(), 'Zucchini'), name: 'Zucchini', count: 1 },
      { id: tagId(db(), 'Zimt'), name: 'Zimt', count: 0 },
    ]);
  });

  it('rejects an unknown X-Profile-Id with 401 PROFILE_UNKNOWN', async () => {
    addTag('Suppe');
    const res = await call('GET', '/tags', { profileId: 999 });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('PROFILE_UNKNOWN');
  });
});

describe('POST /tags (F-17)', () => {
  it('stores every valid name unchanged with 201 and count 0 (F-17 AK1)', async () => {
    for (const name of VALID_TAG_NAMES) {
      const res = await call('POST', '/tags', { body: { name } });
      expect(res.status, name).toBe(201);
      const { tag } = (await res.json()) as TagResponse;
      expect(tag).toEqual({ id: tagId(db(), name), name, count: 0 });
    }
    expect((await listTags()).map((t) => t.name).sort()).toEqual([...VALID_TAG_NAMES].sort());
  });

  it('returns the existing tag with 200 for every spelling of its key (F-17 AK2)', async () => {
    const first = await call('POST', '/tags', { body: { name: 'Süßspeise' } });
    expect(first.status).toBe(201);
    const { tag } = (await first.json()) as TagResponse;

    for (const name of ['süßspeise', 'Süssspeise', 'Süsspeise', 'SÜSSSPEISE']) {
      const res = await call('POST', '/tags', { body: { name } });
      expect(res.status, name).toBe(200);
      expect(((await res.json()) as TagResponse).tag, name).toEqual({
        id: tag.id,
        name: 'Süßspeise',
        count: 0,
      });
    }
    expect(count('tags')).toBe(1);
    expect(db().prepare('SELECT name_key FROM tags').pluck().get()).toBe('susspeise');
  });

  it('answers an existing key with its count of active recipes and trims the name', async () => {
    insertRecipe(db(), { title: 'Grießbrei', tags: ['Süßspeise'] });
    insertRecipe(db(), { title: 'Milchreis', tags: ['Süßspeise'] });
    insertRecipe(db(), { title: 'Weg', tags: ['Süßspeise'], deletedAt: TRASHED_AT });

    const existing = await call('POST', '/tags', { body: { name: '  SÜSSSPEISE ' } });
    expect(existing.status).toBe(200);
    expect(((await existing.json()) as TagResponse).tag).toEqual({
      id: tagId(db(), 'Süßspeise'),
      name: 'Süßspeise',
      count: 2,
    });

    const trimmed = await call('POST', '/tags', { body: { name: '  Pasta  ' } });
    expect(trimmed.status).toBe(201);
    expect(((await trimmed.json()) as TagResponse).tag.name).toBe('Pasta');
  });

  it('rejects every invalid name with 400 VALIDATION on field "name" and creates nothing', async () => {
    for (const name of INVALID_TAG_NAMES) {
      const res = await call('POST', '/tags', { body: { name } });
      expect(res.status, JSON.stringify(name)).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe('VALIDATION');
      expect((error.details as { field: string }[])[0]?.field).toBe('name');
    }
    // The last one passes the schema; only its empty key refuses it.
    const mark = await call('POST', '/tags', { body: { name: INVALID_TAG_NAMES.at(-1) } });
    expect(await errorOf(mark)).toMatchObject({
      details: [{ field: 'name', message: 'Der Name braucht mindestens einen Buchstaben oder eine Ziffer' }],
    });
    expect(count('tags')).toBe(0);
  });

  it('rejects a missing name and broken JSON with 400 VALIDATION', async () => {
    const missing = await call('POST', '/tags', { body: {} });
    expect(missing.status).toBe(400);
    expect((await errorOf(missing)).details).toEqual([
      { field: 'name', message: 'Name hat ein ungültiges Format' },
    ]);

    const broken = await call('POST', '/tags', { rawBody: '{"name":' });
    expect(broken.status).toBe(400);
    expect((await errorOf(broken)).code).toBe('VALIDATION');
    expect(count('tags')).toBe(0);
  });

  it('needs X-Rezepte-Client and a known profile (F-05, NF-21)', async () => {
    const noClient = await call('POST', '/tags', { body: { name: 'Pasta' }, client: false });
    expect(noClient.status).toBe(400);
    expect((await errorOf(noClient)).code).toBe('BAD_REQUEST');

    const noProfile = await call('POST', '/tags', { body: { name: 'Pasta' }, profileId: null });
    expect(noProfile.status).toBe(401);
    expect((await errorOf(noProfile)).code).toBe('PROFILE_REQUIRED');
    // The profile comes before the body (F-05).
    const invalidNoProfile = await call('POST', '/tags', { body: { name: '' }, profileId: null });
    expect(invalidNoProfile.status).toBe(401);

    const unknown = await call('POST', '/tags', { body: { name: 'Pasta' }, profileId: 999 });
    expect(unknown.status).toBe(401);
    expect((await errorOf(unknown)).code).toBe('PROFILE_UNKNOWN');
    expect(count('tags')).toBe(0);
  });
});

describe('PATCH /tags/:id (F-19)', () => {
  it('renames the tag, raises the version of every linked recipe (trash too) and reindexes them', async () => {
    const f = dessertFixture();
    const trashed = trashedNachtisch();
    const linked = [...f.nachtisch, trashed];
    const before = versions();
    const updatedAt = db().prepare('SELECT id, updated_at FROM recipes ORDER BY id').all();

    const res = await call('PATCH', `/tags/${f.nachtischId}`, { body: { name: 'Süßes' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TagResponse).tag).toEqual({ id: f.nachtischId, name: 'Süßes', count: 7 });

    const after = versions();
    for (const id of Object.keys(before).map(Number)) {
      expect(after[id], `recipe ${id}`).toBe((before[id] ?? 0) + (linked.includes(id) ? 1 : 0));
    }
    expect(db().prepare('SELECT id, updated_at FROM recipes ORDER BY id').all()).toEqual(updatedAt);

    for (const id of linked) {
      const tags = ftsRowFor(db(), id)?.tags ?? '';
      expect(tags.split(' '), `recipe ${id}`).toContain('susses');
      expect(tags.split(' '), `recipe ${id}`).not.toContain('nachtisch');
    }
    // F-19 AK2: the search finds the recipes under the new name, and no longer under the old one.
    expect(ftsTags('susses')).toEqual([...linked].sort((a, b) => a - b));
    expect(ftsTags('nachtisch')).toEqual([]);
    expect(linksOf(f.nachtisch[0] ?? 0)).toEqual(['Dessert', 'Süßes']);
  });

  it('keeps „geändert von … am …“: updated_at and updated_by stay (F-19 AK5)', async () => {
    const anna = insertProfile(db(), 'Anna');
    const created = await call('POST', '/recipes', {
      profileId: anna,
      body: { createKey: 'tag-test-rename-01', title: 'Apfelstrudel', tags: ['Nachtisch'] },
    });
    expect(created.status).toBe(201);
    const recipe = ((await created.json()) as RecipeResponse).recipe;

    clock = new Date(T1);
    const res = await call('PATCH', `/tags/${tagId(db(), 'Nachtisch')}`, { body: { name: 'Süßes' } });
    expect(res.status).toBe(200);

    const now = await detail(recipe.id);
    expect(now.version).toBe(recipe.version + 1);
    expect(now.updatedBy).toEqual({ id: anna, name: 'Anna' });
    expect(now.updatedAt).toBe(T0);
    expect(now.tags.map((t) => t.name)).toEqual(['Süßes']);
  });

  it('changes only the display name for a spelling of its own key, without 409', async () => {
    const f = dessertFixture();
    const before = versions();

    const res = await call('PATCH', `/tags/${f.dessertId}`, { body: { name: 'dessert' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TagResponse).tag).toEqual({ id: f.dessertId, name: 'dessert', count: 5 });
    expect(db().prepare('SELECT name_key FROM tags WHERE id = ?').pluck().get(f.dessertId)).toBe('dessert');
    expect(count('tags')).toBe(3);
    // A new display name is still a tag change of these recipes.
    for (const id of [...f.nachtisch.slice(0, 2), ...f.dessertOnly]) {
      expect(versions()[id]).toBe((before[id] ?? 0) + 1);
    }
  });

  it('writes nothing when the name is unchanged', async () => {
    const f = dessertFixture();
    const before = snapshot();

    const res = await call('PATCH', `/tags/${f.dessertId}`, { body: { name: ' Dessert ' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TagResponse).tag).toEqual({ id: f.dessertId, name: 'Dessert', count: 5 });
    // Only the revision middleware counts the (successful) write request.
    expect(snapshot()).toEqual({ ...before, revision: before.revision + 1 });
  });

  it('answers the key of another tag with 409 TAG_EXISTS and what the merge dialog needs (F-19 AK1)', async () => {
    const f = dessertFixture();
    trashedNachtisch();
    const before = snapshot();

    for (const name of ['Dessert', 'DESSERT']) {
      const res = await call('PATCH', `/tags/${f.nachtischId}`, { body: { name } });
      expect(res.status, name).toBe(409);
      const error = await errorOf(res);
      expect(error.code).toBe('TAG_EXISTS');
      expect(error.message).toBe('Tag existiert bereits');
      // 7 active recipes; the one in the trash is not counted.
      const details: TagExistsDetails = { targetId: f.dessertId, targetName: 'Dessert', affectedRecipes: 7 };
      expect(error.details).toEqual(details);
    }
    expect(snapshot()).toEqual(before);
  });

  it('answers 404 for unknown and malformed ids, 400 for invalid names, 401/400 without profile/client', async () => {
    const id = addTag('Suppe');
    for (const bad of ['9999', 'abc', '007', '0', '-1', '1.5', '99999999999999999']) {
      const res = await call('PATCH', `/tags/${bad}`, { body: { name: 'Eintopf' } });
      expect(res.status, bad).toBe(404);
      expect(await errorOf(res), bad).toMatchObject({ code: 'NOT_FOUND', message: 'Tag nicht gefunden' });
    }
    for (const name of ['', 'x'.repeat(41), 'Zeile\nUmbruch', '́']) {
      const res = await call('PATCH', `/tags/${id}`, { body: { name } });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect((await errorOf(res)).details).toMatchObject([{ field: 'name' }]);
    }
    const noProfile = await call('PATCH', `/tags/${id}`, { body: { name: 'Eintopf' }, profileId: null });
    expect(noProfile.status).toBe(401);
    expect((await errorOf(noProfile)).code).toBe('PROFILE_REQUIRED');
    // The profile is checked first (F-05): without one, not even the id is looked at.
    const anonymous = await call('PATCH', '/tags/abc', { body: { name: '' }, profileId: null });
    expect(anonymous.status).toBe(401);
    expect((await errorOf(anonymous)).code).toBe('PROFILE_REQUIRED');
    const noClient = await call('PATCH', `/tags/${id}`, { body: { name: 'Eintopf' }, client: false });
    expect(noClient.status).toBe(400);
    expect((await errorOf(noClient)).code).toBe('BAD_REQUEST');
    expect((await listTags()).map((t) => t.name)).toEqual(['Suppe']);
  });
});

describe('POST /tags/:id/merge (F-19)', () => {
  it('moves every recipe to the target once, deletes the source and raises each version once', async () => {
    const f = dessertFixture();
    const before = versions();

    const res = await call('POST', `/tags/${f.nachtischId}/merge`, { body: { intoTagId: f.dessertId } });
    expect(res.status).toBe(200);
    const body: TagMergeResponse = { tag: { id: f.dessertId, name: 'Dessert', count: 10 }, movedRecipes: 7 };
    expect(await res.json()).toEqual(body);

    expect(db().prepare("SELECT count(*) FROM tags WHERE name_key = 'nachtisch'").pluck().get()).toBe(0);
    for (const id of f.nachtisch) {
      // F-19 AK1: no recipe keeps „Nachtisch“, none has „Dessert“ twice.
      expect((await detail(id)).tags, `recipe ${id}`).toEqual([{ id: f.dessertId, name: 'Dessert' }]);
      expect(versions()[id], `recipe ${id}`).toBe((before[id] ?? 0) + 1);
    }
    for (const id of [...f.dessertOnly, f.other]) expect(versions()[id]).toBe(before[id]);

    // F-19 AK2 and Kap. 9.1 „FTS nach Tag-Merge“.
    expect(ftsTags('nachtisch')).toEqual([]);
    expect(ftsTags('dessert')).toEqual([...f.nachtisch, ...f.dessertOnly].sort((a, b) => a - b));
    expect((await listTags()).map((t) => `${t.name} ${t.count}`)).toEqual(['Dessert 10', 'Suppe 1']);
  });

  it('counts only active recipes as moved and gives a trashed recipe the target tag for its restore', async () => {
    const f = dessertFixture();
    const trashed = trashedNachtisch();
    const version = versions()[trashed] ?? 0;

    const res = await call('POST', `/tags/${f.nachtischId}/merge`, { body: { intoTagId: f.dessertId } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TagMergeResponse).movedRecipes).toBe(7);
    expect(versions()[trashed]).toBe(version + 1);
    expect(ftsTags('dessert')).toContain(trashed);

    const restored = await call('POST', `/recipes/${trashed}/restore`);
    expect(restored.status).toBe(200);
    expect((await detail(trashed)).tags).toEqual([{ id: f.dessertId, name: 'Dessert' }]);
  });

  it('refuses a merge into itself with 400 on field intoTagId', async () => {
    const f = dessertFixture();
    const before = snapshot();
    const res = await call('POST', `/tags/${f.dessertId}/merge`, { body: { intoTagId: f.dessertId } });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: 'VALIDATION',
      details: [{ field: 'intoTagId', message: 'Ein Tag lässt sich nicht mit sich selbst zusammenführen' }],
    });
    expect(snapshot()).toEqual(before);
  });

  it('answers 404 for an unknown source or target and 400 for an invalid intoTagId', async () => {
    const f = dessertFixture();
    const before = snapshot();

    const source = await call('POST', '/tags/9999/merge', { body: { intoTagId: f.dessertId } });
    expect(source.status).toBe(404);
    expect(await errorOf(source)).toMatchObject({ code: 'NOT_FOUND', message: 'Tag nicht gefunden' });
    const target = await call('POST', `/tags/${f.nachtischId}/merge`, { body: { intoTagId: 9999 } });
    expect(target.status).toBe(404);
    expect(await errorOf(target)).toMatchObject({ code: 'NOT_FOUND', message: 'Ziel-Tag nicht gefunden' });
    const malformed = await call('POST', '/tags/abc/merge', { body: { intoTagId: f.dessertId } });
    expect(malformed.status).toBe(404);

    const messages: [unknown, string][] = [
      [0, 'Ziel-Tag muss mindestens 1 sein'],
      [1.5, 'Ziel-Tag muss eine ganze Zahl sein'],
      [String(f.dessertId), 'Ziel-Tag hat ein ungültiges Format'],
      [undefined, 'Ziel-Tag hat ein ungültiges Format'],
    ];
    for (const [intoTagId, message] of messages) {
      const res = await call('POST', `/tags/${f.nachtischId}/merge`, { body: { intoTagId } });
      expect(res.status, String(intoTagId)).toBe(400);
      expect((await errorOf(res)).details).toEqual([{ field: 'intoTagId', message }]);
    }
    expect(snapshot()).toEqual(before);
  });

  it('needs a profile and X-Rezepte-Client', async () => {
    const f = dessertFixture();
    const noProfile = await call('POST', `/tags/${f.nachtischId}/merge`, {
      body: { intoTagId: f.dessertId },
      profileId: null,
    });
    expect(noProfile.status).toBe(401);
    expect((await errorOf(noProfile)).code).toBe('PROFILE_REQUIRED');
    // The profile comes first (F-05), before the path id and the body.
    const anonymous = await call('POST', '/tags/abc/merge', { body: {}, profileId: null });
    expect(anonymous.status).toBe(401);
    expect((await errorOf(anonymous)).code).toBe('PROFILE_REQUIRED');
    const noClient = await call('POST', `/tags/${f.nachtischId}/merge`, {
      body: { intoTagId: f.dessertId },
      client: false,
    });
    expect(noClient.status).toBe(400);
    expect((await errorOf(noClient)).code).toBe('BAD_REQUEST');
    expect(count('tags')).toBe(3);
  });
});

describe('DELETE /tags/:id (F-19 AK3)', () => {
  it('removes only the links; the recipes stay, their versions rise and the index follows', async () => {
    const f = dessertFixture();
    const trashed = trashedNachtisch();
    const linked = [...f.nachtisch, trashed];
    const before = versions();

    const res = await call('DELETE', `/tags/${f.nachtischId}`);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    expect(count('recipes')).toBe(12);
    expect(db().prepare('SELECT count(*) FROM recipe_tags WHERE tag_id = ?').pluck().get(f.nachtischId)).toBe(
      0,
    );
    const after = versions();
    for (const id of Object.keys(before).map(Number)) {
      expect(after[id], `recipe ${id}`).toBe((before[id] ?? 0) + (linked.includes(id) ? 1 : 0));
    }
    expect(linksOf(f.nachtisch[0] ?? 0)).toEqual(['Dessert']);
    expect(linksOf(f.nachtisch[6] ?? 0)).toEqual([]);
    expect(ftsTags('nachtisch')).toEqual([]);
    expect(ftsTags('dessert')).toEqual([...f.nachtisch.slice(0, 2), ...f.dessertOnly]);
    expect((await listTags()).map((t) => t.name)).toEqual(['Dessert', 'Suppe']);
  });

  it('answers 404 for unknown ids, 401 without profile and 400 without X-Rezepte-Client', async () => {
    const id = addTag('Suppe');
    for (const bad of ['9999', 'abc']) {
      const res = await call('DELETE', `/tags/${bad}`);
      expect(res.status, bad).toBe(404);
      expect((await errorOf(res)).code).toBe('NOT_FOUND');
    }
    const noProfile = await call('DELETE', `/tags/${id}`, { profileId: null });
    expect(noProfile.status).toBe(401);
    expect((await errorOf(noProfile)).code).toBe('PROFILE_REQUIRED');
    const anonymous = await call('DELETE', '/tags/abc', { profileId: null });
    expect(anonymous.status).toBe(401);
    expect((await errorOf(anonymous)).code).toBe('PROFILE_REQUIRED');
    const noClient = await call('DELETE', `/tags/${id}`, { client: false });
    expect(noClient.status).toBe(400);
    expect((await errorOf(noClient)).code).toBe('BAD_REQUEST');
    expect(count('tags')).toBe(1);
  });
});

describe('stale PUT after a tag change (F-19 AK4, Kap. 9.1)', () => {
  const OPERATIONS: [string, (f: DessertFixture) => Promise<Response>][] = [
    ['rename', (f) => call('PATCH', `/tags/${f.nachtischId}`, { body: { name: 'Süßes' } })],
    ['merge', (f) => call('POST', `/tags/${f.nachtischId}/merge`, { body: { intoTagId: f.dessertId } })],
    ['delete', (f) => call('DELETE', `/tags/${f.nachtischId}`)],
  ];

  for (const [name, operation] of OPERATIONS) {
    it(`answers 409 VERSION_CONFLICT after ${name} and never revives „Nachtisch“`, async () => {
      const f = dessertFixture();
      const recipeId = f.nachtisch[3] ?? 0;
      const stale = await detail(recipeId);
      expect(stale.tags.map((t) => t.name)).toEqual(['Nachtisch']);

      expect((await operation(f)).ok).toBe(true);
      const tagsAfterOperation = linksOf(recipeId);

      const res = await call('PUT', `/recipes/${recipeId}`, {
        body: { title: stale.title, tags: ['Nachtisch'], version: stale.version },
      });
      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe('VERSION_CONFLICT');
      expect(db().prepare("SELECT count(*) FROM tags WHERE name_key = 'nachtisch'").pluck().get()).toBe(0);
      expect(linksOf(recipeId)).toEqual(tagsAfterOperation);
    });
  }
});

describe('transactions (NF-19)', () => {
  const OPERATIONS: [string, (f: DessertFixture) => Promise<Response>][] = [
    ['merge', (f) => call('POST', `/tags/${f.nachtischId}/merge`, { body: { intoTagId: f.dessertId } })],
    ['rename', (f) => call('PATCH', `/tags/${f.nachtischId}`, { body: { name: 'Süßes' } })],
    ['delete', (f) => call('DELETE', `/tags/${f.nachtischId}`)],
  ];

  for (const [name, operation] of OPERATIONS) {
    it(`a forced failure at the 3rd version bump rolls the whole ${name} back, FTS included`, async () => {
      const f = dessertFixture();
      trashedNachtisch();
      const third = f.nachtisch[2] ?? 0;
      // Fires only once the uncommitted index no longer carries „nachtisch“ for any recipe, i.e. after
      // the links and the FTS rows were rewritten in this transaction. If the index were written later,
      // or outside the transaction, the trigger would not fire and the write would answer 2xx.
      db().exec(`
        CREATE TRIGGER fail_bump BEFORE UPDATE OF version ON recipes
        WHEN NEW.id = ${third}
          AND (SELECT count(*) FROM recipes_fts WHERE recipes_fts MATCH 'tags : nachtisch') = 0
        BEGIN
          SELECT RAISE(ABORT, 'forced');
        END;
      `);
      const before = snapshot();
      expect(before.nachtisch).toHaveLength(8);

      const res = await operation(f);
      expect(res.status).toBe(500);
      const error = await errorOf(res);
      expect(error.code).toBe('INTERNAL');
      expect(JSON.stringify(error)).not.toContain('forced');
      expect(ctx.log.entries.some((e) => e.msg === 'unhandled error')).toBe(true);

      // Links, versions, tags, the index of the old name and the revision are exactly as before: the
      // rewritten FTS rows rolled back with the rest (NF-19 „einschließlich FTS“).
      expect(snapshot()).toEqual(before);

      db().exec('DROP TRIGGER fail_bump');
      expect((await operation(f)).ok).toBe(true);
      expect(ftsTags('nachtisch')).toEqual([]);
    });
  }
});

describe('data revision (F-36)', () => {
  it('rises by exactly 1 per successful tag write and not on refused ones', async () => {
    const f = dessertFixture();
    const steps: [string, () => Promise<Response>, boolean][] = [
      ['create', () => call('POST', '/tags', { body: { name: 'Backen' } }), true],
      ['create existing', () => call('POST', '/tags', { body: { name: 'BACKEN' } }), true],
      ['invalid create', () => call('POST', '/tags', { body: { name: '' } }), false],
      ['rename', () => call('PATCH', `/tags/${f.dessertId}`, { body: { name: 'Nachspeise' } }), true],
      ['rename conflict', () => call('PATCH', `/tags/${f.nachtischId}`, { body: { name: 'Backen' } }), false],
      [
        'merge',
        () => call('POST', `/tags/${f.nachtischId}/merge`, { body: { intoTagId: f.dessertId } }),
        true,
      ],
      [
        'merge again',
        () => call('POST', `/tags/${f.nachtischId}/merge`, { body: { intoTagId: f.dessertId } }),
        false,
      ],
      ['delete', () => call('DELETE', `/tags/${tagId(db(), 'Backen')}`), true],
      ['delete unknown', () => call('DELETE', '/tags/9999'), false],
      ['list', () => call('GET', '/tags'), false],
    ];
    for (const [name, step, bumps] of steps) {
      const before = revision();
      const res = await step();
      expect(res.ok, name).toBe(bumps || name === 'list');
      expect(revision(), name).toBe(before + (bumps ? 1 : 0));
      expect(Number(res.headers.get('X-Data-Revision')), name).toBe(revision());
      expect(count('recipes_fts'), name).toBe(count('recipes'));
    }
  });
});

describe('batched FTS rows (NF-04 AK3)', () => {
  it('ftsRowsFor builds exactly the rows of ftsRowFor, for every recipe', () => {
    seed(db(), { count: 150, now: new Date(T0) });
    const extra = [
      insertRecipe(db(), { title: 'Nur ein Titel' }),
      insertRecipe(db(), {
        title: 'Flammkuchen',
        description: 'Knusprig  aus dem   Ofen.',
        ingredients: [
          { name: 'Mehl', group: 'Für den Teig' },
          'Salz',
          { name: 'Schmand', group: 'Für den Belag' },
          { name: 'Wasser', group: 'Für den Teig' },
        ],
        steps: ['Teig kneten.', 'Belag verteilen.'],
        tags: ['Süßspeise', 'Äpfel', 'Backen'],
      }),
      insertRecipe(db(), { title: 'Im Papierkorb', tags: ['Nachtisch'], deletedAt: TRASHED_AT }),
    ];
    const ids = db().prepare('SELECT id FROM recipes ORDER BY id').pluck().all() as number[];
    expect(ids.length).toBe(153);

    // Unknown ids and duplicates in the input are harmless.
    const rows = ftsRowsFor(db(), [...ids, 99_999, ...extra]);
    expect([...rows.keys()].sort((a, b) => a - b)).toEqual(ids);
    for (const id of ids) expect(rows.get(id), `recipe ${id}`).toEqual(ftsRowFor(db(), id));
    expect(rows.get(extra[1] ?? 0)?.ingredients).toBe('fur den teig mehl salz fur den belag schmand wasser');
  });
});
