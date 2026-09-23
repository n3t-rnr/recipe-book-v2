import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureFtsConsistent,
  ftsRowFor,
  reindexAll,
  reindexRecipe,
  removeFromIndex,
} from '../../server/db/fts.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../server/db/migrate.ts';
import type { DB } from '../../server/db/types.ts';
import { createMemoryLogger } from '../../server/log.ts';
import { normalize } from '../../shared/normalize.ts';
import { createTestDb } from '../helpers/db.ts';

interface RecipeFixture {
  title: string;
  description?: string;
  ingredients?: { name: string; group?: string }[];
  tags?: string[];
  steps?: string[];
}

// Plain SQL on purpose: the recipe repositories do not exist yet (M0).
function insertRecipe(db: DB, recipe: RecipeFixture): number {
  const id = Number(
    db
      .prepare('INSERT INTO recipes(title, title_key, description) VALUES (?, ?, ?)')
      .run(recipe.title, normalize(recipe.title), recipe.description ?? '').lastInsertRowid,
  );
  const ingredient = db.prepare(
    'INSERT INTO ingredients(recipe_id, position, group_name, name, name_key) VALUES (?, ?, ?, ?, ?)',
  );
  (recipe.ingredients ?? []).forEach((ing, i) => {
    ingredient.run(id, i, ing.group ?? '', ing.name, normalize(ing.name));
  });
  const step = db.prepare('INSERT INTO steps(recipe_id, position, text) VALUES (?, ?, ?)');
  (recipe.steps ?? []).forEach((text, i) => {
    step.run(id, i, text);
  });
  for (const name of recipe.tags ?? []) {
    const key = normalize(name);
    db.prepare('INSERT OR IGNORE INTO tags(name, name_key) VALUES (?, ?)').run(name, key);
    db.prepare('INSERT INTO recipe_tags(recipe_id, tag_id) SELECT ?, id FROM tags WHERE name_key = ?').run(
      id,
      key,
    );
  }
  return id;
}

function match(db: DB, query: string): number[] {
  return db
    .prepare('SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH ? ORDER BY rowid')
    .pluck()
    .all(query) as number[];
}

function ftsCount(db: DB): number {
  return db.prepare('SELECT count(*) FROM recipes_fts').pluck().get() as number;
}

const KAESESPAETZLE: RecipeFixture = {
  title: 'Käsespätzle',
  description: 'Mit Röstzwiebeln',
  ingredients: [
    { name: 'Mehl', group: 'Für den Teig' },
    { name: 'Eier', group: 'Für den Teig' },
    { name: 'Bergkäse' },
  ],
  tags: ['Vegetarisch'],
  steps: ['Teig schlagen.', 'Käse reiben.'],
};

let db: DB;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  if (db.open) db.close();
});

describe('ftsRowFor', () => {
  it('builds normalized column values from recipe, tags, ingredients and steps', () => {
    const id = insertRecipe(db, KAESESPAETZLE);
    expect(ftsRowFor(db, id)).toEqual({
      title: 'kasespatzle',
      tags: 'vegetarisch',
      ingredients: 'fur den teig mehl eier bergkase',
      body: 'mit rostzwiebeln teig schlagen. kase reiben.',
    });
  });

  it('returns empty columns for a bare recipe and null for an unknown id', () => {
    const id = insertRecipe(db, { title: 'Wasser' });
    expect(ftsRowFor(db, id)).toEqual({ title: 'wasser', tags: '', ingredients: '', body: '' });
    expect(ftsRowFor(db, 999)).toBeNull();
  });
});

describe('reindexRecipe / removeFromIndex', () => {
  it('makes a recipe findable by title, ingredient and tag prefix', () => {
    const id = insertRecipe(db, KAESESPAETZLE);
    insertRecipe(db, { title: 'Tomatensuppe', ingredients: [{ name: 'Tomaten' }] });

    db.transaction(() => reindexRecipe(db, id))();

    expect(ftsCount(db)).toBe(1);
    expect(match(db, '"kase"*')).toEqual([id]);
    expect(match(db, '"berg"*')).toEqual([id]);
    expect(match(db, '"vegetar"*')).toEqual([id]);
    expect(match(db, '"tomat"*')).toEqual([]);
  });

  it('replaces the old row when the recipe changes', () => {
    const id = insertRecipe(db, KAESESPAETZLE);
    reindexRecipe(db, id);

    db.prepare('UPDATE recipes SET title = ?, title_key = ? WHERE id = ?').run(
      'Nudelauflauf',
      normalize('Nudelauflauf'),
      id,
    );
    reindexRecipe(db, id);

    expect(ftsCount(db)).toBe(1);
    expect(match(db, '"spatz"*')).toEqual([]);
    expect(match(db, '"nudel"*')).toEqual([id]);
  });

  it('keeps trashed recipes in the index', () => {
    const id = insertRecipe(db, KAESESPAETZLE);
    db.prepare("UPDATE recipes SET deleted_at = '2026-09-23T10:00:00.000Z' WHERE id = ?").run(id);
    reindexRecipe(db, id);
    expect(match(db, '"kase"*')).toEqual([id]);
  });

  it('removes a recipe from the index', () => {
    const id = insertRecipe(db, KAESESPAETZLE);
    reindexRecipe(db, id);

    removeFromIndex(db, id);

    expect(ftsCount(db)).toBe(0);
    expect(match(db, '"kase"*')).toEqual([]);
  });

  it('only removes the row when the recipe no longer exists', () => {
    const id = insertRecipe(db, KAESESPAETZLE);
    reindexRecipe(db, id);
    db.prepare('DELETE FROM recipes WHERE id = ?').run(id);

    reindexRecipe(db, id);

    expect(ftsCount(db)).toBe(0);
  });
});

describe('reindexAll', () => {
  it('indexes every recipe and drops stale rows', () => {
    const ids = [
      insertRecipe(db, KAESESPAETZLE),
      insertRecipe(db, { title: 'Tomatensuppe', ingredients: [{ name: 'Tomaten' }] }),
      insertRecipe(db, { title: 'Apfelkuchen', tags: ['Backen'] }),
    ];
    db.prepare(
      "INSERT INTO recipes_fts(rowid, title, tags, ingredients, body) VALUES (999, 'geist', '', '', '')",
    ).run();

    expect(reindexAll(db)).toBe(3);

    expect(ftsCount(db)).toBe(3);
    expect(match(db, '"geist"*')).toEqual([]);
    expect(match(db, '"tomat"*')).toEqual([ids[1]]);
    expect(match(db, '"back"*')).toEqual([ids[2]]);
  });
});

describe('ensureFtsConsistent', () => {
  it('rebuilds the index when a recipe is missing from it', () => {
    const first = insertRecipe(db, KAESESPAETZLE);
    reindexRecipe(db, first);
    const missing = insertRecipe(db, { title: 'Linsensuppe' });
    const log = createMemoryLogger();

    expect(ensureFtsConsistent(db, log)).toBe(true);

    expect(ftsCount(db)).toBe(2);
    expect(match(db, '"linse"*')).toEqual([missing]);
    expect(log.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'fts index inconsistent, rebuilding',
        ftsRows: 1,
        recipes: 2,
      }),
    );
    expect(ensureFtsConsistent(db, log)).toBe(false);
  });

  it('does nothing on a consistent index', () => {
    reindexRecipe(db, insertRecipe(db, KAESESPAETZLE));
    const log = createMemoryLogger();
    expect(ensureFtsConsistent(db, log)).toBe(false);
    expect(log.entries).toEqual([]);
  });

  it('leaves a read-only database alone', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-fts-'));
    const file = path.join(dir, 'rezepte.sqlite');
    try {
      const rw = new Database(file);
      runMigrations(rw, {
        migrationsDir: MIGRATIONS_DIR,
        backupsDir: path.join(dir, 'backups'),
        log: createMemoryLogger(),
      });
      const id = insertRecipe(rw, KAESESPAETZLE);
      rw.close();

      const ro = new Database(file, { readonly: true, fileMustExist: true });
      try {
        const log = createMemoryLogger();
        expect(ensureFtsConsistent(ro, log)).toBe(false);
        expect(log.entries).toEqual([]);
        // Reading the index values still works on a read-only connection.
        expect(ftsRowFor(ro, id)?.title).toBe('kasespatzle');
      } finally {
        ro.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
