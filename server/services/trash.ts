import type { TrashItem } from '../../shared/types.ts';
import { removeFromIndex } from '../db/fts.ts';
import { bumpDataRevision } from '../db/repos/meta.ts';
import { reserveUsedRecipeIds } from '../db/repos/recipes.ts';
import {
  deleteRecipeRow,
  expiredTrashIds,
  getDeletedAt,
  imageFileKeys,
  listTrash,
} from '../db/repos/trash.ts';
import type { DB } from '../db/types.ts';
import { AppError } from '../errors.ts';
import type { AppDeps } from '../types.ts';
import { moveImageFilesToTrash } from './image-files.ts';

/** What the trash functions need; the maintenance timer (services/maintenance.ts) passes the app's AppDeps. */
export type TrashDeps = Pick<AppDeps, 'db' | 'paths' | 'log' | 'now'> & {
  config: Pick<AppDeps['config'], 'trashDays'>;
};

const DAY_MS = 86_400_000;

/** Date of the automatic purge: deletedAt + TRASH_DAYS (F-08). */
export function purgeAtFor(deletedAt: string, trashDays: number): string {
  return new Date(Date.parse(deletedAt) + trashDays * DAY_MS).toISOString();
}

/** GET /trash (Kap. 7.4). */
export function getTrash(deps: TrashDeps): TrashItem[] {
  return listTrash(deps.db).map((row) => ({
    ...row,
    purgeAt: purgeAtFor(row.deletedAt, deps.config.trashDays),
  }));
}

/**
 * Removes one recipe for good, inside the caller's transaction: the row (FK cascades to
 * ingredients, steps, tag links, ratings, favorites, images) and its FTS row (Kap. 4.3).
 * The id stays reserved, so no later recipe gets it (old drafts and links answer 404).
 * Returns the image file keys, whose files the caller moves after the commit.
 */
function purgeInTransaction(db: DB, recipeId: number): string[] {
  const fileKeys = imageFileKeys(db, recipeId);
  reserveUsedRecipeIds(db);
  deleteRecipeRow(db, recipeId);
  removeFromIndex(db, recipeId);
  return fileKeys;
}

/**
 * DELETE /trash/:id (F-08): only recipes in the trash can be purged. Afterwards no row of the
 * recipe is left and count(recipes_fts) = count(recipes).
 */
export function purgeRecipe(deps: TrashDeps, recipeId: number): void {
  const fileKeys = deps.db.transaction(() => {
    const state = getDeletedAt(deps.db, recipeId);
    if (!state) throw new AppError('NOT_FOUND', 'Rezept nicht gefunden');
    if (state.deletedAt === null) {
      throw new AppError('NOT_IN_TRASH', 'Nur Rezepte im Papierkorb können endgültig gelöscht werden');
    }
    return purgeInTransaction(deps.db, recipeId);
  })();
  // Files move only after the commit: a rollback must never leave a recipe without its images.
  moveImageFilesToTrash(deps, fileKeys);
  deps.log.info('recipe purged', { recipeId, images: fileKeys.length });
}

/**
 * Purges every recipe that has been in the trash for TRASH_DAYS or longer (F-08; called by the
 * hourly maintenance, services/maintenance.ts). One transaction for all rows; returns the number
 * of purged recipes.
 */
export function purgeExpired(deps: TrashDeps, now: Date = deps.now()): number {
  const cutoff = new Date(now.getTime() - deps.config.trashDays * DAY_MS).toISOString();
  const { count, fileKeys } = deps.db.transaction(() => {
    const ids = expiredTrashIds(deps.db, cutoff);
    const keys: string[] = [];
    for (const id of ids) keys.push(...purgeInTransaction(deps.db, id));
    // No request middleware runs for the timer, so open clients learn about it here (F-36).
    if (ids.length > 0) bumpDataRevision(deps.db);
    return { count: ids.length, fileKeys: keys };
  })();
  moveImageFilesToTrash(deps, fileKeys);
  if (count > 0) deps.log.info('trash purged', { recipes: count, images: fileKeys.length, cutoff });
  return count;
}
