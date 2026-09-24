import fs from 'node:fs';
import path from 'node:path';
import type { ValidationDetail } from '../../shared/error-codes.ts';
import type { RecipeCreateInput, RecipeFields, RecipeUpdateInput } from '../../shared/schemas.ts';
import type { DetailImage, InTrashDetails, PersonRef, RecipeDetail } from '../../shared/types.ts';
import { reindexRecipe } from '../db/fts.ts';
import {
  assignImage,
  detachRecipeImages,
  findImage,
  findRecipe,
  findRecipeIdByCreateKey,
  findRecipeImage,
  insertRecipe,
  isFavorite,
  listIngredients,
  listRatings,
  listRecipeTags,
  listSteps,
  type RecipeColumns,
  type RecipeRow,
  replaceIngredients,
  replaceSteps,
  restoreRecipeRow,
  trashRecipeRow,
  updateRecipeRow,
} from '../db/repos/recipes.ts';
import { setRecipeTags, upsertTags } from '../db/repos/tags.ts';
import type { DB } from '../db/types.ts';
import { AppError } from '../errors.ts';
import type { AppDeps } from '../types.ts';

/**
 * Recipe core (F-06 to F-08, F-10, F-11, F-17, F-29, NF-09, NF-19): every write is one
 * transaction including tags and the FTS row; image files move to images/.trash only after
 * the commit (F-16, Kap. 4.6).
 */
export type RecipeDeps = Pick<AppDeps, 'db' | 'paths' | 'log' | 'now'>;

const IMAGE_VARIANTS = ['s', 'm', 'l'] as const;
const FILE_KEY = /^[0-9a-f]{16}$/;

/** Public URL of one image variant (Kap. 7.5, served by /media in M3). */
export function mediaUrl(fileKey: string, variant: 's' | 'm' | 'l'): string {
  return `/media/${fileKey}-${variant}.webp`;
}

/** prep + cook; one of them alone if the other is unset; null if both are unset (F-29). */
export function totalMinutes(prep: number | null, cook: number | null): number | null {
  if (prep === null && cook === null) return null;
  return (prep ?? 0) + (cook ?? 0);
}

/** Average stars rounded to one decimal, null without ratings. */
export function roundedAverage(stars: readonly number[]): number | null {
  if (stars.length === 0) return null;
  const sum = stars.reduce((a, b) => a + b, 0);
  return Math.round((sum / stars.length) * 10) / 10;
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Rezept nicht gefunden');
}

function inTrash(row: RecipeRow): AppError {
  const details: InTrashDetails = { deletedAt: row.deletedAt ?? '', deletedBy: row.deletedBy };
  return new AppError('IN_TRASH', 'Rezept liegt im Papierkorb', details);
}

function imageNotFound(): AppError {
  const details: ValidationDetail[] = [{ field: 'imageId', message: 'Bild nicht gefunden' }];
  return new AppError('VALIDATION', 'Eingaben prüfen', details);
}

function columnsOf(input: RecipeFields): RecipeColumns {
  return {
    title: input.title,
    description: input.description,
    servings: input.servings,
    servingsUnit: input.servingsUnit,
    prepMinutes: input.prepMinutes,
    cookMinutes: input.cookMinutes,
    source: input.source,
  };
}

/** Ingredients, steps and tags are replaced as a whole on create and update (Kap. 7.4). */
function writeChildren(db: DB, recipeId: number, input: RecipeFields): void {
  replaceIngredients(db, recipeId, input.ingredients);
  replaceSteps(
    db,
    recipeId,
    input.steps.map((step) => step.text),
  );
  setRecipeTags(db, recipeId, upsertTags(db, input.tags));
}

/** Builds the API detail of an existing recipe (trashed or not); viewer = acting profile or null. */
export function buildRecipeDetail(db: DB, row: RecipeRow, viewerId: number | null): RecipeDetail {
  const image = findRecipeImage(db, row.id);
  const detailImage: DetailImage | null = image
    ? {
        id: image.id,
        urls: {
          s: mediaUrl(image.fileKey, 's'),
          m: mediaUrl(image.fileKey, 'm'),
          l: mediaUrl(image.fileKey, 'l'),
        },
        width: image.width,
        height: image.height,
      }
    : null;
  const ratings = listRatings(db, row.id);
  const mine = viewerId === null ? null : (ratings.find((r) => r.profileId === viewerId)?.stars ?? null);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    servings: row.servings,
    servingsUnit: row.servingsUnit,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    totalMinutes: totalMinutes(row.prepMinutes, row.cookMinutes),
    source: row.source,
    ingredients: listIngredients(db, row.id),
    steps: listSteps(db, row.id),
    tags: listRecipeTags(db, row.id),
    image: detailImage,
    rating: {
      avg: roundedAverage(ratings.map((r) => r.stars)),
      count: ratings.length,
      mine,
      byProfile: ratings.map((r) => ({ profileId: r.profileId, name: r.name, stars: r.stars })),
    },
    isFavorite: viewerId === null ? null : isFavorite(db, row.id, viewerId),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function detailById(db: DB, id: number, viewerId: number | null): RecipeDetail {
  const row = findRecipe(db, id);
  if (!row) throw notFound();
  return buildRecipeDetail(db, row, viewerId);
}

/** GET /recipes/:id: 404 if unknown, 410 IN_TRASH if trashed (F-33). */
export function getRecipe(deps: RecipeDeps, id: number, viewer: PersonRef | null): RecipeDetail {
  const row = findRecipe(deps.db, id);
  if (!row) throw notFound();
  if (row.deletedAt !== null) throw inTrash(row);
  return buildRecipeDetail(deps.db, row, viewer?.id ?? null);
}

export interface CreateResult {
  recipe: RecipeDetail;
  /** false when the createKey was already used: the existing recipe is returned (NF-09). */
  created: boolean;
}

/** POST /recipes (F-06, NF-09): one transaction for recipe, children, tags, image and FTS row. */
export function createRecipe(deps: RecipeDeps, input: RecipeCreateInput, profile: PersonRef): CreateResult {
  const { db } = deps;
  const now = deps.now().toISOString();
  const outcome = db.transaction(() => {
    // A repeated submit returns the first recipe, even though its image is assigned by now.
    const existing = findRecipeIdByCreateKey(db, input.createKey);
    if (existing !== null) return { id: existing, created: false };

    if (input.imageId !== null) {
      const image = findImage(db, input.imageId);
      if (!image || image.recipeId !== null) throw imageNotFound();
    }
    const id = insertRecipe(db, {
      ...columnsOf(input),
      createKey: input.createKey,
      profileId: profile.id,
      now,
    });
    writeChildren(db, id, input);
    if (input.imageId !== null) assignImage(db, input.imageId, id);
    reindexRecipe(db, id);
    return { id, created: true };
  })();
  return { recipe: detailById(db, outcome.id, profile.id), created: outcome.created };
}

export interface UpdateOptions {
  /** ?force=1: overwrite despite a stale version (F-07). */
  force: boolean;
}

/**
 * PUT /recipes/:id (F-07): full replacement guarded by the version. The server sets the new
 * version (old + 1), also when forced. A replaced or removed image loses its row inside the
 * transaction; its files move to images/.trash after the commit.
 */
export function updateRecipe(
  deps: RecipeDeps,
  id: number,
  input: RecipeUpdateInput,
  profile: PersonRef,
  options: UpdateOptions,
): RecipeDetail {
  const { db } = deps;
  const now = deps.now().toISOString();
  const removedFileKeys = db.transaction(() => {
    const row = findRecipe(db, id);
    if (!row) throw notFound();
    if (row.deletedAt !== null) throw inTrash(row);
    if (!options.force && input.version !== row.version) {
      const by = row.updatedBy?.name ?? 'einem anderen Gerät';
      const current = buildRecipeDetail(db, row, profile.id);
      throw new AppError('VERSION_CONFLICT', `Inzwischen von ${by} geändert`, { current });
    }

    if (input.imageId !== null) {
      const image = findImage(db, input.imageId);
      if (!image || (image.recipeId !== null && image.recipeId !== id)) throw imageNotFound();
    }
    // Remove the old row first: the partial UNIQUE index allows one image per recipe.
    const removed = detachRecipeImages(db, id, input.imageId);
    if (input.imageId !== null) assignImage(db, input.imageId, id);

    updateRecipeRow(db, id, { ...columnsOf(input), profileId: profile.id, now, version: row.version + 1 });
    writeChildren(db, id, input);
    reindexRecipe(db, id);
    return removed;
  })();
  moveImageFilesToTrash(deps, removedFileKeys);
  return detailById(db, id, profile.id);
}

/** DELETE /recipes/:id (F-08): into the trash, deleted_by = acting profile. */
export function trashRecipe(deps: RecipeDeps, id: number, profile: PersonRef): void {
  const { db } = deps;
  const now = deps.now().toISOString();
  db.transaction(() => {
    const row = findRecipe(db, id);
    if (!row) throw notFound();
    if (row.deletedAt !== null) throw inTrash(row);
    trashRecipeRow(db, id, profile.id, now);
  })();
}

/** POST /recipes/:id/restore (F-08): idempotent; ingredients, tags, image, ratings and favorites were kept. */
export function restoreRecipe(deps: RecipeDeps, id: number, profile: PersonRef): RecipeDetail {
  const { db } = deps;
  const row = db.transaction(() => {
    const found = findRecipe(db, id);
    if (!found) throw notFound();
    if (found.deletedAt === null) return found;
    restoreRecipeRow(db, id);
    return findRecipe(db, id) ?? found;
  })();
  return buildRecipeDetail(db, row, profile.id);
}

/**
 * Moves the variant files of unreferenced images to images/.trash (F-16). Runs after the commit;
 * missing files are skipped, other failures only logged: the DB change already happened and the
 * weekly cleanup moves leftovers. The mtime is set to now so the 14-day retention starts here.
 * Returns the number of moved files.
 */
export function moveImageFilesToTrash(
  deps: Pick<AppDeps, 'paths' | 'log' | 'now'>,
  fileKeys: readonly string[],
): number {
  if (fileKeys.length === 0) return 0;
  const { paths, log } = deps;
  const now = deps.now();
  let moved = 0;
  try {
    fs.mkdirSync(paths.imagesTrash, { recursive: true });
  } catch (err) {
    log.warn('image trash folder not writable', { dir: paths.imagesTrash, err });
    return 0;
  }
  for (const key of fileKeys) {
    if (!FILE_KEY.test(key)) {
      log.warn('image file key skipped', { fileKey: key });
      continue;
    }
    for (const variant of IMAGE_VARIANTS) {
      const file = `${key}-${variant}.webp`;
      const target = path.join(paths.imagesTrash, file);
      try {
        fs.renameSync(path.join(paths.images, file), target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
          log.warn('image file move failed', { file, err });
        continue;
      }
      moved++;
      try {
        fs.utimesSync(target, now, now);
      } catch {
        // The retention then counts from the upload time, which only shortens it.
      }
    }
  }
  if (moved > 0) log.info('image files moved to trash', { files: moved });
  return moved;
}
