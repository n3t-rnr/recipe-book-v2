import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reindexRecipe } from '../../server/db/fts.ts';
import type { DB } from '../../server/db/types.ts';
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
