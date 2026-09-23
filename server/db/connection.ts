import Database from 'better-sqlite3';
import type { Logger } from '../log.ts';
import type { DB } from './types.ts';

export interface OpenResult {
  db: DB;
  /** "corrupt": quick_check failed, the returned connection is read-only (NF-19). */
  status: 'ok' | 'corrupt';
}

/** quick_check reports at most this many problems; enough for the log, cheap on a badly damaged file. */
const QUICK_CHECK_LIMIT = 20;

/**
 * Opens the database with the PRAGMAs from Kap. 4.1 and runs PRAGMA quick_check (NF-19).
 *
 * A damaged file does not stop the server: it is reopened read-only and reported as "corrupt",
 * so recipes stay readable while the user restores a backup. A file that cannot even be read
 * read-only (e.g. not an SQLite file at all) throws, because a server without data is useless.
 */
export function openDatabase(file: string, log: Logger): OpenResult {
  let db: DB | null = null;
  let problems: string[];
  try {
    db = new Database(file);
    applyPragmas(db, false);
    problems = quickCheck(db);
    if (problems.length === 0) return { db, status: 'ok' };
  } catch (err) {
    safeClose(db);
    if (!isCorruptionError(err)) throw cannotOpen(err);
    problems = [errorMessage(err)];
  }

  log.error('database corrupt, switching to read-only mode', { file, problems });
  safeClose(db);
  return { db: openReadOnly(file), status: 'corrupt' };
}

/**
 * Clean shutdown (NF-24): folds the WAL back into the main file so rezepte.sqlite alone is a
 * complete copy, then closes. Never throws, because it runs on the shutdown path.
 */
export function closeDatabase(db: DB, log: Logger): void {
  if (!db.open) return;
  if (!db.readonly) {
    try {
      const result = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
      if (result[0]?.busy) log.warn('wal checkpoint incomplete (busy)');
    } catch (err) {
      log.error('wal checkpoint failed', { err });
    }
  }
  try {
    db.close();
  } catch (err) {
    log.error('closing database failed', { err });
  }
}

function applyPragmas(db: DB, readonly: boolean): void {
  // journal_mode is stored in the file; a read-only connection cannot (and need not) change it.
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -16000');
}

/** Returns the reported problems; an empty list means "ok". */
function quickCheck(db: DB): string[] {
  const rows = db.prepare(`PRAGMA quick_check(${QUICK_CHECK_LIMIT})`).pluck().all() as string[];
  return rows.length === 1 && rows[0] === 'ok' ? [] : rows;
}

function openReadOnly(file: string): DB {
  let db: DB | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    applyPragmas(db, true);
    // Opening is lazy; reading the schema proves the file is usable at least for reads.
    db.prepare('SELECT count(*) FROM sqlite_schema').get();
    return db;
  } catch (err) {
    safeClose(db);
    throw cannotOpen(err);
  }
}

function isCorruptionError(err: unknown): boolean {
  return err instanceof Database.SqliteError && /^SQLITE_(CORRUPT|NOTADB)/.test(err.code);
}

function cannotOpen(err: unknown): Error {
  return new Error(`Datenbank kann nicht geöffnet werden: ${errorMessage(err)}`, { cause: err });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeClose(db: DB | null): void {
  try {
    if (db?.open) db.close();
  } catch {
    // Already failing; the original error is what matters.
  }
}
