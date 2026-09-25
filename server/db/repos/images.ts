import type BetterSqlite3 from 'better-sqlite3';
import type { DB } from '../types.ts';
import { setMeta } from './meta.ts';

/**
 * SQL for the images table (Kap. 4.3, 4.6): one row per upload, recipe_id NULL until a recipe
 * write assigns it. Write functions never open a transaction; the callers wrap upload, assignment,
 * detachment and expiry in their own db.transaction() (NF-19).
 */

type Stmt = BetterSqlite3.Statement<unknown[]>;

const cache = new WeakMap<DB, Map<string, Stmt>>();

/** Prepares each statement once per connection; the recipe detail reads the image on every request. */
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

export interface ImageRow {
  id: number;
  recipeId: number | null;
  fileKey: string;
  /** Size of variant l, used for fixed image dimensions in the UI (NF-06). */
  width: number;
  height: number;
}

export interface NewImage {
  fileKey: string;
  width: number;
  height: number;
  /** Sum of the three variant files (status page). */
  bytesTotal: number;
  /** ISO 8601 UTC; the 7-day cleanup of unassigned uploads counts from here (F-16). */
  createdAt: string;
}

const IMAGE_COLUMNS = 'id, recipe_id AS recipeId, file_key AS fileKey, width, height';

/**
 * Image ids are never handed out twice (F-09, F-16): a draft, an open editor or GET /images/:id
 * that still knows the id of an expired or removed upload must get 404 or "Bild nicht gefunden",
 * never somebody else's newer photo. images.id is an INTEGER PRIMARY KEY without AUTOINCREMENT
 * (migration 001), so SQLite alone would hand out max(id) + 1 again once the newest image is gone.
 * meta.image_id_max remembers the highest id ever used instead; max(id) covers rows inserted around
 * the counter (older databases, direct inserts in tests).
 */
export const IMAGE_ID_COUNTER = 'image_id_max';

function highestUsedImageId(db: DB): number {
  return prepared(
    db,
    `SELECT max(coalesce((SELECT CAST(value AS INTEGER) FROM meta WHERE key = ?), 0),
                coalesce((SELECT max(id) FROM images), 0))`,
  )
    .pluck()
    .get(IMAGE_ID_COUNTER) as number;
}

/** Reserves the next image id and raises the counter. Runs inside the caller's insert transaction. */
export function allocateImageId(db: DB): number {
  const id = highestUsedImageId(db) + 1;
  setMeta(db, IMAGE_ID_COUNTER, String(id));
  return id;
}

/**
 * Raises the counter over the ids of rows that were just deleted, so they stay reserved even when a
 * row was inserted without allocateImageId. No write when nothing was deleted. Runs inside the
 * caller's transaction, right after the DELETE.
 */
export function reserveDeletedImageIds(db: DB, deletedIds: readonly number[]): void {
  if (deletedIds.length === 0) return;
  const highest = deletedIds.reduce((max, id) => Math.max(max, id), highestUsedImageId(db));
  setMeta(db, IMAGE_ID_COUNTER, String(highest));
}

/**
 * Inserts an unassigned upload (recipe_id NULL) with an id from allocateImageId and returns the id.
 * Two writes (meta, images): the caller runs it inside db.transaction().
 */
export function insertImage(db: DB, image: NewImage): number {
  const id = allocateImageId(db);
  prepared(
    db,
    'INSERT INTO images(id, recipe_id, file_key, width, height, bytes_total, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)',
  ).run(id, image.fileKey, image.width, image.height, image.bytesTotal, image.createdAt);
  return id;
}

/** Sum of the variant files of every image row (bytes_total), the images/ part of /health (Kap. 7.8). */
export function sumImageBytes(db: DB): number {
  return prepared(db, 'SELECT coalesce(sum(bytes_total), 0) FROM images').pluck().get() as number;
}

export function findImage(db: DB, imageId: number): ImageRow | null {
  const row = prepared(db, `SELECT ${IMAGE_COLUMNS} FROM images WHERE id = ?`).get(imageId) as
    | ImageRow
    | undefined;
  return row ?? null;
}

export function findRecipeImage(db: DB, recipeId: number): ImageRow | null {
  const row = prepared(db, `SELECT ${IMAGE_COLUMNS} FROM images WHERE recipe_id = ?`).get(recipeId) as
    | ImageRow
    | undefined;
  return row ?? null;
}

/**
 * Deletes the image rows of a recipe except keepImageId (null = delete all) and returns their
 * file keys, so the caller can move the files to images/.trash after the commit (F-16). Their ids
 * stay reserved (reserveDeletedImageIds); runs inside the recipe service's transaction.
 */
export function detachRecipeImages(db: DB, recipeId: number, keepImageId: number | null): string[] {
  const rows = prepared(
    db,
    'DELETE FROM images WHERE recipe_id = ? AND id IS NOT ? RETURNING id, file_key',
  ).all(recipeId, keepImageId) as Array<{ id: number; file_key: string }>;
  reserveDeletedImageIds(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => r.file_key);
}

export function assignImage(db: DB, imageId: number, recipeId: number): void {
  prepared(db, 'UPDATE images SET recipe_id = ? WHERE id = ?').run(recipeId, imageId);
}
