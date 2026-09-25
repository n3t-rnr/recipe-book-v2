import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reindexRecipe } from '../../server/db/fts.ts';
import { getMeta } from '../../server/db/repos/meta.ts';
import type { DB } from '../../server/db/types.ts';
import { buildHealth } from '../../server/services/health.ts';
import { SWEEP_META_KEY } from '../../server/services/image-cleanup.ts';
import {
  MAINTENANCE_INTERVAL_MS,
  type MaintenanceDeps,
  runMaintenance,
  startMaintenance,
} from '../../server/services/maintenance.ts';
import { normalize } from '../../shared/normalize.ts';
import { createTestContext, type TestContext } from '../helpers/app.ts';

const HOUR = 3_600_000;
const FIRST_RUN_MS = 5_000;

let ctx: TestContext;
let clock: Date;
let deps: MaintenanceDeps;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  clock = new Date('2026-09-23T10:05:00.000Z');
  ctx = createTestContext({ now: () => clock });
  deps = ctx.deps;
  stop = undefined;
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
  ctx.cleanup();
});

/** A recipe row with its FTS row; deletedAt null = active. */
function insertRecipe(db: DB, title: string, deletedAt: string | null): number {
  const id = Number(
    db
      .prepare('INSERT INTO recipes(title, title_key, deleted_at) VALUES (?, ?, ?)')
      .run(title, normalize(title), deletedAt).lastInsertRowid,
  );
  reindexRecipe(db, id);
  return id;
}

function exists(id: number): boolean {
  return ctx.deps.db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id) !== undefined;
}

function maintenanceLogs(): Array<Record<string, unknown>> {
  return ctx.log.entries.filter((e) => e.msg === 'maintenance');
}

describe('startMaintenance (F-08, NF-05)', () => {
  it('runs shortly after the start, not during it, and then every interval', () => {
    const db = ctx.deps.db;
    const expired = insertRecipe(db, 'Vor 31 Tagen', '2026-08-23T10:05:00.000Z');
    // Due at 2026-09-23T11:00Z, i.e. between the first and the second run.
    const later = insertRecipe(db, 'Bald fällig', '2026-08-24T11:00:00.000Z');
    const active = insertRecipe(db, 'Aktiv', null);

    stop = startMaintenance(deps, { intervalMs: HOUR });
    expect(exists(expired)).toBe(true);

    vi.advanceTimersByTime(FIRST_RUN_MS - 1);
    expect(exists(expired)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(exists(expired)).toBe(false);
    expect(exists(later)).toBe(true);
    expect(maintenanceLogs()).toEqual([expect.objectContaining({ level: 'info', trashPurged: 1 })]);

    clock = new Date('2026-09-23T11:05:00.000Z');
    vi.advanceTimersByTime(HOUR - FIRST_RUN_MS);
    expect(exists(later)).toBe(false);
    expect(exists(active)).toBe(true);
    expect(maintenanceLogs()).toHaveLength(2);

    // Runs without anything to purge stay silent.
    vi.advanceTimersByTime(HOUR);
    expect(maintenanceLogs()).toHaveLength(2);
    expect(db.prepare('SELECT count(*) FROM recipes_fts').pluck().get()).toBe(1);
  });

  it('repeats hourly by default', () => {
    stop = startMaintenance(deps);
    expect(MAINTENANCE_INTERVAL_MS).toBe(HOUR);
    vi.advanceTimersByTime(FIRST_RUN_MS);

    const expired = insertRecipe(ctx.deps.db, 'Alt', '2026-08-01T10:00:00.000Z');
    vi.advanceTimersByTime(HOUR - FIRST_RUN_MS - 1);
    expect(exists(expired)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(exists(expired)).toBe(false);
  });

  it('never throws: a failed run is logged and the next run tries again', () => {
    const db = ctx.deps.db;
    const expired = insertRecipe(db, 'Alt', '2026-08-01T10:00:00.000Z');
    db.exec(`
      CREATE TRIGGER fail_purge BEFORE DELETE ON recipes
      BEGIN
        SELECT RAISE(ABORT, 'forced purge failure');
      END;
    `);

    stop = startMaintenance(deps, { intervalMs: HOUR });
    expect(() => vi.advanceTimersByTime(FIRST_RUN_MS)).not.toThrow();
    expect(exists(expired)).toBe(true);
    const failure = ctx.log.entries.find((e) => e.msg === 'maintenance failed');
    expect(failure).toMatchObject({ level: 'error', task: 'trash' });

    db.exec('DROP TRIGGER fail_purge');
    vi.advanceTimersByTime(HOUR - FIRST_RUN_MS);
    expect(exists(expired)).toBe(false);
  });

  it('starts no timer in read-only mode and skips single runs there (NF-19)', () => {
    const expired = insertRecipe(ctx.deps.db, 'Alt', '2026-08-01T10:00:00.000Z');
    const readOnly: MaintenanceDeps = { ...deps, state: { db: 'corrupt' } };

    stop = startMaintenance(readOnly);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.log.entries.some((e) => e.msg === 'maintenance disabled: read-only database')).toBe(true);

    runMaintenance(readOnly);
    vi.advanceTimersByTime(2 * HOUR);
    expect(exists(expired)).toBe(true);
    expect(ctx.log.entries.some((e) => e.msg === 'maintenance failed')).toBe(false);
  });

  it('stop() clears both timers', () => {
    const expired = insertRecipe(ctx.deps.db, 'Alt', '2026-08-01T10:00:00.000Z');
    const stopNow = startMaintenance(deps);
    expect(vi.getTimerCount()).toBe(2);
    stopNow();
    stopNow();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2 * HOUR);
    expect(exists(expired)).toBe(true);
  });

  it('does not keep the process alive (unref, NF-05)', () => {
    vi.useRealTimers();
    const refTimers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const before = refTimers();
    stop = startMaintenance(deps);
    expect(refTimers()).toBe(before);
  });
});

describe('image cleanup in the maintenance run (F-16, Kap. 4.6)', () => {
  const DAY = 24 * HOUR;
  const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs);

  function touch(dir: string, name: string, mtime: Date): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, name);
    fs.utimesSync(file, mtime, mtime);
    return file;
  }

  function insertImage(fileKey: string, createdAt: Date): void {
    ctx.deps.db
      .prepare(
        'INSERT INTO images(file_key, width, height, bytes_total, created_at) VALUES (?, 2048, 1365, 1, ?)',
      )
      .run(fileKey, createdAt.toISOString());
  }

  it('the first run cleans up images and tmp/ and the weekly sweep runs once', () => {
    const { images, imagesTrash, tmp } = ctx.deps.paths;
    insertImage('1111111111111111', at(-8 * DAY));
    const expired = touch(images, '1111111111111111-s.webp', at(-8 * DAY));
    const orphan = touch(images, '2222222222222222-m.webp', at(-2 * DAY));
    const oldTrash = touch(imagesTrash, '3333333333333333-l.webp', at(-15 * DAY));
    const leftover = touch(tmp, 'abc.upload', at(-2 * HOUR));

    stop = startMaintenance(deps, { intervalMs: HOUR });
    vi.advanceTimersByTime(FIRST_RUN_MS);

    expect(ctx.deps.db.prepare('SELECT count(*) FROM images').pluck().get()).toBe(0);
    expect(fs.existsSync(expired)).toBe(false);
    expect(fs.existsSync(path.join(imagesTrash, '1111111111111111-s.webp'))).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(path.join(imagesTrash, '2222222222222222-m.webp'))).toBe(true);
    expect(fs.existsSync(oldTrash)).toBe(false);
    expect(fs.existsSync(leftover)).toBe(false);
    expect(maintenanceLogs()).toEqual([
      expect.objectContaining({ level: 'info', imagesExpired: 1, imageTrashDeleted: 1, tmpDeleted: 1 }),
    ]);
    expect(maintenanceLogs()[0]).not.toHaveProperty('trashPurged');
    const sweeps = () => ctx.log.entries.filter((e) => e.msg === 'image sweep');
    expect(sweeps()).toEqual([expect.objectContaining({ trigger: 'weekly', orphansMoved: 1 })]);
    expect(getMeta(ctx.deps.db, SWEEP_META_KEY)).toBe(clock.toISOString());
    // The run counted what is left in images/.trash for /health: the two moved files (23 bytes each).
    expect(buildHealth(ctx.deps).bytes.images).toBe(46);

    vi.advanceTimersByTime(HOUR);
    expect(sweeps()).toHaveLength(1);
    expect(maintenanceLogs()).toHaveLength(1);
  });

  it('a failing trash purge does not stop the image cleanup', () => {
    const db = ctx.deps.db;
    insertRecipe(db, 'Alt', '2026-08-01T10:00:00.000Z');
    db.exec(`
      CREATE TRIGGER fail_purge BEFORE DELETE ON recipes
      BEGIN
        SELECT RAISE(ABORT, 'forced purge failure');
      END;
    `);
    const leftover = touch(ctx.deps.paths.tmp, 'abc.upload', at(-2 * HOUR));

    expect(() => runMaintenance(deps)).not.toThrow();

    expect(ctx.log.entries.filter((e) => e.msg === 'maintenance failed')).toEqual([
      expect.objectContaining({ level: 'error', task: 'trash' }),
    ]);
    expect(fs.existsSync(leftover)).toBe(false);
    expect(maintenanceLogs()).toEqual([expect.objectContaining({ tmpDeleted: 1 })]);
  });
});
