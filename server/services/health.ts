import fs from 'node:fs';
import path from 'node:path';
import { sumImageBytes } from '../db/repos/images.ts';
import { getMeta } from '../db/repos/meta.ts';
import { type Counts, getCounts } from '../db/repos/stats.ts';
import { currentRevision } from '../middleware/revision.ts';
import type { DataPaths } from '../paths.ts';
import type { AppDeps, RuntimeState } from '../types.ts';

/** Below this, uploads are refused (NF-24) and health reports "degraded". */
export const LOW_DISK_BYTES = 200 * 1024 * 1024;

/** The backups folder sum is the only folder walk left in /health; 30 s is fresh enough for the status page. */
const DIR_SIZE_TTL_MS = 30_000;

export type HealthStatus = 'ok' | 'degraded' | 'read-only';

/** Response of GET /api/v1/health (Kap. 7.8); the status page shows exactly these values (F-42). */
export interface Health {
  ok: boolean;
  status: HealthStatus;
  version: string;
  uptimeSec: number;
  /** null when the database cannot be read (e.g. a damaged table in read-only mode). */
  counts: Counts | null;
  bytes: { db: number; images: number; backups: number };
  /** null when the file system does not report free space. */
  freeDiskBytes: number | null;
  lastBackupAt: string | null;
  lastBackupError: string | null;
  images: RuntimeState['images'];
  db: RuntimeState['db'];
  /** null when the meta table cannot be read (damaged DB in read-only mode). */
  dataRevision: number | null;
}

interface DirSizes {
  at: number;
  backups: number;
}

// Keyed by the DataPaths object so every app instance (and every test context) has its own cache.
const dirSizeCache = new WeakMap<DataPaths, DirSizes>();

/** Lets a writer (e.g. a finished backup) make the next /health call recount immediately. */
export function invalidateDirSizes(paths: DataPaths): void {
  dirSizeCache.delete(paths);
}

// Bytes in images/.trash, as the hourly maintenance last counted them (same keying as above).
const imageTrashBytes = new WeakMap<DataPaths, number>();

/**
 * Stores the size of images/.trash for /health. The hourly maintenance lists that folder anyway
 * (services/image-cleanup.ts, purgeImageTrash), so /health never walks the image folders: with
 * 15,000 files one stat per file blocked the event loop for about a second (NF-05).
 */
export function recordImageTrashBytes(paths: DataPaths, bytes: number): void {
  imageTrashBytes.set(paths, bytes);
}

function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Sum of the regular files directly inside dir (backups/: a few dozen files at most). */
function sumFileBytes(dir: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.isFile()) total += fileBytes(path.join(dir, entry.name));
  }
  return total;
}

function dirSizes(paths: DataPaths, now: number): DirSizes {
  const cached = dirSizeCache.get(paths);
  // now >= cached.at guards against the wall clock jumping backwards.
  if (cached && now >= cached.at && now - cached.at < DIR_SIZE_TTL_MS) return cached;
  const fresh: DirSizes = { at: now, backups: sumFileBytes(paths.backups) };
  dirSizeCache.set(paths, fresh);
  return fresh;
}

/**
 * bytes.images without touching images/: the variants of every images row (bytes_total, written at
 * upload; the files never change) plus images/.trash as the last maintenance run counted it (0
 * until the first run, 5 s after the start). Files without a row in images/ are not counted; the
 * weekly sweep moves them to images/.trash.
 */
function imageBytes(deps: AppDeps): number {
  const trash = imageTrashBytes.get(deps.paths) ?? 0;
  try {
    return sumImageBytes(deps.db) + trash;
  } catch (err) {
    deps.log.warn('health: image bytes unavailable', { err });
    return trash;
  }
}

function freeDiskBytes(dir: string): number | null {
  try {
    const stats = fs.statfsSync(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function deriveStatus(
  state: RuntimeState,
  lastBackupError: string | null,
  freeBytes: number | null,
): HealthStatus {
  if (state.db === 'corrupt') return 'read-only';
  if (state.images === 'unavailable') return 'degraded';
  if (lastBackupError !== null) return 'degraded';
  if (freeBytes !== null && freeBytes < LOW_DISK_BYTES) return 'degraded';
  return 'ok';
}

/**
 * Snapshot for /api/v1/health. Must stay fast (NF-05: <= 200 ms even during image jobs or
 * backups), hence one COUNT statement, one SUM statement, a cached backups sum, the images/.trash
 * size from the maintenance and no async work.
 */
export function buildHealth(deps: AppDeps): Health {
  const { db, paths, state } = deps;
  const now = deps.now().getTime();

  let counts: Counts | null = null;
  try {
    counts = getCounts(db);
  } catch (err) {
    // Health has to answer precisely when the database is in trouble (read-only mode, NF-19).
    deps.log.warn('health: counts unavailable', { err });
  }

  // An empty value means "cleared" for whoever writes these keys. Guarded like counts: a damaged
  // meta page must not turn /health into a 500 in read-only mode (NF-19).
  const lastBackupAt = safeMeta(deps, 'last_backup_at');
  const lastBackupError = safeMeta(deps, 'last_backup_error');
  const revision = currentRevision(db);
  const free = freeDiskBytes(paths.dataDir);
  const sizes = dirSizes(paths, now);
  const status = deriveStatus(state, lastBackupError, free);

  return {
    ok: status === 'ok',
    status,
    version: state.version,
    uptimeSec: Math.max(0, Math.floor((now - state.startedAt.getTime()) / 1000)),
    counts,
    bytes: {
      db: fileBytes(paths.db) + fileBytes(`${paths.db}-wal`),
      images: imageBytes(deps),
      backups: sizes.backups,
    },
    freeDiskBytes: free,
    lastBackupAt,
    lastBackupError,
    images: state.images,
    db: state.db,
    dataRevision: revision === null ? null : Number(revision),
  };
}

function safeMeta(deps: AppDeps, key: string): string | null {
  try {
    return getMeta(deps.db, key) || null;
  } catch (err) {
    deps.log.warn('health: meta unavailable', { key, err });
    return null;
  }
}
