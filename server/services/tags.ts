import type { ValidationDetail } from '../../shared/error-codes.ts';
import { normalize } from '../../shared/normalize.ts';
import type { TagInput } from '../../shared/schemas.ts';
import type {
  TagCount,
  TagExistsDetails,
  TagMergeResponse,
  TagResponse,
  TagsResponse,
} from '../../shared/types.ts';
import { bumpDataRevision, getDataRevision, getMeta, setMeta } from '../db/repos/meta.ts';
import { bumpRecipeVersions } from '../db/repos/recipes.ts';
import {
  countActiveRecipes,
  countTags,
  deleteTagRow,
  findTag,
  findTagByKey,
  insertTag,
  linkRecipesToTag,
  listTagsWithCounts,
  recipeIdsForTag,
  reindexRecipes,
  renameTagRow,
  tagWithCount,
  upsertTags,
} from '../db/repos/tags.ts';
import type { DB } from '../db/types.ts';
import { AppError } from '../errors.ts';

/**
 * Tag management (F-17, F-19, F-20, Kap. 7.6). Rename, merge and delete run in one transaction each:
 * the links, the version of every linked recipe (trashed ones too) and their FTS rows change together
 * (NF-19). The revision middleware bumps data_revision after the response.
 */

/**
 * Start tags of a new installation (F-20, A10). Server-only on purpose: the list must not reach the
 * client bundle.
 */
export const START_TAGS = [
  'Vegetarisch',
  'Vegan',
  'Schnell',
  'Hauptgericht',
  'Beilage',
  'Suppe',
  'Salat',
  'Dessert',
  'Backen',
  'Frühstück',
] as const;

/** meta key: initial data is present (start tags or `pnpm seed`); start tags never come back after it. */
const SEEDED = 'seeded';

function notFound(message = 'Tag nicht gefunden'): AppError {
  return new AppError('NOT_FOUND', message);
}

function invalid(field: string, message: string): AppError {
  const details: ValidationDetail[] = [{ field, message }];
  return new AppError('VALIDATION', 'Eingaben prüfen', details);
}

/**
 * The name_key of a name that passed TagInput. A name of only combining marks passes the schema but
 * has an empty key, which would make it indistinguishable from other such names (Kap. 4.4).
 */
function keyOf(name: string): string {
  const key = normalize(name);
  if (key === '') throw invalid('name', 'Der Name braucht mindestens einen Buchstaben oder eine Ziffer');
  return key;
}

/** Reads the tag back with its count; the tag exists because the caller's transaction just checked it. */
function withCount(db: DB, id: number): TagCount {
  const tag = tagWithCount(db, id);
  if (!tag) throw notFound();
  return tag;
}

/**
 * A fresh FTS row and version +1 for each recipe whose tags changed (F-19, Kap. 4.3). The rows are rebuilt
 * in one batch: a tag can be on every recipe, and NF-04 AK3 allows 100 ms per request.
 * The index is written before the versions on purpose: the forced failure at a version bump in
 * tests/api/tags.test.ts then also proves that the rewritten FTS rows roll back with the links (NF-19).
 */
function touchRecipes(db: DB, recipeIds: readonly number[]): void {
  reindexRecipes(db, recipeIds);
  bumpRecipeVersions(db, recipeIds);
}

/** GET /tags: all tags with the number of active recipes, and the data revision (Kap. 7.6). */
export function listTags(db: DB): TagsResponse {
  return { tags: listTagsWithCounts(db), revision: getDataRevision(db) };
}

export interface CreateTagResult extends TagResponse {
  /** false when a tag with the same name_key already existed; it is returned unchanged (F-17 AK2). */
  created: boolean;
}

/** POST /tags: creates the tag, or returns the existing one with the same key and its display name. */
export function createTag(db: DB, input: TagInput): CreateTagResult {
  const name = input.name;
  const key = keyOf(name);
  return db.transaction((): CreateTagResult => {
    const existing = findTagByKey(db, key);
    if (existing) return { tag: withCount(db, existing.id), created: false };
    return { tag: { id: insertTag(db, name, key), name, count: 0 }, created: true };
  })();
}

/**
 * PATCH /tags/:id. A name whose key belongs to another tag → 409 TAG_EXISTS with what the merge
 * confirmation needs (F-19 AK1). Another spelling of the tag's own key only changes the display name;
 * the unchanged name writes nothing.
 */
export function renameTag(db: DB, id: number, input: TagInput): TagCount {
  const name = input.name;
  const key = keyOf(name);
  return db.transaction((): TagCount => {
    const tag = findTag(db, id);
    if (!tag) throw notFound();
    const other = findTagByKey(db, key);
    if (other && other.id !== id) {
      const details: TagExistsDetails = {
        targetId: other.id,
        targetName: other.name,
        affectedRecipes: countActiveRecipes(db, id),
      };
      throw new AppError('TAG_EXISTS', 'Tag existiert bereits', details);
    }
    if (name === tag.name) return withCount(db, id);

    const recipeIds = recipeIdsForTag(db, id);
    renameTagRow(db, id, name, key);
    touchRecipes(db, recipeIds);
    return withCount(db, id);
  })();
}

/**
 * POST /tags/:id/merge (F-19): every recipe of the source tag gets the target tag (at most once),
 * then the source tag is deleted. A recipe cannot exceed 20 tags: its source link goes away.
 */
export function mergeTag(db: DB, id: number, intoTagId: number): TagMergeResponse {
  if (intoTagId === id) {
    throw invalid('intoTagId', 'Ein Tag lässt sich nicht mit sich selbst zusammenführen');
  }
  return db.transaction((): TagMergeResponse => {
    if (!findTag(db, id)) throw notFound();
    if (!findTag(db, intoTagId)) throw notFound('Ziel-Tag nicht gefunden');
    const recipeIds = recipeIdsForTag(db, id);
    const movedRecipes = countActiveRecipes(db, id);
    linkRecipesToTag(db, recipeIds, intoTagId);
    deleteTagRow(db, id);
    touchRecipes(db, recipeIds);
    return { tag: withCount(db, intoTagId), movedRecipes };
  })();
}

/** DELETE /tags/:id (F-19 AK3): only the links go away, the recipes stay. */
export function deleteTag(db: DB, id: number): void {
  db.transaction(() => {
    if (!findTag(db, id)) throw notFound();
    const recipeIds = recipeIdsForTag(db, id);
    deleteTagRow(db, id);
    touchRecipes(db, recipeIds);
  })();
}

/**
 * Server start (F-20): an installation without tags and without meta.seeded gets the start tags.
 * meta.seeded is set either way, so tags deleted later never come back after a restart (F-20 AK2),
 * and an existing database with its own tags gets none. `pnpm seed` sets meta.seeded too.
 * Returns the number of created tags; a read-only (corrupt) database is left alone.
 */
export function ensureStartTags(db: DB, now: Date): number {
  if (db.readonly) return 0;
  return db.transaction((): number => {
    if (getMeta(db, SEEDED) !== null) return 0;
    // The table is empty, so every id upsertTags returns belongs to a tag it just inserted.
    const created = countTags(db) === 0 ? upsertTags(db, START_TAGS).length : 0;
    setMeta(db, SEEDED, now.toISOString());
    // No request middleware runs at start, so open clients learn about the new tags here (F-36).
    if (created > 0) bumpDataRevision(db);
    return created;
  })();
}
