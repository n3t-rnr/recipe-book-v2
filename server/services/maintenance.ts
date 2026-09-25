import type { RuntimeState } from '../types.ts';
import {
  expireUnassignedImages,
  type ImageCleanupDeps,
  purgeImageTrash,
  purgeTmp,
  runImageSweepIfDue,
} from './image-cleanup.ts';
import { purgeExpired, type TrashDeps } from './trash.ts';

/**
 * Hourly maintenance (Kap. 5.4, the last start step): the only recurring server timer (NF-05).
 * It purges recipes that have been in the trash for TRASH_DAYS (F-08) and cleans up images
 * (F-16, Kap. 4.6: unassigned uploads, images/.trash, tmp/, the weekly sweep); the backup (F-40)
 * joins this run in its milestone. Listing images/.trash also yields its size for /health
 * (bytes.images), so no request ever walks the image folders.
 */
export type MaintenanceDeps = TrashDeps & ImageCleanupDeps & { state: Pick<RuntimeState, 'db'> };

export interface MaintenanceOptions {
  /** Pause between two runs (default: one hour). */
  intervalMs?: number;
  /** Delay of the first run, so the start itself stays short (NF-05: ≤ 1 s); default 5 s. */
  firstRunDelayMs?: number;
}

export const MAINTENANCE_INTERVAL_MS = 3_600_000;
const FIRST_RUN_DELAY_MS = 5_000;

/**
 * One maintenance run. Never throws: every task runs in its own try/catch, a failure is logged and
 * the next run tries again. Skipped in read-only mode (NF-19), where every write would fail anyway.
 * Logs one "maintenance" line with the non-zero counters; a run without work stays silent.
 */
export function runMaintenance(deps: MaintenanceDeps): void {
  if (deps.state.db === 'corrupt') {
    deps.log.debug('maintenance skipped: read-only database');
    return;
  }
  const now = deps.now();
  const counts: Record<string, number> = {};
  const task = (name: string, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      deps.log.error('maintenance failed', { task: name, err });
    }
  };

  task('trash', () => {
    counts.trashPurged = purgeExpired(deps, now);
  });
  // Before the image steps: the recovery brings referenced files back before anything expires.
  task('image-sweep', () => {
    runImageSweepIfDue(deps, now);
  });
  task('images-unassigned', () => {
    counts.imagesExpired = expireUnassignedImages(deps, now);
  });
  task('image-trash', () => {
    counts.imageTrashDeleted = purgeImageTrash(deps, now);
  });
  task('tmp', () => {
    counts.tmpDeleted = purgeTmp(deps, now);
  });

  const done = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
  if (Object.keys(done).length > 0) deps.log.info('maintenance', done);
}

/**
 * Runs the maintenance shortly after the start and then every intervalMs. Both timers are unref'd,
 * so they never keep the process alive. Returns the stop function for the shutdown; in read-only
 * mode no timer is started at all.
 */
export function startMaintenance(deps: MaintenanceDeps, options: MaintenanceOptions = {}): () => void {
  if (deps.state.db === 'corrupt') {
    deps.log.info('maintenance disabled: read-only database');
    return () => undefined;
  }
  const run = (): void => runMaintenance(deps);
  const first = setTimeout(run, options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS);
  first.unref();
  const hourly = setInterval(run, options.intervalMs ?? MAINTENANCE_INTERVAL_MS);
  hourly.unref();
  return () => {
    clearTimeout(first);
    clearInterval(hourly);
  };
}
