import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { reindexRecipe } from '../../server/db/fts.ts';
import type { DB } from '../../server/db/types.ts';
import { normalize } from '../../shared/normalize.ts';
import { MIGRATIONS_DIR } from './db.ts';

/**
 * Test data in plain SQL: the tests of lists, search and tags must not depend on the write API they
 * check. Keys go through normalize like in the app (Kap. 4.4), and every recipe is indexed with
 * reindexRecipe, trashed ones too, because the FTS index keeps them until the purge.
 */
export interface RecipeFixture {
  title: string;
  description?: string | undefined;
  /** A plain string is an ingredient without group. */
  ingredients?: ReadonlyArray<string | { name: string; group?: string | undefined }> | undefined;
  steps?: readonly string[] | undefined;
  /**
   * Trimmed like the app does, then created on first use by name key; a second spelling of the same key
   * reuses the first tag. A name the app would never store (empty key, more than 40 characters) throws.
   */
  tags?: readonly string[] | undefined;
  /** Default 2026-09-01T10:00:00.000Z, so sort tests do not depend on the clock. */
  createdAt?: string | undefined;
  /** Default: createdAt. */
  updatedAt?: string | undefined;
  /** Set: the recipe is in the trash. */
  deletedAt?: string | null | undefined;
  prep?: number | null | undefined;
  cook?: number | null | undefined;
  /** Default 1 (column default). */
  version?: number | undefined;
}

const DEFAULT_CREATED_AT = '2026-09-01T10:00:00.000Z';

type Stmt = Database.Statement<unknown[]>;

interface Statements {
  recipe: Stmt;
  ingredient: Stmt;
  step: Stmt;
  tag: Stmt;
  link: Stmt;
}

// Prepared once per connection: perf tests insert 1,000 recipes.
const cache = new WeakMap<DB, Statements>();

function statements(db: DB): Statements {
  let s = cache.get(db);
  if (!s) {
    s = {
      recipe: db.prepare(
        `INSERT INTO recipes(title, title_key, description, prep_minutes, cook_minutes, version,
                             created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      ingredient: db.prepare(
        'INSERT INTO ingredients(recipe_id, position, group_name, name, name_key) VALUES (?, ?, ?, ?, ?)',
      ),
      step: db.prepare('INSERT INTO steps(recipe_id, position, text) VALUES (?, ?, ?)'),
      // Not INSERT OR IGNORE: that would also swallow the CHECK on the name length and drop the tag.
      tag: db.prepare('INSERT INTO tags(name, name_key) VALUES (?, ?) ON CONFLICT(name_key) DO NOTHING'),
      link: db.prepare(
        'INSERT OR IGNORE INTO recipe_tags(recipe_id, tag_id) SELECT ?, id FROM tags WHERE name_key = ?',
      ),
    };
    cache.set(db, s);
  }
  return s;
}

/** Inserts one recipe with ingredients, steps and tags in one transaction and returns its id. */
export function insertRecipe(db: DB, r: RecipeFixture): number {
  const s = statements(db);
  return db.transaction(() => {
    const createdAt = r.createdAt ?? DEFAULT_CREATED_AT;
    const id = Number(
      s.recipe.run(
        r.title,
        normalize(r.title),
        r.description ?? '',
        r.prep ?? null,
        r.cook ?? null,
        r.version ?? 1,
        createdAt,
        r.updatedAt ?? createdAt,
        r.deletedAt ?? null,
      ).lastInsertRowid,
    );
    (r.ingredients ?? []).forEach((ingredient, position) => {
      const { name, group } = typeof ingredient === 'string' ? { name: ingredient, group: '' } : ingredient;
      s.ingredient.run(id, position, group ?? '', name, normalize(name));
    });
    (r.steps ?? []).forEach((text, position) => {
      s.step.run(id, position, text);
    });
    for (const raw of r.tags ?? []) {
      const name = raw.trim();
      const key = normalize(name);
      if (key === '') throw new Error(`Tag "${raw}" has an empty name key; the app never stores it`);
      s.tag.run(name, key);
      s.link.run(id, key);
    }
    reindexRecipe(db, id);
    return id;
  })();
}

export function insertProfile(db: DB, name: string): number {
  return Number(
    db.prepare('INSERT INTO profiles(name, name_key) VALUES (?, ?)').run(name, normalize(name))
      .lastInsertRowid,
  );
}

/** Id of the tag whose key equals normalize(name); throws when there is none. */
export function tagId(db: DB, name: string): number {
  const id = db.prepare('SELECT id FROM tags WHERE name_key = ?').pluck().get(normalize(name));
  if (typeof id !== 'number') throw new Error(`Tag "${name}" not found`);
  return id;
}

/**
 * In-memory database like createTestDb (foreign keys, all migrations), but every executed statement is
 * recorded in `statements` (NF-04 statement budget). The list starts empty after the migrations.
 */
export function tracedDb(): { db: DB; statements: string[] } {
  const statements: string[] = [];
  const db = new Database(':memory:', { verbose: (sql) => statements.push(String(sql)) });
  db.pragma('foreign_keys = ON');
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  for (const file of files) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  db.pragma(`user_version = ${files.length}`);
  statements.length = 0;
  return { db, statements };
}
