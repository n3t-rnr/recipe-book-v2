import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../../server/db/connection.ts';
import type { DB } from '../../server/db/types.ts';
import { createMemoryLogger } from '../../server/log.ts';

let dir: string;
let dbFile: string;
const openDbs: DB[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-conn-'));
  dbFile = path.join(dir, 'rezepte.sqlite');
});

afterEach(() => {
  // Windows cannot delete open database files.
  for (const db of openDbs.splice(0)) if (db.open) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function track<T extends DB>(db: T): T {
  openDbs.push(db);
  return db;
}

/** Valid WAL database of ~160 pages, fully checkpointed into the main file. */
function createFilledDb(file: string): void {
  const log = createMemoryLogger();
  const { db } = openDatabase(file, log);
  db.exec('CREATE TABLE filler (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO filler(v) VALUES (?)');
  db.transaction(() => {
    for (let i = 0; i < 3000; i++) insert.run(`${'x'.repeat(200)}${i}`);
  })();
  closeDatabase(db, log);
}

function overwrite(file: string, offset: number, length: number): void {
  const fd = fs.openSync(file, 'r+');
  try {
    // 0xFF is no valid b-tree page type, so every hit page fails btreeInitPage().
    fs.writeSync(fd, Buffer.alloc(length, 0xff), 0, length, offset);
  } finally {
    fs.closeSync(fd);
  }
}

function walSize(file: string): number {
  try {
    return fs.statSync(`${file}-wal`).size;
  } catch {
    return 0;
  }
}

describe('openDatabase', () => {
  it('opens a file database with the PRAGMAs from Kap. 4.1', () => {
    const log = createMemoryLogger();
    const { db, status } = openDatabase(dbFile, log);
    track(db);

    expect(status).toBe('ok');
    expect(db.readonly).toBe(false);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('cache_size', { simple: true })).toBe(-16000);
    expect(log.entries.filter((e) => e.level === 'error')).toEqual([]);
  });

  it('reopens a damaged database read-only and reports it as corrupt (NF-19)', () => {
    createFilledDb(dbFile);
    const size = fs.statSync(dbFile).size;
    // Keep page 1 (header and schema) intact, destroy the middle half of the table pages.
    overwrite(dbFile, Math.floor(size / 4), Math.floor(size / 2));

    const log = createMemoryLogger();
    const { db, status } = openDatabase(dbFile, log);
    track(db);

    expect(status).toBe('corrupt');
    expect(db.readonly).toBe(true);
    const errors = log.entries.filter((e) => e.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.file).toBe(dbFile);
    const problems = errors[0]?.problems;
    expect(Array.isArray(problems) && problems.length > 0).toBe(true);
    // Still readable where possible, but never writable.
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").pluck().all()).toEqual([
      'filler',
    ]);
    expect(() => db.exec('CREATE TABLE x (id INTEGER)')).toThrow(/readonly/);
  });

  it('throws a German error for a file that is not a database at all', () => {
    // Deliberately not "corrupt": a read-only connection that cannot even read the schema is useless.
    fs.writeFileSync(dbFile, Buffer.alloc(8192, 'Keine Datenbank. '));
    const log = createMemoryLogger();

    expect(() => openDatabase(dbFile, log)).toThrow(
      /^Datenbank kann nicht geöffnet werden: file is not a database/,
    );
    expect(log.entries.some((e) => e.level === 'error')).toBe(true);
  });

  it('throws a German error when the file cannot be created', () => {
    const log = createMemoryLogger();
    expect(() => openDatabase(path.join(dir, 'fehlt', 'rezepte.sqlite'), log)).toThrow(
      /^Datenbank kann nicht geöffnet werden: /,
    );
  });
});

describe('closeDatabase', () => {
  it('truncates the WAL before closing (NF-24)', () => {
    const log = createMemoryLogger();
    const { db } = openDatabase(dbFile, log);
    // A second connection keeps SQLite from deleting the WAL on close, so only the checkpoint can empty it.
    const other = track(new Database(dbFile));
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const insert = db.prepare('INSERT INTO t(v) VALUES (?)');
    for (let i = 0; i < 50; i++) insert.run(`Zeile ${i}`);
    expect(walSize(dbFile)).toBeGreaterThan(0);

    closeDatabase(db, log);

    expect(db.open).toBe(false);
    expect(walSize(dbFile)).toBe(0);
    expect(other.prepare('SELECT count(*) FROM t').pluck().get()).toBe(50);
    other.close();
    expect(walSize(dbFile)).toBe(0);
    expect(log.entries.filter((e) => e.level === 'error')).toEqual([]);
  });

  it('never throws, also for read-only or already closed connections', () => {
    const log = createMemoryLogger();
    const { db } = openDatabase(dbFile, log);
    closeDatabase(db, log);
    expect(() => closeDatabase(db, log)).not.toThrow();

    const ro = new Database(dbFile, { readonly: true, fileMustExist: true });
    expect(() => closeDatabase(ro, log)).not.toThrow();
    expect(ro.open).toBe(false);
    expect(log.entries.filter((e) => e.level === 'error')).toEqual([]);
  });
});
