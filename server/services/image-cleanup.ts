import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_VARIANTS } from '../../shared/constants.ts';
import {
  deleteUnassignedImagesBefore,
  hasImageWithKey,
  type ImageKeyRow,
  listImageKeys,
} from '../db/repos/image-cleanup.ts';
import { getMeta, setMeta } from '../db/repos/meta.ts';
import type { DataPaths } from '../paths.ts';
import type { AppDeps, RuntimeState } from '../types.ts';
import { recordImageTrashBytes } from './health.ts';

/**
 * Image cleanup (F-16, Kap. 4.6 "Aufräumen", Kap. 10.9). Hourly inside the maintenance run:
 * unassigned uploads after 7 days, images/.trash after BACKUP_KEEP days, tmp/ after 1 hour.
 * Weekly and once at the start: referenced files come back from images/.trash, files without an
 * images row move to images/.trash. Only images/, images/.trash and tmp/ are ever touched, and every
 * age decision uses the injected clock (deps.now).
 */
export type ImageCleanupDeps = Pick<AppDeps, 'db' | 'paths' | 'log' | 'now'> & {
  config: Pick<AppDeps['config'], 'backupKeep'>;
};

/** What the start step in server/main.ts passes; read-only mode (NF-19) skips everything. */
export type ImageStartupDeps = ImageCleanupDeps & { state: Pick<RuntimeState, 'db'> };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Never assigned uploads are removed after 7 days (F-16). */
export const UNASSIGNED_MAX_AGE_MS = 7 * DAY_MS;
/** Leftovers of interrupted uploads in tmp/ are removed after 1 hour (Kap. 4.6). */
export const TMP_MAX_AGE_MS = HOUR_MS;
/** Distance between two sweeps of images/ (Kap. 4.6: weekly). */
export const SWEEP_INTERVAL_MS = 7 * DAY_MS;
/**
 * A file without a row is only an orphan when it is at least this old: an upload renames its
 * variants into images/ just before it writes the row, and must never lose them to the sweep.
 */
export const ORPHAN_GRACE_MS = HOUR_MS;
/** meta key with the ISO time of the last sweep. */
export const SWEEP_META_KEY = 'image_sweep_at';

const VARIANTS = Object.keys(IMAGE_VARIANTS);
/** file_key is 16 lower-case hex characters (Kap. 4.6); anything else never becomes part of a path. */
const FILE_KEY = /^[0-9a-f]{16}$/;
/** <file_key>-<variant>.webp, the only names the app writes into images/. */
const VARIANT_FILE = new RegExp(`^([0-9a-f]{16})-(${VARIANTS.join('|')})\\.webp$`);
/** Upper bound for id and file lists in one log line. */
const LOG_LIST_MAX = 50;

export interface ImageRecovery {
  /** Images with at least one variant moved back from images/.trash. */
  restoredImages: number;
  restoredFiles: number;
  /** Images with a variant in neither folder; the UI shows the placeholder for them. */
  missingImages: number;
}

export interface ImageSweep extends ImageRecovery {
  /** Files without an images row moved to images/.trash. */
  orphansMoved: number;
}

// --- Small file helpers. Candidates for a shared module with services/image-files.ts (upload),
// --- moveImageFilesToTrash in services/trash.ts and services/recipes.ts.

function variantFile(fileKey: string, variant: string): string {
  return `${fileKey}-${variant}.webp`;
}

function errorCode(err: unknown): string | undefined {
  return err instanceof Error && 'code' in err && typeof err.code === 'string' ? err.code : undefined;
}

/** Entries of a folder; a missing folder has none. */
function readEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return [];
    throw err;
  }
}

/** Names of the regular files in a folder. */
function fileNames(dir: string): Set<string> {
  return new Set(
    readEntries(dir)
      .filter((e) => e.isFile())
      .map((e) => e.name),
  );
}

/** Rename within the volume; copy and unlink when images/.trash lives on another one (EXDEV). */
function moveFile(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (errorCode(err) !== 'EXDEV') throw err;
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

/** Moves images/<name> to images/.trash/<name>; the retention of BACKUP_KEEP days starts `now`. */
function moveToTrash(paths: DataPaths, name: string, now: Date): void {
  const target = path.join(paths.imagesTrash, name);
  moveFile(path.join(paths.images, name), target);
  try {
    fs.utimesSync(target, now, now);
  } catch {
    // The retention then counts from the file's own age, which only shortens it.
  }
}

/** Collects the per-file failures of one step and logs them as a single warning. */
function failureLog(deps: Pick<ImageCleanupDeps, 'log'>, msg: string) {
  let failed = 0;
  let first: { file: string; err: unknown } | null = null;
  return {
    add(file: string, err: unknown): void {
      failed++;
      first ??= { file, err };
    },
    flush(): void {
      if (first) deps.log.warn(msg, { failed, file: first.file, err: first.err });
    },
  };
}

// --- Hourly steps (services/maintenance.ts calls each one in its own try/catch).

/**
 * Deletes unassigned images older than 7 days (F-16) and moves their files to images/.trash.
 * Files move after the delete: a failed move leaves an orphan for the weekly sweep, never a row
 * without files. The deleted ids are never handed out again (meta.image_id_max, same transaction).
 * Returns the number of deleted rows.
 */
export function expireUnassignedImages(deps: ImageCleanupDeps, now: Date = deps.now()): number {
  const cutoff = new Date(now.getTime() - UNASSIGNED_MAX_AGE_MS).toISOString();
  // Without a trash folder no row is deleted, so the files never become orphans in images/.
  fs.mkdirSync(deps.paths.imagesTrash, { recursive: true });
  const rows = deps.db.transaction(() => deleteUnassignedImagesBefore(deps.db, cutoff))();
  if (rows.length === 0) return 0;
  const failures = failureLog(deps, 'moving expired image files failed');
  for (const row of rows) {
    if (!validKey(deps, row)) continue;
    for (const variant of VARIANTS) {
      const name = variantFile(row.fileKey, variant);
      try {
        moveToTrash(deps.paths, name, now);
      } catch (err) {
        if (errorCode(err) !== 'ENOENT') failures.add(name, err);
      }
    }
  }
  failures.flush();
  deps.log.debug('unassigned images expired', { imageIds: rows.map((r) => r.id).slice(0, LOG_LIST_MAX) });
  return rows.length;
}

/**
 * Deletes files in images/.trash older than BACKUP_KEEP days (F-16), so every kept backup still
 * finds its images. A file an images row references is kept: the next recovery brings it back.
 * The sizes of the files that stay go to /health (recordImageTrashBytes), which therefore never
 * walks the folder itself. Returns the number of deleted files.
 */
export function purgeImageTrash(deps: ImageCleanupDeps, now: Date = deps.now()): number {
  const cutoff = now.getTime() - deps.config.backupKeep * DAY_MS;
  const failures = failureLog(deps, 'deleting files from images/.trash failed');
  const referenced: string[] = [];
  let deleted = 0;
  let keptBytes = 0;
  for (const entry of readEntries(deps.paths.imagesTrash)) {
    if (!entry.isFile()) continue;
    const file = path.join(deps.paths.imagesTrash, entry.name);
    let size = 0;
    try {
      const stat = fs.lstatSync(file);
      size = stat.size;
      if (stat.mtimeMs > cutoff) {
        keptBytes += size;
        continue;
      }
      const key = VARIANT_FILE.exec(entry.name)?.[1];
      if (key !== undefined && hasImageWithKey(deps.db, key)) {
        referenced.push(entry.name);
        keptBytes += size;
        continue;
      }
      fs.unlinkSync(file);
      deleted++;
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') {
        failures.add(entry.name, err);
        // Still there (e.g. EBUSY while a virus scanner holds it): it still takes up space.
        keptBytes += size;
      }
    }
  }
  recordImageTrashBytes(deps.paths, keptBytes);
  failures.flush();
  if (referenced.length > 0) {
    deps.log.warn('referenced image files kept in images/.trash', {
      count: referenced.length,
      files: referenced.slice(0, LOG_LIST_MAX),
    });
  }
  return deleted;
}

/**
 * Deletes everything in tmp/ older than 1 hour: leftovers of interrupted uploads (Kap. 4.6).
 * A running upload keeps writing, so its file never gets that old. Returns the number of entries.
 */
export function purgeTmp(deps: ImageCleanupDeps, now: Date = deps.now()): number {
  const cutoff = now.getTime() - TMP_MAX_AGE_MS;
  const failures = failureLog(deps, 'deleting files from tmp failed');
  let deleted = 0;
  for (const entry of readEntries(deps.paths.tmp)) {
    const file = path.join(deps.paths.tmp, entry.name);
    try {
      if (fs.lstatSync(file).mtimeMs > cutoff) continue;
      // lstat-based: a link is removed itself, its target outside tmp/ stays untouched.
      fs.rmSync(file, { recursive: true, force: true });
      deleted++;
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') failures.add(entry.name, err);
    }
  }
  failures.flush();
  return deleted;
}

// --- Weekly sweep and start.

/**
 * Moves every variant file an images row references back from images/.trash (F-16, Kap. 10.9:
 * a restored database finds the images it knew). Variants found nowhere are logged with the
 * image id; the UI then shows the placeholder.
 */
export function restoreImageFiles(deps: ImageCleanupDeps): ImageRecovery {
  const rows = listImageKeys(deps.db);
  const result: ImageRecovery = { restoredImages: 0, restoredFiles: 0, missingImages: 0 };
  if (rows.length === 0) return result;
  const inImages = fileNames(deps.paths.images);
  const inTrash = fileNames(deps.paths.imagesTrash);
  const failures = failureLog(deps, 'restoring image files failed');
  const missing: number[] = [];
  let imagesDirReady = false;
  for (const row of rows) {
    if (!validKey(deps, row)) {
      missing.push(row.id);
      continue;
    }
    let restored = 0;
    let lacking = false;
    for (const variant of VARIANTS) {
      const name = variantFile(row.fileKey, variant);
      if (inImages.has(name)) continue;
      if (!inTrash.has(name)) {
        lacking = true;
        continue;
      }
      try {
        if (!imagesDirReady) {
          fs.mkdirSync(deps.paths.images, { recursive: true });
          imagesDirReady = true;
        }
        moveFile(path.join(deps.paths.imagesTrash, name), path.join(deps.paths.images, name));
        restored++;
      } catch (err) {
        lacking = true;
        failures.add(name, err);
      }
    }
    if (restored > 0) {
      result.restoredImages++;
      result.restoredFiles += restored;
    }
    if (lacking) missing.push(row.id);
  }
  failures.flush();
  result.missingImages = missing.length;
  if (missing.length > 0) {
    deps.log.warn('image files missing', { count: missing.length, imageIds: missing.slice(0, LOG_LIST_MAX) });
  }
  return result;
}

/**
 * Moves files named <file_key>-<variant>.webp without an images row from images/ to images/.trash
 * (F-16). Files younger than ORPHAN_GRACE_MS stay (upload in progress); other names and folders are
 * left alone, with one warning per sweep. Returns the number of moved files.
 */
export function moveOrphanImageFiles(deps: ImageCleanupDeps, now: Date = deps.now()): number {
  const keys = new Set(listImageKeys(deps.db).map((r) => r.fileKey));
  const failures = failureLog(deps, 'moving orphan image files failed');
  const unknown: string[] = [];
  let moved = 0;
  let trashReady = false;
  for (const entry of readEntries(deps.paths.images)) {
    if (!entry.isFile()) continue; // .trash and any other folder or link
    const key = VARIANT_FILE.exec(entry.name)?.[1];
    if (key === undefined) {
      unknown.push(entry.name);
      continue;
    }
    if (keys.has(key)) continue;
    try {
      const age = now.getTime() - fs.lstatSync(path.join(deps.paths.images, entry.name)).mtimeMs;
      if (age < ORPHAN_GRACE_MS) continue;
      if (!trashReady) {
        fs.mkdirSync(deps.paths.imagesTrash, { recursive: true });
        trashReady = true;
      }
      moveToTrash(deps.paths, entry.name, now);
      moved++;
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') failures.add(entry.name, err);
    }
  }
  failures.flush();
  if (unknown.length > 0) {
    deps.log.warn('unknown files in images/ left alone', {
      count: unknown.length,
      files: unknown.slice(0, LOG_LIST_MAX),
    });
  }
  return moved;
}

/** Due when never run, the stored time is unreadable or in the future (clock reset), or a week old. */
export function isSweepDue(lastRun: string | null, now: Date): boolean {
  if (lastRun === null) return true;
  const last = Date.parse(lastRun);
  if (Number.isNaN(last) || last > now.getTime()) return true;
  return now.getTime() - last >= SWEEP_INTERVAL_MS;
}

/**
 * The sweep: recovery first (a referenced file must never count as an orphan or expire in
 * images/.trash), then the orphans. Stores the time in meta.image_sweep_at and logs the counts.
 * Throws on a failure that stops the whole step; the time is then not stored, so the next hourly
 * run tries again.
 */
export function runImageSweep(
  deps: ImageCleanupDeps,
  trigger: 'startup' | 'weekly',
  now: Date = deps.now(),
): ImageSweep {
  const recovery = restoreImageFiles(deps);
  const orphansMoved = moveOrphanImageFiles(deps, now);
  setMeta(deps.db, SWEEP_META_KEY, now.toISOString());
  const result: ImageSweep = { ...recovery, orphansMoved };
  deps.log.info('image sweep', { trigger, ...result });
  return result;
}

/** Hourly check (services/maintenance.ts): runs the sweep when it is due; null otherwise. */
export function runImageSweepIfDue(deps: ImageCleanupDeps, now: Date = deps.now()): ImageSweep | null {
  if (!isSweepDue(getMeta(deps.db, SWEEP_META_KEY), now)) return null;
  return runImageSweep(deps, 'weekly', now);
}

/**
 * Start step (server/main.ts, after the migrations, before the port opens): the sweep including the
 * recovery, then tmp/. Never throws; skipped in read-only mode (NF-19).
 */
export function runImageStartup(deps: ImageStartupDeps): void {
  if (deps.state.db === 'corrupt') {
    deps.log.info('image recovery skipped: read-only database');
    return;
  }
  const now = deps.now();
  try {
    runImageSweep(deps, 'startup', now);
  } catch (err) {
    deps.log.error('image recovery failed', { err });
  }
  try {
    const deleted = purgeTmp(deps, now);
    if (deleted > 0) deps.log.info('tmp cleaned', { entries: deleted });
  } catch (err) {
    deps.log.error('tmp cleanup failed', { err });
  }
}

function validKey(deps: Pick<ImageCleanupDeps, 'log'>, row: ImageKeyRow): boolean {
  if (FILE_KEY.test(row.fileKey)) return true;
  deps.log.warn('invalid image file key skipped', { imageId: row.id, fileKey: row.fileKey });
  return false;
}
