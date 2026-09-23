import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { DB } from '../../server/db/types.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../server/db/migrations/', import.meta.url));

/**
 * In-memory database with foreign keys and all migrations applied.
 * Deliberately independent of server/db/migrate.ts so API tests do not depend on the runner.
 */
export function createTestDb(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  for (const file of files) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  db.pragma(`user_version = ${files.length}`);
  return db;
}
