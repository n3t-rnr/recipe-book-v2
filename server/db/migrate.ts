import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../log.ts';
import type { DB } from './types.ts';

/** Numbered SQL migrations shipped with the app (Kap. 4.7). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export interface Migration {
  version: number;
  /** Name part of the file, e.g. "init" for 001_init.sql. */
  name: string;
  /** Absolute path of the .sql file. */
  file: string;
}

export interface MigrationOptions {
  migrationsDir: string;
  backupsDir: string;
  log: Logger;
  /** Number of pre-migration backups to keep (NF-20: 5). */
  keep?: number;
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: number[];
  /** Backup written before migrating; null for a fresh database or when nothing was pending. */
  backupFile: string | null;
}

/** Start must abort with exit code 1 and this message (NF-20). */
export class MigrationError extends Error {
  /** Base name of the migration file that failed, if a specific one did. */
  readonly file: string | null;

  constructor(message: string, file: string | null = null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MigrationError';
    this.file = file;
  }
}

const FILE_PATTERN = /^(\d{3})_([A-Za-z0-9_-]+)\.sql$/;
const BACKUP_PATTERN = /^pre-migration-(\d+)\.sqlite$/;
const DEFAULT_KEEP = 5;

/**
 * Lists NNN_name.sql files in version order. Versions must be exactly 1..n: a gap or a
 * duplicate usually means a merge mistake, and skipping a step would corrupt the schema.
 */
export function listMigrations(dir: string): Migration[] {
  const migrations: Migration[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.toLowerCase().endsWith('.sql')) continue;
    const match = FILE_PATTERN.exec(entry);
    const version = Number(match?.[1]);
    if (!match?.[2] || !(version >= 1)) {
      throw new MigrationError(`Ungültiger Migrationsname: ${entry} (erwartet NNN_name.sql ab 001)`, entry);
    }
    migrations.push({ version, name: match[2], file: path.join(dir, entry) });
  }
  migrations.sort((a, b) => a.version - b.version);
  let expected = 1;
  for (const m of migrations) {
    if (m.version < expected) throw new MigrationError(`Migration ${pad(m.version)} ist doppelt in ${dir}`);
    if (m.version > expected) throw new MigrationError(`Migration ${pad(expected)} fehlt in ${dir}`);
    expected++;
  }
  return migrations;
}

/**
 * Applies all migrations above PRAGMA user_version in one transaction (NF-20, Kap. 4.7).
 * An existing database is first copied to backups/pre-migration-NNN.sqlite. On failure the
 * transaction rolls back completely, so the database stays at its previous version.
 *
 * Migration files must not contain BEGIN/COMMIT: they run inside the runner's transaction.
 */
export function runMigrations(db: DB, opts: MigrationOptions): MigrationResult {
  const migrations = listMigrations(opts.migrationsDir);
  const latest = migrations.at(-1)?.version ?? 0;
  const from = db.pragma('user_version', { simple: true }) as number;

  if (from > latest) {
    throw new MigrationError(
      `Datenbank hat Version ${from}, diese App kennt nur Version ${latest}. Bitte die App aktualisieren.`,
    );
  }
  const pending = migrations.filter((m) => m.version > from);
  const first = pending[0];
  if (!first) return { from, to: from, applied: [], backupFile: null };

  if (db.readonly) {
    throw new MigrationError(
      `Datenbank ist schreibgeschützt; Migration ${fileName(first)} kann nicht laufen.`,
    );
  }
  // Inside a caller's transaction our transaction would only be a savepoint and VACUUM INTO fails.
  if (db.inTransaction)
    throw new MigrationError('Migrationen dürfen nicht innerhalb einer Transaktion laufen.');

  let backupFile: string | null = null;
  if (from > 0) {
    backupFile = createBackup(db, opts.backupsDir, first.version);
    opts.log.info('pre-migration backup created', { file: backupFile });
    pruneBackups(opts.backupsDir, backupFile, opts.keep ?? DEFAULT_KEEP, opts.log);
  }

  const to = pending.at(-1)?.version ?? from;
  db.transaction(() => {
    for (const m of pending) {
      try {
        db.exec(fs.readFileSync(m.file, 'utf8'));
      } catch (err) {
        throw new MigrationError(
          `Migration ${fileName(m)} fehlgeschlagen: ${errorMessage(err)}`,
          fileName(m),
          err,
        );
      }
    }
    // Inside the transaction, so version and schema can never disagree.
    db.pragma(`user_version = ${to}`);
  })();

  // Logged after the commit so the log never claims a migration that was rolled back.
  for (const m of pending) opts.log.info('migration applied', { version: m.version, file: fileName(m) });
  return { from, to, applied: pending.map((m) => m.version), backupFile };
}

/** VACUUM INTO writes a consistent, compacted snapshot; it must run outside any transaction. */
function createBackup(db: DB, backupsDir: string, version: number): string {
  const file = path.join(backupsDir, `pre-migration-${pad(version)}.sqlite`);
  try {
    fs.mkdirSync(backupsDir, { recursive: true });
    // VACUUM INTO refuses to overwrite; a leftover from an earlier attempt is outdated anyway.
    fs.rmSync(file, { force: true });
    db.prepare('VACUUM INTO ?').run(file);
  } catch (err) {
    throw new MigrationError(
      `Backup vor Migration ${pad(version)} fehlgeschlagen: ${errorMessage(err)}`,
      null,
      err,
    );
  }
  return file;
}

/**
 * Keeps the backup just written plus the newest others, keep in total. Sorted by mtime rather
 * than by number: after restoring an old backup, the fresh pre-migration-002 is the newest file.
 */
function pruneBackups(backupsDir: string, current: string, keep: number, log: Logger): void {
  const others = fs
    .readdirSync(backupsDir)
    .map((name) => ({ name, match: BACKUP_PATTERN.exec(name) }))
    .filter((e) => e.match !== null && path.join(backupsDir, e.name) !== current)
    .map((e) => {
      const file = path.join(backupsDir, e.name);
      return { file, version: Number(e.match?.[1]), mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.version - a.version);

  for (const old of others.slice(Math.max(0, keep - 1))) {
    try {
      fs.rmSync(old.file, { force: true });
      log.info('old pre-migration backup removed', { file: old.file });
    } catch (err) {
      // A locked backup must not block the start; it is retried at the next migration.
      log.warn('removing old pre-migration backup failed', { file: old.file, err });
    }
  }
}

function fileName(m: Migration): string {
  return path.basename(m.file);
}

function pad(version: number): string {
  return String(version).padStart(3, '0');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
