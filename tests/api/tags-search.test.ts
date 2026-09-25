import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../shared/error-codes.ts';
import type { RecipeListPage, TagExistsDetails, TagMergeResponse, TagResponse } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';
import { insertProfile, insertRecipe, tagId } from '../helpers/recipes.ts';

/**
 * F-19 AK2 „Nach Umbenennen oder Zusammenführen findet die Suche die Rezepte unter dem neuen Namen
 * (API-Test)“: the tag API (Kap. 7.6) rebuilds the search index of every linked recipe, trashed ones too,
 * so GET /recipes?q= finds them under the new name and no longer under the old one. The tag names below
 * appear nowhere else in the recipes, so every hit comes from the tags column of the index.
 */

const API = 'http://localhost:8080/api/v1';

let ctx: TestContext;
let profileId: number;
let ids: Record<'grutze' | 'strudel' | 'panna' | 'creme' | 'suppe' | 'tiramisu', number>;

beforeEach(() => {
  ctx = createTestContext();
  const db = ctx.deps.db;
  profileId = insertProfile(db, 'Anna');
  ids = {
    grutze: insertRecipe(db, { title: 'Rote Grütze', ingredients: ['Kirschen'], tags: ['Nachtisch'] }),
    strudel: insertRecipe(db, {
      title: 'Apfelstrudel',
      ingredients: ['Äpfel'],
      tags: ['Nachtisch', 'Dessert'],
    }),
    panna: insertRecipe(db, { title: 'Panna cotta', steps: ['Sahne aufkochen'], tags: ['Nachtisch'] }),
    // In the trash: the index keeps it until the purge, and a restore must bring back the new name.
    creme: insertRecipe(db, {
      title: 'Zitronencreme',
      tags: ['Nachtisch'],
      deletedAt: '2026-09-20T08:00:00.000Z',
    }),
    suppe: insertRecipe(db, { title: 'Linsensuppe', ingredients: ['Linsen'], tags: ['Suppe'] }),
    tiramisu: insertRecipe(db, { title: 'Tiramisu', ingredients: ['Mascarpone'], tags: ['Dessert'] }),
  };
});

afterEach(() => {
  try {
    // Every tag write keeps exactly one FTS row per recipe (Kap. 4.3).
    const db = ctx.deps.db;
    const count = (table: string): number =>
      db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
    expect(count('recipes_fts')).toBe(count('recipes'));
  } finally {
    ctx.cleanup();
  }
});

async function call(method: string, urlPath: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: { ...CLIENT_HEADERS, 'X-Profile-Id': String(profileId) } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return ctx.app.request(`${API}${urlPath}`, init);
}

/** Ids found by GET /recipes?q= (active recipes only), sorted. */
async function search(q: string): Promise<number[]> {
  const res = await call('GET', `/recipes?${new URLSearchParams({ q, limit: '100' }).toString()}`);
  expect(res.status, q).toBe(200);
  const page = (await res.json()) as RecipeListPage;
  expect(page.total, q).toBe(page.items.length);
  return page.items.map((item) => item.id).sort((a, b) => a - b);
}

function sorted(...list: number[]): number[] {
  return [...list].sort((a, b) => a - b);
}

async function restore(id: number): Promise<void> {
  expect((await call('POST', `/recipes/${id}/restore`)).status).toBe(200);
}

describe('search after tag changes (F-19 AK2)', () => {
  it('finds the recipes under the new name after a rename, and none under the old one', async () => {
    const nachtisch = tagId(ctx.deps.db, 'Nachtisch');
    expect(await search('Nachtisch')).toEqual(sorted(ids.grutze, ids.strudel, ids.panna));
    expect(await search('Leckerei')).toEqual([]);

    const res = await call('PATCH', `/tags/${nachtisch}`, { name: 'Leckerei' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TagResponse).tag).toEqual({ id: nachtisch, name: 'Leckerei', count: 3 });

    expect(await search('Leckerei')).toEqual(sorted(ids.grutze, ids.strudel, ids.panna));
    expect(await search('lecker')).toEqual(sorted(ids.grutze, ids.strudel, ids.panna));
    expect(await search('Nachtisch')).toEqual([]);
    expect(await search('Nacht')).toEqual([]);

    // The trashed recipe was reindexed too: restored, it has the new name only.
    await restore(ids.creme);
    expect(await search('Leckerei')).toEqual(sorted(ids.grutze, ids.strudel, ids.panna, ids.creme));
    expect(await search('Nachtisch')).toEqual([]);
  });

  it('finds a renamed tag in every spelling of its new name (F-22) and by each of its words', async () => {
    const nachtisch = tagId(ctx.deps.db, 'Nachtisch');
    expect((await call('PATCH', `/tags/${nachtisch}`, { name: 'Süßspeise für Gäste' })).status).toBe(200);

    const expected = sorted(ids.grutze, ids.strudel, ids.panna);
    for (const q of ['Süßspeise', 'süssspeise', 'SUESSSPEISE', 'susspeise', 'gaeste', 'Süßspeise Gäste']) {
      expect(await search(q), q).toEqual(expected);
    }
    expect(await search('Nachtisch')).toEqual([]);
  });

  it('finds the recipes of both tags under the target after a merge, and none under the source', async () => {
    const nachtisch = tagId(ctx.deps.db, 'Nachtisch');
    const dessert = tagId(ctx.deps.db, 'Dessert');
    expect(await search('Dessert')).toEqual(sorted(ids.strudel, ids.tiramisu));

    const res = await call('POST', `/tags/${nachtisch}/merge`, { intoTagId: dessert });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TagMergeResponse;
    expect(body).toEqual({ tag: { id: dessert, name: 'Dessert', count: 4 }, movedRecipes: 3 });

    const both = sorted(ids.grutze, ids.strudel, ids.panna, ids.tiramisu);
    expect(await search('Dessert')).toEqual(both);
    expect(await search('Nachtisch')).toEqual([]);
    // The tag filter agrees with the search (links and index changed in one transaction, NF-19).
    const filtered = await call('GET', `/recipes?tags=${dessert}&limit=100`);
    const page = (await filtered.json()) as RecipeListPage;
    expect(page.items.map((item) => item.id).sort((a, b) => a - b)).toEqual(both);

    await restore(ids.creme);
    expect(await search('Dessert')).toEqual(sorted(...both, ids.creme));
    expect(await search('Nachtisch')).toEqual([]);
  });

  it('keeps the index as it was when a rename is refused with 409 TAG_EXISTS', async () => {
    const nachtisch = tagId(ctx.deps.db, 'Nachtisch');
    const dessert = tagId(ctx.deps.db, 'Dessert');

    const res = await call('PATCH', `/tags/${nachtisch}`, { name: 'dessert' });
    expect(res.status).toBe(409);
    const { error } = (await res.json()) as ErrorBody;
    expect(error.code).toBe('TAG_EXISTS');
    const details: TagExistsDetails = { targetId: dessert, targetName: 'Dessert', affectedRecipes: 3 };
    expect(error.details).toEqual(details);

    expect(await search('Nachtisch')).toEqual(sorted(ids.grutze, ids.strudel, ids.panna));
    expect(await search('Dessert')).toEqual(sorted(ids.strudel, ids.tiramisu));
  });

  it('finds nothing under a deleted tag, and its recipes stay (F-19 AK3)', async () => {
    const nachtisch = tagId(ctx.deps.db, 'Nachtisch');
    const before = await search('');
    expect(before).toHaveLength(5);

    expect((await call('DELETE', `/tags/${nachtisch}`)).status).toBe(204);

    expect(await search('Nachtisch')).toEqual([]);
    expect(await search('')).toEqual(before);
    expect(await search('Grütze')).toEqual([ids.grutze]);
    await restore(ids.creme);
    expect(await search('Nachtisch')).toEqual([]);
    expect(await search('Zitronencreme')).toEqual([ids.creme]);
  });
});
