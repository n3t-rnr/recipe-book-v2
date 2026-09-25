import type BetterSqlite3 from 'better-sqlite3';
import type { DB } from '../types.ts';

/**
 * Source texts of the „Meintest du“ word list (F-23, Kap. 4.5 point 7): titles of active recipes,
 * names of tags used by an active recipe and ingredient names of active recipes. Trash and unused
 * tags stay out, so a suggested word always has hits. One statement (NF-04 budget).
 */
const WORD_TEXTS_SQL = `
  SELECT title FROM recipes WHERE deleted_at IS NULL
  UNION ALL
  SELECT t.name FROM tags t
  WHERE EXISTS (SELECT 1 FROM recipe_tags rt JOIN recipes r ON r.id = rt.recipe_id
                WHERE rt.tag_id = t.id AND r.deleted_at IS NULL)
  UNION ALL
  SELECT DISTINCT name FROM ingredients
  WHERE recipe_id IN (SELECT id FROM recipes WHERE deleted_at IS NULL)`;

const cache = new WeakMap<DB, BetterSqlite3.Statement<unknown[]>>();

export function searchWordTexts(db: DB): string[] {
  let stmt = cache.get(db);
  if (!stmt) {
    stmt = db.prepare(WORD_TEXTS_SQL).pluck();
    cache.set(db, stmt);
  }
  return stmt.all() as string[];
}
