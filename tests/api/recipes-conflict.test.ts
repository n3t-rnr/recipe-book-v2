import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../shared/error-codes.ts';
import { normalize } from '../../shared/normalize.ts';
import type {
  InTrashDetails,
  RecipeDetail,
  RecipeResponse,
  VersionConflictDetails,
} from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';

const API = 'http://localhost:8080/api/v1';

let ctx: TestContext;
let clock: Date;
let sebastian: number;
let anna: number;
let keyCounter = 0;

beforeEach(() => {
  clock = new Date('2026-09-23T10:05:00.000Z');
  ctx = createTestContext({ now: () => clock });
  sebastian = addProfile('Sebastian');
  anna = addProfile('Anna');
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

async function call(
  method: string,
  urlPath: string,
  profileId: number | null,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { ...CLIENT_HEADERS };
  if (profileId !== null) headers['X-Profile-Id'] = String(profileId);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return ctx.app.request(`${API}${urlPath}`, init);
}

async function errorOf(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

async function recipeOf(res: Response): Promise<RecipeDetail> {
  return ((await res.json()) as RecipeResponse).recipe;
}

async function create(body: Record<string, unknown>, profileId = sebastian): Promise<RecipeDetail> {
  keyCounter++;
  const res = await call('POST', '/recipes', profileId, { createKey: `conflict-${keyCounter}-key`, ...body });
  expect(res.status).toBe(201);
  return recipeOf(res);
}

/** The editable part of a detail, i.e. what the editor would send back. */
function inputOf(recipe: RecipeDetail): Record<string, unknown> {
  return {
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    servingsUnit: recipe.servingsUnit,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    source: recipe.source,
    ingredients: recipe.ingredients.map(({ id: _id, ...rest }) => rest),
    steps: recipe.steps.map((s) => ({ text: s.text })),
    tags: recipe.tags.map((t) => t.name),
    imageId: recipe.image?.id ?? null,
    version: recipe.version,
  };
}

function addImage(fileKey: string): number {
  return Number(
    ctx.deps.db
      .prepare(
        'INSERT INTO images(recipe_id, file_key, width, height, bytes_total) VALUES (NULL, ?, 1200, 800, 1)',
      )
      .run(fileKey).lastInsertRowid,
  );
}

const BASE = {
  title: 'Käsespätzle',
  servings: 4,
  prepMinutes: 20,
  ingredients: [
    { amount: 400, unit: 'g', name: 'Mehl' },
    { amount: 4, name: 'Eier' },
  ],
  steps: [{ text: 'Teig schlagen.' }, { text: 'Schaben.' }],
  tags: ['Vegetarisch', 'Schwäbisch'],
};

describe('PUT /recipes/:id (F-07)', () => {
  it('saves a title change, raises the version by exactly 1 and records the editor', async () => {
    const recipe = await create(BASE);
    clock = new Date('2026-09-23T11:00:00.000Z');
    const res = await call('PUT', `/recipes/${recipe.id}`, anna, {
      ...inputOf(recipe),
      title: 'Allgäuer Kässpatzen',
    });
    expect(res.status).toBe(200);
    const updated = await recipeOf(res);
    expect(updated.title).toBe('Allgäuer Kässpatzen');
    expect(updated.version).toBe(2);
    expect(updated.updatedBy).toEqual({ id: anna, name: 'Anna' });
    expect(updated.createdBy).toEqual({ id: sebastian, name: 'Sebastian' });
    expect(updated.updatedAt).toBe('2026-09-23T11:00:00.000Z');
    expect(updated.createdAt).toBe('2026-09-23T10:05:00.000Z');

    const get = await recipeOf(await call('GET', `/recipes/${recipe.id}`, null));
    expect(get.title).toBe('Allgäuer Kässpatzen');
    expect(get.version).toBe(2);
    const titleKey = ctx.deps.db.prepare('SELECT title_key FROM recipes WHERE id = ?').pluck().get(recipe.id);
    expect(titleKey).toBe('allgauer kasspatzen');
  });

  it('replaces ingredients, steps and tags completely', async () => {
    const recipe = await create(BASE);
    const res = await call('PUT', `/recipes/${recipe.id}`, sebastian, {
      ...inputOf(recipe),
      ingredients: [{ name: 'Bergkäse', amount: 200, unit: 'g' }],
      steps: [{ text: 'Neu 1' }, { text: 'Neu 2' }, { text: 'Neu 3' }],
      tags: ['Vegetarisch', 'Käse'],
    });
    expect(res.status).toBe(200);
    const updated = await recipeOf(res);
    expect(updated.ingredients.map((i) => i.name)).toEqual(['Bergkäse']);
    expect(updated.steps.map((s) => s.text)).toEqual(['Neu 1', 'Neu 2', 'Neu 3']);
    expect(updated.tags.map((t) => t.name)).toEqual(['Käse', 'Vegetarisch']);

    const db = ctx.deps.db;
    expect(db.prepare('SELECT count(*) FROM ingredients').pluck().get()).toBe(1);
    expect(db.prepare('SELECT position FROM steps ORDER BY position').pluck().all()).toEqual([0, 1, 2]);
    // The unlinked tag stays in the tag list (managed on the tag page, M4).
    expect(db.prepare('SELECT count(*) FROM tags').pluck().get()).toBe(3);
    expect(db.prepare('SELECT count(*) FROM recipe_tags').pluck().get()).toBe(2);
  });

  it('answers a stale version with 409 VERSION_CONFLICT, the current state and no change', async () => {
    const recipe = await create(BASE);
    // Device A (Anna) saves first …
    const saved = await call('PUT', `/recipes/${recipe.id}`, anna, {
      ...inputOf(recipe),
      title: 'Version von Anna',
    });
    expect(saved.status).toBe(200);
    const current = await recipeOf(saved);

    // … then device B (Sebastian) saves with the version it loaded.
    const res = await call('PUT', `/recipes/${recipe.id}`, sebastian, {
      ...inputOf(recipe),
      title: 'Version von B',
    });
    expect(res.status).toBe(409);
    const error = await errorOf(res);
    expect(error.code).toBe('VERSION_CONFLICT');
    expect(error.message).toBe('Inzwischen von Anna geändert');
    const details = error.details as VersionConflictDetails;
    expect(details.current).toEqual(current);
    expect(details.current.version).toBe(2);

    const after = await recipeOf(await call('GET', `/recipes/${recipe.id}`, anna));
    expect(after).toEqual(current);
  });

  it('answers version 999 with 409 and leaves the record unchanged', async () => {
    const recipe = await create(BASE);
    const res = await call('PUT', `/recipes/${recipe.id}`, sebastian, {
      ...inputOf(recipe),
      title: 'Geändert',
      version: 999,
    });
    expect(res.status).toBe(409);
    expect(((await errorOf(res)).details as VersionConflictDetails).current).toEqual(recipe);
    const after = await recipeOf(await call('GET', `/recipes/${recipe.id}`, sebastian));
    expect(after).toEqual(recipe);
  });

  it('names "einem anderen Gerät" when the last editor profile no longer exists', async () => {
    const recipe = await create(BASE, anna);
    ctx.deps.db.prepare('DELETE FROM profiles WHERE id = ?').run(anna);
    const res = await call('PUT', `/recipes/${recipe.id}`, sebastian, { ...inputOf(recipe), version: 5 });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).message).toBe('Inzwischen von einem anderen Gerät geändert');
  });

  it('overwrites with ?force=1 and sets the version to current + 1', async () => {
    const recipe = await create(BASE);
    const annaSave = await call('PUT', `/recipes/${recipe.id}`, anna, {
      ...inputOf(recipe),
      title: 'Annas Titel',
    });
    expect((await recipeOf(annaSave)).version).toBe(2);

    const res = await call('PUT', `/recipes/${recipe.id}?force=1`, sebastian, {
      ...inputOf(recipe),
      title: 'Meine Version',
      version: 1,
    });
    expect(res.status).toBe(200);
    const forced = await recipeOf(res);
    expect(forced.title).toBe('Meine Version');
    expect(forced.version).toBe(3);
    expect(forced.updatedBy).toEqual({ id: sebastian, name: 'Sebastian' });

    const any = await call('PUT', `/recipes/${recipe.id}?force=1`, sebastian, {
      ...inputOf(forced),
      version: 999,
    });
    expect((await recipeOf(any)).version).toBe(4);
  });

  it('answers a trashed recipe with 410 IN_TRASH naming who deleted it', async () => {
    const recipe = await create(BASE);
    clock = new Date('2026-09-23T12:00:00.000Z');
    expect((await call('DELETE', `/recipes/${recipe.id}`, anna)).status).toBe(204);

    const res = await call('PUT', `/recipes/${recipe.id}`, sebastian, {
      ...inputOf(recipe),
      title: 'Zu spät',
    });
    expect(res.status).toBe(410);
    const error = await errorOf(res);
    expect(error.code).toBe('IN_TRASH');
    const details: InTrashDetails = {
      deletedAt: '2026-09-23T12:00:00.000Z',
      deletedBy: { id: anna, name: 'Anna' },
    };
    expect(error.details).toEqual(details);

    // "wiederherstellen und speichern": restore keeps the version, so the pending save succeeds.
    expect((await call('POST', `/recipes/${recipe.id}/restore`, sebastian)).status).toBe(200);
    const saved = await call('PUT', `/recipes/${recipe.id}`, sebastian, {
      ...inputOf(recipe),
      title: 'Doch noch',
    });
    expect(saved.status).toBe(200);
    expect((await recipeOf(saved)).version).toBe(2);
  });

  it('answers 404, 401 and 400 for unknown ids, missing profile and invalid input', async () => {
    const recipe = await create(BASE);

    const unknown = await call('PUT', '/recipes/4711', sebastian, { title: 'X', version: 1 });
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe('NOT_FOUND');

    const noProfile = await call('PUT', `/recipes/${recipe.id}`, null, { title: 'X', version: 1 });
    expect(noProfile.status).toBe(401);
    expect((await errorOf(noProfile)).code).toBe('PROFILE_REQUIRED');

    const noVersion = await call('PUT', `/recipes/${recipe.id}`, sebastian, { title: 'X' });
    expect(noVersion.status).toBe(400);
    expect(((await errorOf(noVersion)).details as { field: string }[])[0]?.field).toBe('version');

    const badTitle = await call('PUT', `/recipes/${recipe.id}`, sebastian, {
      title: 'a'.repeat(121),
      version: 1,
    });
    expect(badTitle.status).toBe(400);
    expect(((await errorOf(badTitle)).details as { field: string }[])[0]?.field).toBe('title');

    const after = await recipeOf(await call('GET', `/recipes/${recipe.id}`, sebastian));
    expect(after).toEqual(recipe);
  });

  it('ignores createKey, profileId and createdBy in the body', async () => {
    const recipe = await create(BASE);
    const res = await call('PUT', `/recipes/${recipe.id}`, anna, {
      ...inputOf(recipe),
      createKey: 'something-else',
      profileId: sebastian,
      createdBy: anna,
    });
    expect(res.status).toBe(200);
    const updated = await recipeOf(res);
    expect(updated.createdBy?.id).toBe(sebastian);
    expect(updated.updatedBy?.id).toBe(anna);
  });
});

describe('PUT image rules (Kap. 4.6, F-16)', () => {
  function writeVariants(fileKey: string): void {
    for (const v of ['s', 'm', 'l'])
      fs.writeFileSync(path.join(ctx.deps.paths.images, `${fileKey}-${v}.webp`), v);
  }

  it('replaces the image: the old row goes, its files move to images/.trash after the commit', async () => {
    const oldKey = '1111111111111111';
    const newKey = '2222222222222222';
    const oldImage = addImage(oldKey);
    const newImage = addImage(newKey);
    writeVariants(oldKey);
    writeVariants(newKey);
    const recipe = await create({ ...BASE, imageId: oldImage });

    const res = await call('PUT', `/recipes/${recipe.id}`, sebastian, {
      ...inputOf(recipe),
      imageId: newImage,
    });
    expect(res.status).toBe(200);
    expect((await recipeOf(res)).image?.id).toBe(newImage);

    const rows = ctx.deps.db.prepare('SELECT id, recipe_id AS recipeId FROM images').all();
    expect(rows).toEqual([{ id: newImage, recipeId: recipe.id }]);
    const { images, imagesTrash } = ctx.deps.paths;
    for (const v of ['s', 'm', 'l']) {
      expect(fs.existsSync(path.join(images, `${oldKey}-${v}.webp`))).toBe(false);
      expect(fs.existsSync(path.join(imagesTrash, `${oldKey}-${v}.webp`))).toBe(true);
      expect(fs.existsSync(path.join(images, `${newKey}-${v}.webp`))).toBe(true);
    }
    const moved = fs.statSync(path.join(imagesTrash, `${oldKey}-s.webp`));
    expect(moved.mtime.toISOString()).toBe(clock.toISOString());
  });

  it('keeps the current image when the same imageId is sent again', async () => {
    const key = '3333333333333333';
    const imageId = addImage(key);
    writeVariants(key);
    const recipe = await create({ ...BASE, imageId });
    const res = await call('PUT', `/recipes/${recipe.id}`, sebastian, { ...inputOf(recipe), title: 'Neu' });
    expect(res.status).toBe(200);
    expect((await recipeOf(res)).image?.id).toBe(imageId);
    expect(fs.existsSync(path.join(ctx.deps.paths.images, `${key}-l.webp`))).toBe(true);
  });

  it('rejects an image of another recipe and changes nothing', async () => {
    const foreignImage = addImage('4444444444444444');
    await create({ title: 'Anderes Rezept', imageId: foreignImage });
    const ownImage = addImage('5555555555555555');
    const recipe = await create({ ...BASE, imageId: ownImage });

    const res = await call('PUT', `/recipes/${recipe.id}`, sebastian, {
      ...inputOf(recipe),
      title: 'Geändert',
      imageId: foreignImage,
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).details).toEqual([{ field: 'imageId', message: 'Bild nicht gefunden' }]);
    const after = await recipeOf(await call('GET', `/recipes/${recipe.id}`, sebastian));
    expect(after).toEqual(recipe);
  });
});
