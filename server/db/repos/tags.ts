import type BetterSqlite3 from 'better-sqlite3';
import { normalize } from '../../../shared/normalize.ts';
import type { TagCount } from '../../../shared/types.ts';
import { type FtsRow, removeFromIndex } from '../fts.ts';
import type { DB } from '../types.ts';

/**
 * SQL for tags (F-17 to F-20, Kap. 7.4, 7.6): upsert by name_key and links for recipe writes, plus
 * the reads and writes of the tag API (list with counts, create, rename, merge, delete) and the
 * batched FTS rebuild of the recipes a tag change touches.
 * None of these functions opens a transaction: the recipe or tag service that calls them owns it,
 * together with the version bump and the FTS rows of the affected recipes (NF-19).
 */

type Stmt = BetterSqlite3.Statement<unknown[]>;

const cache = new WeakMap<DB, Map<string, Stmt>>();

function prepared(db: DB, sql: string): Stmt {
  let perDb = cache.get(db);
  if (!perDb) {
    perDb = new Map();
    cache.set(db, perDb);
  }
  let stmt = perDb.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    perDb.set(sql, stmt);
  }
  return stmt;
}

export interface TagName {
  name: string;
  key: string;
}

/**
 * Distinct tag names by normalized key, in input order; the first spelling of a key wins.
 * Names whose key is empty (e.g. only combining marks) are left out: they cannot be told apart.
 */
export function distinctTagNames(names: readonly string[]): TagName[] {
  const seen = new Set<string>();
  const result: TagName[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = normalize(name);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, key });
  }
  return result;
}

/**
 * Upserts tags by name_key and returns their ids in input order, duplicates collapsed.
 * An existing tag keeps its display name ("Süßspeise" stays even if "SÜSSSPEISE" is typed);
 * a new tag is stored as typed. New tags only exist once the caller's transaction commits (F-18).
 */
export function upsertTags(db: DB, names: readonly string[]): number[] {
  const insert = prepared(
    db,
    'INSERT INTO tags(name, name_key) VALUES (?, ?) ON CONFLICT(name_key) DO NOTHING',
  );
  const find = prepared(db, 'SELECT id FROM tags WHERE name_key = ?');
  const ids: number[] = [];
  for (const { name, key } of distinctTagNames(names)) {
    insert.run(name, key);
    const row = find.get(key) as { id: number } | undefined;
    if (row) ids.push(row.id);
  }
  return ids;
}

/** Replaces all tag links of a recipe with the given tag ids (duplicates ignored). */
export function setRecipeTags(db: DB, recipeId: number, tagIds: readonly number[]): void {
  prepared(db, 'DELETE FROM recipe_tags WHERE recipe_id = ?').run(recipeId);
  const link = prepared(db, 'INSERT OR IGNORE INTO recipe_tags(recipe_id, tag_id) VALUES (?, ?)');
  for (const tagId of tagIds) link.run(recipeId, tagId);
}

// ---------------------------------------------------------------------------------------------
// Tag API (Kap. 7.6)

/** Counts only active recipes: a tag used only in the trash shows 0 (F-19, F-20). */
const WITH_COUNT = `SELECT t.id, t.name, count(r.id) AS count
  FROM tags t
  LEFT JOIN recipe_tags rt ON rt.tag_id = t.id
  LEFT JOIN recipes r ON r.id = rt.recipe_id AND r.deleted_at IS NULL`;

/** All tags with their count, ordered by count descending, then name_key, name and id (Kap. 7.6). */
export function listTagsWithCounts(db: DB): TagCount[] {
  return prepared(
    db,
    `${WITH_COUNT} GROUP BY t.id ORDER BY count DESC, t.name_key, t.name, t.id`,
  ).all() as TagCount[];
}

/** One tag with its count, or null if the id does not exist. */
export function tagWithCount(db: DB, id: number): TagCount | null {
  const row = prepared(db, `${WITH_COUNT} WHERE t.id = ? GROUP BY t.id`).get(id) as TagCount | undefined;
  return row ?? null;
}

export interface TagRow {
  id: number;
  name: string;
  nameKey: string;
}

export function findTag(db: DB, id: number): TagRow | null {
  const row = prepared(db, 'SELECT id, name, name_key AS nameKey FROM tags WHERE id = ?').get(id) as
    | TagRow
    | undefined;
  return row ?? null;
}

export function findTagByKey(db: DB, key: string): TagRow | null {
  const row = prepared(db, 'SELECT id, name, name_key AS nameKey FROM tags WHERE name_key = ?').get(key) as
    | TagRow
    | undefined;
  return row ?? null;
}

/** Inserts a new tag and returns its id; the caller has checked that the key is free. */
export function insertTag(db: DB, name: string, key: string): number {
  return Number(
    prepared(db, 'INSERT INTO tags(name, name_key) VALUES (?, ?)').run(name, key).lastInsertRowid,
  );
}

export function renameTagRow(db: DB, id: number, name: string, key: string): void {
  prepared(db, 'UPDATE tags SET name = ?, name_key = ? WHERE id = ?').run(name, key, id);
}

/** Ids of every recipe linked to the tag, trashed ones included (their version and FTS row change too). */
export function recipeIdsForTag(db: DB, tagId: number): number[] {
  return prepared(db, 'SELECT recipe_id FROM recipe_tags WHERE tag_id = ? ORDER BY recipe_id')
    .pluck()
    .all(tagId) as number[];
}

/** Active recipes linked to the tag (the number the confirmations name, F-19). */
export function countActiveRecipes(db: DB, tagId: number): number {
  return prepared(
    db,
    `SELECT count(*) FROM recipe_tags rt JOIN recipes r ON r.id = rt.recipe_id
     WHERE rt.tag_id = ? AND r.deleted_at IS NULL`,
  )
    .pluck()
    .get(tagId) as number;
}

/** Links the recipes to the tag; a recipe that already has it keeps one link (primary key). */
export function linkRecipesToTag(db: DB, recipeIds: readonly number[], tagId: number): void {
  prepared(
    db,
    'INSERT OR IGNORE INTO recipe_tags(recipe_id, tag_id) SELECT value, @tagId FROM json_each(@ids)',
  ).run({ ids: JSON.stringify(recipeIds), tagId });
}

/** Deletes the tag; the foreign key cascade removes its links, the recipes stay. */
export function deleteTagRow(db: DB, id: number): void {
  prepared(db, 'DELETE FROM tags WHERE id = ?').run(id);
}

export function countTags(db: DB): number {
  return prepared(db, 'SELECT count(*) FROM tags').pluck().get() as number;
}

// ---------------------------------------------------------------------------------------------
// FTS rows of many recipes at once (NF-04 AK3)

interface ChildRow {
  recipeId: number;
}

function byRecipe<T extends ChildRow>(rows: readonly T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const list = map.get(row.recipeId);
    if (list) list.push(row);
    else map.set(row.recipeId, [row]);
  }
  return map;
}

/**
 * The FTS values of many recipes (trashed ones included), read with four set-based statements instead of
 * four per recipe. A tag on all 1,000 seed recipes is then renamed, merged or deleted in about 80 ms instead
 * of 115 ms (tests/perf/tags.perf.ts). The values are exactly those of ftsRowFor in fts.ts, which stays the
 * single-recipe path: tests/api/tags.test.ts compares both for every recipe of a seeded database.
 * Ids without a recipe are left out.
 */
export function ftsRowsFor(db: DB, recipeIds: readonly number[]): Map<number, FtsRow> {
  const ids = JSON.stringify(recipeIds);
  const recipes = prepared(
    db,
    'SELECT id, title, description FROM recipes WHERE id IN (SELECT value FROM json_each(?))',
  ).all(ids) as { id: number; title: string; description: string }[];
  const tags = byRecipe(
    prepared(
      db,
      `SELECT rt.recipe_id AS recipeId, t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
       WHERE rt.recipe_id IN (SELECT value FROM json_each(?)) ORDER BY rt.recipe_id, t.name_key`,
    ).all(ids) as { recipeId: number; name: string }[],
  );
  const ingredients = byRecipe(
    prepared(
      db,
      `SELECT recipe_id AS recipeId, group_name AS groupName, name FROM ingredients
       WHERE recipe_id IN (SELECT value FROM json_each(?)) ORDER BY recipe_id, position, id`,
    ).all(ids) as { recipeId: number; groupName: string; name: string }[],
  );
  const steps = byRecipe(
    prepared(
      db,
      `SELECT recipe_id AS recipeId, text FROM steps
       WHERE recipe_id IN (SELECT value FROM json_each(?)) ORDER BY recipe_id, position, id`,
    ).all(ids) as { recipeId: number; text: string }[],
  );

  const rows = new Map<number, FtsRow>();
  for (const recipe of recipes) {
    // Group names ("Für den Teig") are searchable too, but only once per group (as in ftsRowFor).
    const ingredientWords: string[] = [];
    const groups = new Set<string>();
    for (const row of ingredients.get(recipe.id) ?? []) {
      if (row.groupName && !groups.has(row.groupName)) {
        groups.add(row.groupName);
        ingredientWords.push(row.groupName);
      }
      ingredientWords.push(row.name);
    }
    const stepTexts = (steps.get(recipe.id) ?? []).map((s) => s.text);
    rows.set(recipe.id, {
      title: normalize(recipe.title),
      tags: normalize((tags.get(recipe.id) ?? []).map((t) => t.name).join(' ')),
      ingredients: normalize(ingredientWords.join(' ')),
      body: normalize([recipe.description, ...stepTexts].join(' ')),
    });
  }
  return rows;
}

/** Replaces the FTS rows of the recipes, like reindexRecipe for each id; the caller owns the transaction. */
export function reindexRecipes(db: DB, recipeIds: readonly number[]): void {
  const rows = ftsRowsFor(db, recipeIds);
  const insert = prepared(
    db,
    `INSERT INTO recipes_fts(rowid, title, tags, ingredients, body)
     VALUES (@id, @title, @tags, @ingredients, @body)`,
  );
  for (const id of new Set(recipeIds)) {
    removeFromIndex(db, id);
    const row = rows.get(id);
    if (row) insert.run({ id, ...row });
  }
}
