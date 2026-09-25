import type BetterSqlite3 from 'better-sqlite3';
import { normalize } from '../../../shared/normalize.ts';
import type { IngredientDetail, PersonRef, StepDetail, TagRef } from '../../../shared/types.ts';
import type { DB } from '../types.ts';
import { setMeta } from './meta.ts';

/**
 * SQL for recipes, their ingredients and steps (Kap. 4.3, 7.4); image rows live in images.ts.
 * Write functions never open a transaction: the recipe service wraps every composite write,
 * including FTS maintenance, in one db.transaction() (NF-19).
 */

type Stmt = BetterSqlite3.Statement<unknown[]>;

const cache = new WeakMap<DB, Map<string, Stmt>>();

/** Prepares each statement once per connection; detail reads run several of them per request. */
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

function person(id: number | null, name: string | null): PersonRef | null {
  return id === null || name === null ? null : { id, name };
}

/** Editable scalar columns of a recipe; title_key is derived here, never passed in. */
export interface RecipeColumns {
  title: string;
  description: string;
  servings: number | null;
  servingsUnit: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  source: string;
}

export interface IngredientWrite {
  group: string;
  amount: number | null;
  amountMax: number | null;
  unit: string;
  name: string;
  note: string;
}

export interface RecipeRow extends RecipeColumns {
  id: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdBy: PersonRef | null;
  updatedBy: PersonRef | null;
  deletedBy: PersonRef | null;
}

interface RecipeDbRow extends RecipeColumns {
  id: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdById: number | null;
  createdByName: string | null;
  updatedById: number | null;
  updatedByName: string | null;
  deletedById: number | null;
  deletedByName: string | null;
}

/** The recipe with author, editor and trash info, or null if the id does not exist (trashed ones included). */
export function findRecipe(db: DB, id: number): RecipeRow | null {
  const row = prepared(
    db,
    `SELECT r.id, r.title, r.description, r.servings, r.servings_unit AS servingsUnit,
            r.prep_minutes AS prepMinutes, r.cook_minutes AS cookMinutes, r.source, r.version,
            r.created_at AS createdAt, r.updated_at AS updatedAt, r.deleted_at AS deletedAt,
            r.created_by AS createdById, cp.name AS createdByName,
            r.updated_by AS updatedById, up.name AS updatedByName,
            r.deleted_by AS deletedById, dp.name AS deletedByName
     FROM recipes r
     LEFT JOIN profiles cp ON cp.id = r.created_by
     LEFT JOIN profiles up ON up.id = r.updated_by
     LEFT JOIN profiles dp ON dp.id = r.deleted_by
     WHERE r.id = ?`,
  ).get(id) as RecipeDbRow | undefined;
  if (!row) return null;
  const { createdById, createdByName, updatedById, updatedByName, deletedById, deletedByName, ...rest } = row;
  return {
    ...rest,
    createdBy: person(createdById, createdByName),
    updatedBy: person(updatedById, updatedByName),
    deletedBy: person(deletedById, deletedByName),
  };
}

/** Id of the recipe created with this createKey (NF-09), trashed ones included. */
export function findRecipeIdByCreateKey(db: DB, createKey: string): number | null {
  const row = prepared(db, 'SELECT id FROM recipes WHERE create_key = ?').get(createKey) as
    | { id: number }
    | undefined;
  return row ? row.id : null;
}

export interface RecipeInsert extends RecipeColumns {
  createKey: string;
  profileId: number;
  /** ISO 8601 UTC, used for created_at and updated_at. */
  now: string;
}

/**
 * Recipe ids are never handed out twice: after a purge (F-08) an old draft:<id>, deep link or open
 * tab must answer 404 instead of showing a different recipe. recipes.id is an INTEGER PRIMARY KEY
 * without AUTOINCREMENT (migration 001), so SQLite alone would hand out max(id) + 1 again after the
 * newest recipe was purged. meta.recipe_id_max remembers the highest id ever used instead; max(id)
 * covers rows inserted around the counter (older databases, direct inserts in tests). The FTS rowid
 * stays recipes.id.
 */
const ID_COUNTER = 'recipe_id_max';

function highestUsedRecipeId(db: DB): number {
  return prepared(
    db,
    `SELECT max(coalesce((SELECT CAST(value AS INTEGER) FROM meta WHERE key = ?), 0),
                coalesce((SELECT max(id) FROM recipes), 0))`,
  )
    .pluck()
    .get(ID_COUNTER) as number;
}

/** Reserves the next recipe id and raises the counter. Runs inside the caller's insert transaction. */
export function allocateRecipeId(db: DB): number {
  const id = highestUsedRecipeId(db) + 1;
  setMeta(db, ID_COUNTER, String(id));
  return id;
}

/**
 * Raises the counter to the highest used id. Called before a purge, so the purged id stays
 * reserved even when its row was inserted without allocateRecipeId.
 */
export function reserveUsedRecipeIds(db: DB): void {
  setMeta(db, ID_COUNTER, String(highestUsedRecipeId(db)));
}

/** Inserts the recipe row with version 1 and an id from allocateRecipeId; returns the id. */
export function insertRecipe(db: DB, recipe: RecipeInsert): number {
  const id = allocateRecipeId(db);
  prepared(
    db,
    `INSERT INTO recipes(id, title, title_key, description, servings, servings_unit, prep_minutes, cook_minutes,
                         source, create_key, version, created_by, updated_by, created_at, updated_at)
     VALUES (@id, @title, @titleKey, @description, @servings, @servingsUnit, @prepMinutes, @cookMinutes,
             @source, @createKey, 1, @profileId, @profileId, @now, @now)`,
  ).run({ ...recipe, id, titleKey: normalize(recipe.title) });
  return id;
}

export interface RecipeUpdate extends RecipeColumns {
  profileId: number;
  now: string;
  /** The new version; only the service decides it (F-07). */
  version: number;
}

export function updateRecipeRow(db: DB, id: number, recipe: RecipeUpdate): void {
  prepared(
    db,
    `UPDATE recipes
     SET title = @title, title_key = @titleKey, description = @description, servings = @servings,
         servings_unit = @servingsUnit, prep_minutes = @prepMinutes, cook_minutes = @cookMinutes,
         source = @source, version = @version, updated_by = @profileId, updated_at = @now
     WHERE id = @id`,
  ).run({ ...recipe, id, titleKey: normalize(recipe.title) });
}

/** Replaces all ingredients; positions follow the array order (0..n-1). */
export function replaceIngredients(db: DB, recipeId: number, ingredients: readonly IngredientWrite[]): void {
  prepared(db, 'DELETE FROM ingredients WHERE recipe_id = ?').run(recipeId);
  const insert = prepared(
    db,
    `INSERT INTO ingredients(recipe_id, position, group_name, amount, amount_max, unit, name, name_key, note)
     VALUES (@recipeId, @position, @group, @amount, @amountMax, @unit, @name, @nameKey, @note)`,
  );
  ingredients.forEach((ing, position) => {
    insert.run({ ...ing, recipeId, position, nameKey: normalize(ing.name) });
  });
}

/** Replaces all steps; positions follow the array order (0..n-1). */
export function replaceSteps(db: DB, recipeId: number, texts: readonly string[]): void {
  prepared(db, 'DELETE FROM steps WHERE recipe_id = ?').run(recipeId);
  const insert = prepared(db, 'INSERT INTO steps(recipe_id, position, text) VALUES (?, ?, ?)');
  texts.forEach((text, position) => {
    insert.run(recipeId, position, text);
  });
}

export function listIngredients(db: DB, recipeId: number): IngredientDetail[] {
  const rows = prepared(
    db,
    `SELECT id, group_name AS groupName, amount, amount_max AS amountMax, unit, name, note
     FROM ingredients WHERE recipe_id = ? ORDER BY position, id`,
  ).all(recipeId) as Array<Omit<IngredientDetail, 'group'> & { groupName: string }>;
  return rows.map(({ groupName, ...rest }) => ({
    id: rest.id,
    group: groupName,
    amount: rest.amount,
    amountMax: rest.amountMax,
    unit: rest.unit,
    name: rest.name,
    note: rest.note,
  }));
}

export function listSteps(db: DB, recipeId: number): StepDetail[] {
  return prepared(db, 'SELECT id, text FROM steps WHERE recipe_id = ? ORDER BY position, id').all(
    recipeId,
  ) as StepDetail[];
}

/** Tags of a recipe ordered like everywhere else: by name_key (Kap. 4.4). */
export function listRecipeTags(db: DB, recipeId: number): TagRef[] {
  return prepared(
    db,
    `SELECT t.id, t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
     WHERE rt.recipe_id = ? ORDER BY t.name_key, t.name, t.id`,
  ).all(recipeId) as TagRef[];
}

export interface RatingRow {
  profileId: number;
  name: string;
  stars: number;
}

/** All ratings of a recipe with the profile name, ordered by name (DIN 5007-1 via name_key). */
export function listRatings(db: DB, recipeId: number): RatingRow[] {
  return prepared(
    db,
    `SELECT r.profile_id AS profileId, p.name, r.stars
     FROM ratings r JOIN profiles p ON p.id = r.profile_id
     WHERE r.recipe_id = ? ORDER BY p.name_key, p.name, p.id`,
  ).all(recipeId) as RatingRow[];
}

export function isFavorite(db: DB, recipeId: number, profileId: number): boolean {
  return (
    prepared(db, 'SELECT 1 FROM favorites WHERE recipe_id = ? AND profile_id = ?').get(
      recipeId,
      profileId,
    ) !== undefined
  );
}

/** Moves the recipe to the trash (F-08). The FTS row stays; searches filter on deleted_at (Kap. 4.3). */
export function trashRecipeRow(db: DB, id: number, profileId: number, now: string): void {
  prepared(db, 'UPDATE recipes SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(now, profileId, id);
}

export function restoreRecipeRow(db: DB, id: number): void {
  prepared(db, 'UPDATE recipes SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(id);
}

/**
 * Raises the version of each recipe by exactly 1, trashed ones included (F-19): after a tag rename,
 * merge or delete a stale PUT gets 409 VERSION_CONFLICT instead of reviving the old tag by upsert.
 * updated_at and updated_by stay: tag maintenance is not a content edit ("geändert von … am …").
 */
export function bumpRecipeVersions(db: DB, ids: readonly number[]): void {
  prepared(db, 'UPDATE recipes SET version = version + 1 WHERE id IN (SELECT value FROM json_each(?))').run(
    JSON.stringify(ids),
  );
}
