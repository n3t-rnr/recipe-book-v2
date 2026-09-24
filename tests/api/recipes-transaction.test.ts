import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../shared/error-codes.ts';
import { normalize } from '../../shared/normalize.ts';
import type { RecipeDetail, RecipeResponse } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';

const API = 'http://localhost:8080/api/v1';

let ctx: TestContext;
let profileId: number;

beforeEach(() => {
  ctx = createTestContext();
  profileId = Number(
    ctx.deps.db
      .prepare('INSERT INTO profiles(name, name_key) VALUES (?, ?)')
      .run('Sebastian', normalize('Sebastian')).lastInsertRowid,
  );
});

afterEach(() => {
  ctx.cleanup();
});

async function call(method: string, urlPath: string, body: unknown): Promise<Response> {
  return ctx.app.request(`${API}${urlPath}`, {
    method,
    headers: { ...CLIENT_HEADERS, 'X-Profile-Id': String(profileId) },
    body: JSON.stringify(body),
  });
}

function count(table: string): number {
  return ctx.deps.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
}

/** Makes SQLite abort the insert of the 3rd step (position 2), in the middle of the transaction. */
function failOnThirdStep(): void {
  ctx.deps.db.exec(`
    CREATE TRIGGER fail_third_step BEFORE INSERT ON steps
    WHEN NEW.position = 2
    BEGIN
      SELECT RAISE(ABORT, 'forced failure on step 3');
    END;
  `);
}

const RECIPE = {
  title: 'Käsespätzle',
  ingredients: [{ name: 'Mehl', amount: 400, unit: 'g' }, { name: 'Eier', amount: 4 }, { name: 'Bergkäse' }],
  steps: [{ text: 'Teig schlagen.' }, { text: 'Spätzle schaben.' }, { text: 'Mit Käse schichten.' }],
  tags: ['Schwäbisch', 'Vegetarisch'],
};

describe('transactions (NF-19)', () => {
  it('a forced failure on the 3rd step leaves no half recipe behind', async () => {
    const imageId = Number(
      ctx.deps.db
        .prepare('INSERT INTO images(file_key, width, height, bytes_total) VALUES (?, 2048, 1365, 1)')
        .run('0123456789abcdef').lastInsertRowid,
    );
    failOnThirdStep();

    const res = await call('POST', '/recipes', { ...RECIPE, imageId, createKey: 'nf19-create-key' });
    expect(res.status).toBe(500);
    const error = ((await res.json()) as ErrorBody).error;
    expect(error.code).toBe('INTERNAL');
    expect(JSON.stringify(error)).not.toContain('forced failure');
    expect(ctx.log.entries.some((e) => e.msg === 'unhandled error')).toBe(true);

    for (const table of ['recipes', 'ingredients', 'steps', 'recipe_tags', 'tags', 'recipes_fts']) {
      expect(count(table), table).toBe(0);
    }
    // The upload stays unassigned and can be used by the next attempt.
    expect(ctx.deps.db.prepare('SELECT recipe_id FROM images WHERE id = ?').pluck().get(imageId)).toBeNull();

    // After the cause is gone, the same createKey creates the recipe (nothing half-written blocks it).
    ctx.deps.db.exec('DROP TRIGGER fail_third_step');
    const retry = await call('POST', '/recipes', { ...RECIPE, imageId, createKey: 'nf19-create-key' });
    expect(retry.status).toBe(201);
    const recipe = ((await retry.json()) as RecipeResponse).recipe;
    expect(recipe.steps).toHaveLength(3);
    expect(recipe.image?.id).toBe(imageId);
    expect(count('recipes_fts')).toBe(1);
  });

  it('a failed update keeps the previous state including version and index', async () => {
    const created = await call('POST', '/recipes', { title: 'Käsespätzle', createKey: 'nf19-update-key' });
    expect(created.status).toBe(201);
    const before: RecipeDetail = ((await created.json()) as RecipeResponse).recipe;
    failOnThirdStep();

    const res = await call('PUT', `/recipes/${before.id}`, { ...RECIPE, title: 'Linsensuppe', version: 1 });
    expect(res.status).toBe(500);

    const get = await ctx.app.request(`${API}/recipes/${before.id}`, {
      headers: { ...CLIENT_HEADERS, 'X-Profile-Id': String(profileId) },
    });
    expect(((await get.json()) as RecipeResponse).recipe).toEqual(before);
    expect(count('ingredients')).toBe(0);
    expect(count('tags')).toBe(0);
    const matches = ctx.deps.db
      .prepare('SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH \'"kase"*\'')
      .pluck()
      .all();
    expect(matches).toEqual([before.id]);
  });
});
