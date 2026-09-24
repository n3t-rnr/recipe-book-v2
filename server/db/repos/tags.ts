import type BetterSqlite3 from 'better-sqlite3';
import { normalize } from '../../../shared/normalize.ts';
import type { DB } from '../types.ts';

/**
 * Tag helpers for recipe writes (F-17, Kap. 7.4): upsert by name_key and link to a recipe.
 * The tag API itself (list, rename, merge, delete) follows in M4.
 * None of these functions opens a transaction: the recipe write that calls them owns it (NF-19).
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
