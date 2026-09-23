import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listMigrations, MIGRATIONS_DIR, MigrationError, runMigrations } from '../../server/db/migrate.ts';
import type { DB } from '../../server/db/types.ts';
import { createMemoryLogger } from '../../server/log.ts';

const SCHEMA_TABLES = [
  'profiles',
  'recipes',
  'ingredients',
  'steps',
  'tags',
  'recipe_tags',
  'images',
  'ratings',
  'favorites',
  'meta',
  'recipes_fts',
];

const NOTES_SQL = 'CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL);\n';
const BROKEN_SQL =
  'CREATE TABLE broken_marker (id INTEGER PRIMARY KEY);\nINSERT INTO missing_table VALUES (1);\n';

let dir: string;
let dbFile: string;
let backupsDir: string;
let migrationsDir: string;
const openDbs: DB[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-migrate-'));
  dbFile = path.join(dir, 'rezepte.sqlite');
  backupsDir = path.join(dir, 'backups');
  migrationsDir = path.join(dir, 'migrations');
  fs.mkdirSync(migrationsDir);
  fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(migrationsDir, '001_init.sql'));
});

afterEach(() => {
  // Windows cannot delete open database files.
  for (const db of openDbs.splice(0)) if (db.open) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function openFile(file = dbFile, options: Database.Options = {}): DB {
  const db = new Database(file, options);
  openDbs.push(db);
  return db;
}

function addMigration(name: string, sql: string): void {
  fs.writeFileSync(path.join(migrationsDir, name), sql);
}

function userVersion(db: DB): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function tables(db: DB): string[] {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").pluck().all() as string[];
}

function backups(): string[] {
  return fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).sort() : [];
}

/** Database at version 1 with one profile, as left behind by the previous app version. */
function createVersion1Db(): DB {
  const db = openFile();
  db.pragma('journal_mode = WAL');
  runMigrations(db, { migrationsDir, backupsDir, log: createMemoryLogger() });
  db.prepare("INSERT INTO profiles(name, name_key) VALUES ('Anna', 'anna')").run();
  return db;
}

describe('runMigrations', () => {
  it('applies all migrations to a fresh database without a backup', () => {
    const latest = listMigrations(MIGRATIONS_DIR).length;
    const log = createMemoryLogger();
    const db = openFile();

    const result = runMigrations(db, { migrationsDir: MIGRATIONS_DIR, backupsDir, log });

    expect(latest).toBeGreaterThanOrEqual(1);
    expect(result).toEqual({
      from: 0,
      to: latest,
      applied: Array.from({ length: latest }, (_, i) => i + 1),
      backupFile: null,
    });
    expect(userVersion(db)).toBe(latest);
    expect(tables(db)).toEqual(expect.arrayContaining(SCHEMA_TABLES));
    expect(db.prepare("SELECT value FROM meta WHERE key = 'data_revision'").pluck().get()).toBe('0');
    expect(backups()).toEqual([]);
    expect(log.entries).toContainEqual(
      expect.objectContaining({ level: 'info', msg: 'migration applied', version: 1, file: '001_init.sql' }),
    );
  });

  it('runs nothing and writes no backup on the second start', () => {
    const db = openFile();
    runMigrations(db, { migrationsDir: MIGRATIONS_DIR, backupsDir, log: createMemoryLogger() });
    const version = userVersion(db);

    const result = runMigrations(db, {
      migrationsDir: MIGRATIONS_DIR,
      backupsDir,
      log: createMemoryLogger(),
    });

    expect(result).toEqual({ from: version, to: version, applied: [], backupFile: null });
    expect(backups()).toEqual([]);
  });

  it('backs up an existing database before upgrading it', () => {
    const db = createVersion1Db();
    addMigration('002_notes.sql', NOTES_SQL);
    // A stale file from an earlier attempt must be replaced, not block VACUUM INTO.
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(path.join(backupsDir, 'pre-migration-002.sqlite'), 'alt');

    const result = runMigrations(db, { migrationsDir, backupsDir, log: createMemoryLogger() });

    const backupFile = path.join(backupsDir, 'pre-migration-002.sqlite');
    expect(result).toEqual({ from: 1, to: 2, applied: [2], backupFile });
    expect(userVersion(db)).toBe(2);
    expect(tables(db)).toContain('notes');

    const backup = openFile(backupFile, { readonly: true, fileMustExist: true });
    expect(backup.pragma('quick_check', { simple: true })).toBe('ok');
    expect(userVersion(backup)).toBe(1);
    expect(tables(backup)).not.toContain('notes');
    expect(backup.prepare('SELECT name FROM profiles').pluck().all()).toEqual(['Anna']);
  });

  it('keeps the new backup plus the 4 newest older ones', () => {
    const db = createVersion1Db();
    addMigration('002_notes.sql', NOTES_SQL);
    fs.mkdirSync(backupsDir, { recursive: true });
    const day = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 7; i++) {
      // Higher numbers than the new backup on purpose: pruning goes by age, not by number.
      const file = path.join(backupsDir, `pre-migration-0${10 + i}.sqlite`);
      fs.writeFileSync(file, 'x');
      const time = new Date(Date.now() - (10 - i) * day);
      fs.utimesSync(file, time, time);
    }
    fs.writeFileSync(path.join(backupsDir, 'rezepte-2026-09-01.sqlite'), 'regular backup');

    runMigrations(db, { migrationsDir, backupsDir, log: createMemoryLogger() });

    expect(backups()).toEqual([
      'pre-migration-002.sqlite',
      'pre-migration-013.sqlite',
      'pre-migration-014.sqlite',
      'pre-migration-015.sqlite',
      'pre-migration-016.sqlite',
      'rezepte-2026-09-01.sqlite',
    ]);
  });

  it('rolls back a failing migration and names the file', () => {
    const db = createVersion1Db();
    addMigration('002_broken.sql', BROKEN_SQL);
    const log = createMemoryLogger();

    let error: unknown;
    try {
      runMigrations(db, { migrationsDir, backupsDir, log });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).message).toMatch(
      /^Migration 002_broken\.sql fehlgeschlagen: .*missing_table/,
    );
    expect((error as MigrationError).file).toBe('002_broken.sql');
    expect(userVersion(db)).toBe(1);
    expect(tables(db)).not.toContain('broken_marker');
    expect(db.inTransaction).toBe(false);
    expect(log.entries.some((e) => e.msg === 'migration applied')).toBe(false);
    // The backup taken before the attempt stays available for recovery.
    expect(backups()).toContain('pre-migration-002.sqlite');
  });

  it('rolls back the whole batch when a later migration fails', () => {
    const db = createVersion1Db();
    addMigration('002_notes.sql', NOTES_SQL);
    addMigration('003_broken.sql', BROKEN_SQL);

    expect(() => runMigrations(db, { migrationsDir, backupsDir, log: createMemoryLogger() })).toThrow(
      /^Migration 003_broken\.sql fehlgeschlagen/,
    );
    expect(userVersion(db)).toBe(1);
    expect(tables(db)).not.toContain('notes');
    expect(tables(db)).not.toContain('broken_marker');
  });

  it('refuses a database that is newer than the app', () => {
    const db = openFile();
    db.pragma('user_version = 7');
    expect(() => runMigrations(db, { migrationsDir, backupsDir, log: createMemoryLogger() })).toThrow(
      MigrationError,
    );
    expect(userVersion(db)).toBe(7);
  });

  it('refuses to migrate a read-only database', () => {
    openFile().pragma('user_version = 0');
    const db = openFile(dbFile, { readonly: true, fileMustExist: true });
    expect(() => runMigrations(db, { migrationsDir, backupsDir, log: createMemoryLogger() })).toThrow(
      /schreibgeschützt/,
    );
  });

  it('does not touch the database when the migration list has a gap', () => {
    addMigration('003_later.sql', NOTES_SQL);
    const db = openFile();
    expect(() => runMigrations(db, { migrationsDir, backupsDir, log: createMemoryLogger() })).toThrow(
      /Migration 002 fehlt/,
    );
    expect(userVersion(db)).toBe(0);
    expect(tables(db)).toEqual([]);
  });
});

describe('listMigrations', () => {
  it('lists the shipped migrations in order, starting with 001_init.sql', () => {
    const list = listMigrations(MIGRATIONS_DIR);
    expect(list[0]).toEqual({ version: 1, name: 'init', file: path.join(MIGRATIONS_DIR, '001_init.sql') });
    expect(list.map((m) => m.version)).toEqual(list.map((_, i) => i + 1));
  });

  it('sorts by version and ignores non-SQL files', () => {
    addMigration('002_notes.sql', NOTES_SQL);
    fs.writeFileSync(path.join(migrationsDir, 'README.md'), '# Migrationen');
    expect(listMigrations(migrationsDir).map((m) => `${m.version}:${m.name}`)).toEqual(['1:init', '2:notes']);
  });

  it('throws on a gap', () => {
    addMigration('003_later.sql', NOTES_SQL);
    expect(() => listMigrations(migrationsDir)).toThrow(MigrationError);
    expect(() => listMigrations(migrationsDir)).toThrow(/Migration 002 fehlt/);
  });

  it('throws on a duplicate version', () => {
    addMigration('001_again.sql', NOTES_SQL);
    expect(() => listMigrations(migrationsDir)).toThrow(/Migration 001 ist doppelt/);
  });

  it('throws on a badly named SQL file', () => {
    addMigration('2_notes.sql', NOTES_SQL);
    expect(() => listMigrations(migrationsDir)).toThrow(/Ungültiger Migrationsname: 2_notes\.sql/);
  });
});
