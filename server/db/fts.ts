import type BetterSqlite3 from 'better-sqlite3';
import { normalize } from '../../shared/normalize.ts';
import type { Logger } from '../log.ts';
import type { DB } from './types.ts';

/**
 * Maintenance of the contentless FTS5 index recipes_fts (Kap. 4.3 "Hinweise zur FTS-Pflege").
 * rowid = recipes.id; all column values are normalized (Kap. 4.4) because the index cannot be
 * read back and search terms are normalized the same way.
 */
export interface FtsRow {
  title: string;
  tags: string;
  ingredients: string;
  body: string;
}

type Stmt = BetterSqlite3.Statement<unknown[]>;

interface FtsStatements {
  recipe: Stmt;
  tagNames: Stmt;
  ingredients: Stmt;
  stepTexts: Stmt;
  allIds: Stmt;
  remove: Stmt;
  insert: Stmt;
  deleteAll: Stmt;
  counts: Stmt;
}

// Prepared once per connection: reindexAll runs these per recipe, request handlers per save.
const cache = new WeakMap<DB, FtsStatements>();

function statements(db: DB): FtsStatements {
  let s = cache.get(db);
  if (!s) {
    s = {
      recipe: db.prepare('SELECT title, description FROM recipes WHERE id = ?'),
      tagNames: db
        .prepare(
          `SELECT t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
           WHERE rt.recipe_id = ? ORDER BY t.name_key`,
        )
        .pluck(),
      ingredients: db.prepare(
        'SELECT group_name, name FROM ingredients WHERE recipe_id = ? ORDER BY position, id',
      ),
      stepTexts: db.prepare('SELECT text FROM steps WHERE recipe_id = ? ORDER BY position, id').pluck(),
      allIds: db.prepare('SELECT id FROM recipes ORDER BY id').pluck(),
      remove: db.prepare('DELETE FROM recipes_fts WHERE rowid = ?'),
      insert: db.prepare(
        `INSERT INTO recipes_fts(rowid, title, tags, ingredients, body)
         VALUES (@id, @title, @tags, @ingredients, @body)`,
      ),
      // 'rebuild' does not exist for contentless tables; 'delete-all' empties the index.
      deleteAll: db.prepare("INSERT INTO recipes_fts(recipes_fts) VALUES('delete-all')"),
      counts: db.prepare(
        'SELECT (SELECT count(*) FROM recipes_fts) AS fts, (SELECT count(*) FROM recipes) AS recipes',
      ),
    };
    cache.set(db, s);
  }
  return s;
}

/**
 * Index values for one recipe, or null if it does not exist. Trashed recipes are included:
 * they stay in the index and the search filters on recipes.deleted_at.
 */
export function ftsRowFor(db: DB, recipeId: number): FtsRow | null {
  const s = statements(db);
  const recipe = s.recipe.get(recipeId) as { title: string; description: string } | undefined;
  if (!recipe) return null;

  const tags = s.tagNames.all(recipeId) as string[];
  const ingredientRows = s.ingredients.all(recipeId) as { group_name: string; name: string }[];
  const steps = s.stepTexts.all(recipeId) as string[];

  // Group names ("Für den Teig") are searchable too, but only once per group.
  const ingredientWords: string[] = [];
  const groups = new Set<string>();
  for (const row of ingredientRows) {
    if (row.group_name && !groups.has(row.group_name)) {
      groups.add(row.group_name);
      ingredientWords.push(row.group_name);
    }
    ingredientWords.push(row.name);
  }

  return {
    title: normalize(recipe.title),
    tags: normalize(tags.join(' ')),
    ingredients: normalize(ingredientWords.join(' ')),
    body: normalize([recipe.description, ...steps].join(' ')),
  };
}

/**
 * Replaces the index row of one recipe (or only removes it if the recipe is gone).
 * Does not open a transaction: the caller runs it inside the transaction that changed the
 * recipe, so recipe and index are committed together (NF-19).
 */
export function reindexRecipe(db: DB, recipeId: number): void {
  const s = statements(db);
  s.remove.run(recipeId);
  const row = ftsRowFor(db, recipeId);
  if (row) s.insert.run({ id: recipeId, ...row });
}

/** Removes a purged recipe from the index. Caller owns the transaction, as for reindexRecipe. */
export function removeFromIndex(db: DB, recipeId: number): void {
  statements(db).remove.run(recipeId);
}

/** Rebuilds the whole index in one transaction and returns the number of indexed recipes. */
export function reindexAll(db: DB): number {
  const s = statements(db);
  return db.transaction(() => {
    s.deleteAll.run();
    const ids = s.allIds.all() as number[];
    let count = 0;
    for (const id of ids) {
      const row = ftsRowFor(db, id);
      if (!row) continue;
      s.insert.run({ id, ...row });
      count++;
    }
    return count;
  })();
}

/**
 * Start check (Kap. 4.3): a differing row count means an index write was lost, so the index
 * is rebuilt. Returns true if it was rebuilt. A read-only (corrupt) database is left alone.
 */
export function ensureFtsConsistent(db: DB, log: Logger): boolean {
  if (db.readonly) return false;
  const counts = statements(db).counts.get() as { fts: number; recipes: number };
  if (counts.fts === counts.recipes) return false;
  log.warn('fts index inconsistent, rebuilding', { ftsRows: counts.fts, recipes: counts.recipes });
  const indexed = reindexAll(db);
  log.info('fts index rebuilt', { recipes: indexed });
  return true;
}
