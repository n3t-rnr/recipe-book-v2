import type { PersonRef } from '../../../shared/types.ts';
import type { DB } from '../types.ts';

export interface TrashRow {
  id: number;
  title: string;
  deletedAt: string;
  /** null when the deleting profile was removed meanwhile (deleted_by ON DELETE SET NULL). */
  deletedBy: PersonRef | null;
}

/** Recipes in the trash, most recently deleted first (F-08). */
export function listTrash(db: DB): TrashRow[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.title, r.deleted_at, p.id AS by_id, p.name AS by_name
       FROM recipes r
       LEFT JOIN profiles p ON p.id = r.deleted_by
       WHERE r.deleted_at IS NOT NULL
       ORDER BY r.deleted_at DESC, r.id DESC`,
    )
    .all() as {
    id: number;
    title: string;
    deleted_at: string;
    by_id: number | null;
    by_name: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    deletedAt: r.deleted_at,
    deletedBy: r.by_id === null || r.by_name === null ? null : { id: r.by_id, name: r.by_name },
  }));
}

/** undefined = no such recipe; deletedAt null = active recipe. */
export function getDeletedAt(db: DB, recipeId: number): { deletedAt: string | null } | undefined {
  const row = db.prepare('SELECT deleted_at FROM recipes WHERE id = ?').get(recipeId) as
    | { deleted_at: string | null }
    | undefined;
  return row ? { deletedAt: row.deleted_at } : undefined;
}

/** Ids of trashed recipes deleted at or before `cutoff` (ISO 8601 UTC, same format as deleted_at). */
export function expiredTrashIds(db: DB, cutoff: string): number[] {
  return db
    .prepare(
      `SELECT id FROM recipes
       WHERE deleted_at IS NOT NULL AND deleted_at <= ?
       ORDER BY deleted_at, id`,
    )
    .pluck()
    .all(cutoff) as number[];
}

/** file_key of every image row of the recipe (at most one by idx_images_recipe). */
export function imageFileKeys(db: DB, recipeId: number): string[] {
  return db.prepare('SELECT file_key FROM images WHERE recipe_id = ?').pluck().all(recipeId) as string[];
}

/**
 * Deletes the recipe row; ON DELETE CASCADE removes ingredients, steps, tag links, ratings,
 * favorites and image rows (Kap. 4.3). Needs PRAGMA foreign_keys = ON (set on every connection).
 * The FTS row is not covered by a foreign key: the caller removes it in the same transaction.
 */
export function deleteRecipeRow(db: DB, recipeId: number): boolean {
  return db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId).changes > 0;
}
