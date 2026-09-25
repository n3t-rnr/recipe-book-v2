import type { DB } from '../types.ts';
import { reserveDeletedImageIds } from './images.ts';

/** An images row reduced to what the cleanup needs (Kap. 4.6). */
export interface ImageKeyRow {
  id: number;
  fileKey: string;
}

/**
 * Deletes every unassigned image (recipe_id IS NULL) created at or before `cutoff` (ISO 8601 UTC,
 * same format as created_at) and returns the deleted rows, whose files the caller moves to
 * images/.trash (F-16: never assigned uploads disappear after 7 days). One statement, so an
 * assignment can never slip in between the check and the delete. The deleted ids stay reserved in
 * meta.image_id_max, so a stale draft never gets a newer upload under the same id: two tables, the
 * caller runs it inside db.transaction().
 */
export function deleteUnassignedImagesBefore(db: DB, cutoff: string): ImageKeyRow[] {
  const rows = db
    .prepare('DELETE FROM images WHERE recipe_id IS NULL AND created_at <= ? RETURNING id, file_key')
    .all(cutoff) as { id: number; file_key: string }[];
  reserveDeletedImageIds(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ id: r.id, fileKey: r.file_key })).sort((a, b) => a.id - b.id);
}

/** All image rows, assigned or not, by id (startup recovery and weekly sweep). */
export function listImageKeys(db: DB): ImageKeyRow[] {
  const rows = db.prepare('SELECT id, file_key FROM images ORDER BY id').all() as {
    id: number;
    file_key: string;
  }[];
  return rows.map((r) => ({ id: r.id, fileKey: r.file_key }));
}

/** True when an images row still references this file key. */
export function hasImageWithKey(db: DB, fileKey: string): boolean {
  return db.prepare('SELECT 1 FROM images WHERE file_key = ?').get(fileKey) !== undefined;
}
