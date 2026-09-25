import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.ts';
import { allocateImageId, IMAGE_ID_COUNTER } from '../../server/db/repos/images.ts';
import { getMeta, setMeta } from '../../server/db/repos/meta.ts';
import type { DB } from '../../server/db/types.ts';
import { buildHealth } from '../../server/services/health.ts';
import {
  expireUnassignedImages,
  type ImageStartupDeps,
  isSweepDue,
  purgeImageTrash,
  purgeTmp,
  runImageStartup,
  SWEEP_META_KEY,
} from '../../server/services/image-cleanup.ts';
import { runMaintenance } from '../../server/services/maintenance.ts';
import type { AppDeps } from '../../server/types.ts';
import { normalize } from '../../shared/normalize.ts';
import type { RecipeResponse } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';
import { createTestDb } from '../helpers/db.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = new Date('2026-09-23T10:05:00.000Z');
const VARIANTS = ['s', 'm', 'l'] as const;

const KEY_A = '0123456789abcdef';
const KEY_B = 'fedcba9876543210';
const KEY_C = 'aaaaaaaaaaaaaaaa';

let ctx: TestContext;
let clock: Date;

beforeEach(() => {
  clock = T0;
  ctx = createTestContext({ now: () => clock });
});

afterEach(() => {
  vi.restoreAllMocks();
  ctx.cleanup();
});

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

function writeFile(dir: string, name: string, mtime: Date, content = name): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  fs.utimesSync(file, mtime, mtime);
  return file;
}

/** The three variant files of a key; the content is the variant letter. */
function writeVariants(dir: string, key: string, mtime: Date, variants: readonly string[] = VARIANTS): void {
  for (const v of variants) writeFile(dir, `${key}-${v}.webp`, mtime, v);
}

function variantNames(key: string): string[] {
  return VARIANTS.map((v) => `${key}-${v}.webp`).sort();
}

/** Sorted names of the regular files in a folder. */
function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

function mtimeOf(file: string): number {
  return fs.statSync(file).mtimeMs;
}

function insertRecipe(db: DB, title: string): number {
  return Number(
    db.prepare('INSERT INTO recipes(title, title_key) VALUES (?, ?)').run(title, normalize(title))
      .lastInsertRowid,
  );
}

function insertImage(db: DB, fileKey: string, createdAt: Date, recipeId: number | null = null): number {
  return Number(
    db
      .prepare(
        'INSERT INTO images(recipe_id, file_key, width, height, bytes_total, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(recipeId, fileKey, 2048, 1365, 350_000, createdAt.toISOString()).lastInsertRowid,
  );
}

function imageIds(db: DB = ctx.deps.db): number[] {
  return db.prepare('SELECT id FROM images ORDER BY id').pluck().all() as number[];
}

function logs(msg: string): Array<Record<string, unknown>> {
  return ctx.log.entries.filter((e) => e.msg === msg);
}

function startupDeps(overrides: Partial<ImageStartupDeps> = {}): ImageStartupDeps {
  return { ...ctx.deps, ...overrides };
}

const API = 'http://localhost:8080/api/v1';

async function call(
  app: ReturnType<typeof createApp>,
  profileId: number,
  method: string,
  url: string,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit = { method, headers: { ...CLIENT_HEADERS, 'X-Profile-Id': String(profileId) } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return app.request(`${API}${url}`, init);
}

interface Replacement {
  profileId: number;
  recipeId: number;
  oldImage: number;
  /** The database between saving and replacing, like last night's backup. */
  backup: Buffer;
}

/**
 * A recipe saved with image KEY_A (uploaded two days ago), whose image is then replaced by KEY_B
 * through PUT /recipes, as the editor does (Kap. 4.6): KEY_A's files move to images/.trash at T0.
 */
async function saveThenReplaceImage(): Promise<Replacement> {
  const { db, paths } = ctx.deps;
  const profileId = Number(
    db.prepare('INSERT INTO profiles(name, name_key) VALUES (?, ?)').run('Anna', 'anna').lastInsertRowid,
  );
  const oldImage = insertImage(db, KEY_A, at(-2 * DAY));
  writeVariants(paths.images, KEY_A, at(-2 * DAY));
  const created = await call(ctx.app, profileId, 'POST', '/recipes', {
    createKey: 'replace-scenario-1',
    title: 'Käsespätzle',
    imageId: oldImage,
  });
  expect(created.status).toBe(201);
  const recipeId = ((await created.json()) as RecipeResponse).recipe.id;

  const backup = db.serialize();
  const newImage = insertImage(db, KEY_B, T0);
  writeVariants(paths.images, KEY_B, T0);
  const replaced = await call(ctx.app, profileId, 'PUT', `/recipes/${recipeId}`, {
    title: 'Käsespätzle',
    version: 1,
    imageId: newImage,
  });
  expect(replaced.status).toBe(200);
  expect(files(paths.images)).toEqual(variantNames(KEY_B));
  expect(files(paths.imagesTrash)).toEqual(variantNames(KEY_A));
  return { profileId, recipeId, oldImage, backup };
}

describe('unassigned uploads (F-16, hourly)', () => {
  it('deletes never assigned uploads after 7 days and moves their files to images/.trash', () => {
    const { db, paths } = ctx.deps;
    const expired = insertImage(db, KEY_A, at(-7 * DAY));
    const young = insertImage(db, KEY_B, at(-7 * DAY + MINUTE));
    const recipe = insertRecipe(db, 'Pizza');
    const assigned = insertImage(db, KEY_C, at(-60 * DAY), recipe);
    writeVariants(paths.images, KEY_A, at(-7 * DAY));
    writeVariants(paths.images, KEY_B, at(-7 * DAY));
    writeVariants(paths.images, KEY_C, at(-60 * DAY));

    runMaintenance(ctx.deps);

    expect(imageIds()).toEqual([young, assigned]);
    expect(imageIds()).not.toContain(expired);
    expect(files(paths.images)).toEqual([...variantNames(KEY_C), ...variantNames(KEY_B)].sort());
    expect(files(paths.imagesTrash)).toEqual(variantNames(KEY_A));
    // The 14-day retention in images/.trash starts with the move, not with the upload.
    expect(mtimeOf(path.join(paths.imagesTrash, `${KEY_A}-l.webp`))).toBe(T0.getTime());
    expect(fs.readFileSync(path.join(paths.imagesTrash, `${KEY_A}-m.webp`), 'utf8')).toBe('m');
    expect(logs('maintenance')).toEqual([expect.objectContaining({ level: 'info', imagesExpired: 1 })]);
  });

  it('also deletes a row whose files are already gone, without a warning', () => {
    const { db, paths } = ctx.deps;
    insertImage(db, KEY_A, at(-30 * DAY));
    writeVariants(paths.images, KEY_A, at(-30 * DAY), ['s']);

    expect(expireUnassignedImages(ctx.deps)).toBe(1);
    expect(imageIds()).toEqual([]);
    expect(files(paths.imagesTrash)).toEqual([`${KEY_A}-s.webp`]);
    expect(ctx.log.entries.filter((e) => e.level === 'warn')).toEqual([]);
  });

  it('keeps the ids of expired uploads reserved, also for rows written without the counter', () => {
    const { db } = ctx.deps;
    db.prepare(
      "INSERT INTO images(id, file_key, width, height, bytes_total, created_at) VALUES (17, ?, 600, 400, 1, '2026-09-01T00:00:00.000Z')",
    ).run(KEY_A);
    expect(getMeta(db, IMAGE_ID_COUNTER)).toBeNull();

    expect(expireUnassignedImages(ctx.deps)).toBe(1);
    expect(imageIds()).toEqual([]);
    // The table is empty, but 17 is never handed out again.
    expect(getMeta(db, IMAGE_ID_COUNTER)).toBe('17');
    expect(db.transaction(() => allocateImageId(db))()).toBe(18);
  });

  it('never turns an invalid file key into a path outside images/', () => {
    const { db, paths } = ctx.deps;
    const badKey = `..${path.sep}escape`;
    insertImage(db, badKey, at(-30 * DAY));
    const outside = writeFile(paths.dataDir, 'escape-s.webp', at(-30 * DAY));

    expect(expireUnassignedImages(ctx.deps)).toBe(1);
    expect(fs.existsSync(outside)).toBe(true);
    expect(files(paths.imagesTrash)).toEqual([]);
    expect(logs('invalid image file key skipped')).toEqual([
      expect.objectContaining({ level: 'warn', fileKey: badKey }),
    ]);
  });
});

describe('images/.trash (F-16, hourly)', () => {
  it('replaced image files leave images/.trash after BACKUP_KEEP = 14 days', async () => {
    const { paths } = ctx.deps;
    expect(ctx.deps.config.backupKeep).toBe(14);
    await saveThenReplaceImage();

    clock = at(14 * DAY - MINUTE);
    runMaintenance(ctx.deps);
    expect(files(paths.imagesTrash)).toEqual(variantNames(KEY_A));

    clock = at(14 * DAY);
    runMaintenance(ctx.deps);
    expect(files(paths.imagesTrash)).toEqual([]);
    // Only the three new files are left for the recipe.
    expect(files(paths.images)).toEqual(variantNames(KEY_B));
    expect(logs('maintenance')).toEqual([expect.objectContaining({ imageTrashDeleted: 3 })]);
  });

  it('uses BACKUP_KEEP from the configuration', () => {
    const { paths } = ctx.deps;
    ctx.deps.config.backupKeep = 3;
    writeVariants(paths.imagesTrash, KEY_A, at(-3 * DAY));
    writeVariants(paths.imagesTrash, KEY_B, at(-3 * DAY + MINUTE));

    expect(purgeImageTrash(ctx.deps)).toBe(3);
    expect(files(paths.imagesTrash)).toEqual(variantNames(KEY_B));
  });

  it('counts what stays in images/.trash for /health, so /health never lists the folder', () => {
    const { db, paths } = ctx.deps;
    const recipe = insertRecipe(db, 'Pizza');
    insertImage(db, KEY_A, at(-60 * DAY), recipe); // bytes_total 350,000
    writeFile(paths.imagesTrash, `${KEY_A}-l.webp`, at(-30 * DAY), 'x'.repeat(100)); // referenced: kept
    writeFile(paths.imagesTrash, `${KEY_B}-l.webp`, at(-30 * DAY), 'x'.repeat(1000)); // expired: deleted
    writeFile(paths.imagesTrash, `${KEY_C}-m.webp`, at(-DAY), 'x'.repeat(10)); // young: kept
    expect(buildHealth(ctx.deps).bytes.images).toBe(350_000);

    expect(purgeImageTrash(ctx.deps)).toBe(1);
    expect(buildHealth(ctx.deps).bytes.images).toBe(350_110);
  });

  it('keeps a file that an images row still references and warns once', () => {
    const { db, paths } = ctx.deps;
    insertImage(db, KEY_A, at(-60 * DAY), insertRecipe(db, 'Pizza'));
    writeVariants(paths.imagesTrash, KEY_A, at(-30 * DAY));
    writeVariants(paths.imagesTrash, KEY_B, at(-30 * DAY));

    expect(purgeImageTrash(ctx.deps)).toBe(3);
    expect(files(paths.imagesTrash)).toEqual(variantNames(KEY_A));
    expect(logs('referenced image files kept in images/.trash')).toEqual([
      expect.objectContaining({ level: 'warn', count: 3 }),
    ]);
  });
});

describe('tmp/ (Kap. 4.6, hourly)', () => {
  it('deletes leftovers of interrupted uploads older than 1 hour', () => {
    const { paths } = ctx.deps;
    writeFile(paths.tmp, 'old.upload', at(-HOUR));
    writeFile(paths.tmp, 'running.upload', at(-HOUR + MINUTE));
    const job = path.join(paths.tmp, 'job-1');
    writeFile(job, `${KEY_A}-l.webp`, at(-2 * HOUR));
    fs.utimesSync(job, at(-2 * HOUR), at(-2 * HOUR));

    runMaintenance(ctx.deps);

    expect(fs.readdirSync(paths.tmp)).toEqual(['running.upload']);
    expect(logs('maintenance')).toEqual([expect.objectContaining({ tmpDeleted: 2 })]);
  });

  it('treats a missing tmp/ as empty', () => {
    fs.rmSync(ctx.deps.paths.tmp, { recursive: true });
    expect(purgeTmp(ctx.deps)).toBe(0);
  });
});

describe('weekly sweep (F-16)', () => {
  it('moves files without an images row to images/.trash and logs their count', () => {
    const { db, paths } = ctx.deps;
    insertImage(db, KEY_A, at(-60 * DAY), insertRecipe(db, 'Pizza'));
    writeVariants(paths.images, KEY_A, at(-60 * DAY));
    writeVariants(paths.images, KEY_B, at(-2 * DAY)); // orphan
    writeVariants(paths.images, KEY_C, at(-30 * MINUTE)); // upload in progress: row not written yet
    writeFile(paths.images, 'Thumbs.db', at(-60 * DAY));
    writeFile(paths.images, 'ABCDEF0123456789-s.webp', at(-60 * DAY));
    writeFile(paths.images, `${KEY_B}-xl.webp`, at(-60 * DAY));

    runMaintenance(ctx.deps);

    expect(files(paths.imagesTrash)).toEqual(variantNames(KEY_B));
    expect(mtimeOf(path.join(paths.imagesTrash, `${KEY_B}-s.webp`))).toBe(T0.getTime());
    expect(files(paths.images)).toEqual(
      [
        ...variantNames(KEY_A),
        ...variantNames(KEY_C),
        'Thumbs.db',
        'ABCDEF0123456789-s.webp',
        `${KEY_B}-xl.webp`,
      ].sort(),
    );
    expect(logs('image sweep')).toEqual([
      expect.objectContaining({ level: 'info', trigger: 'weekly', orphansMoved: 3, restoredImages: 0 }),
    ]);
    expect(logs('unknown files in images/ left alone')).toEqual([
      expect.objectContaining({ level: 'warn', count: 3 }),
    ]);
    expect(getMeta(db, SWEEP_META_KEY)).toBe(T0.toISOString());
  });

  it('runs once a week, tracked in meta.image_sweep_at', () => {
    const { db, paths } = ctx.deps;
    runMaintenance(ctx.deps);
    expect(logs('image sweep')).toHaveLength(1);

    writeVariants(paths.images, KEY_B, at(-DAY));
    clock = at(HOUR);
    runMaintenance(ctx.deps);
    clock = at(7 * DAY - MINUTE);
    runMaintenance(ctx.deps);
    expect(logs('image sweep')).toHaveLength(1);
    expect(files(paths.images)).toEqual(variantNames(KEY_B));

    clock = at(7 * DAY);
    runMaintenance(ctx.deps);
    expect(logs('image sweep')).toHaveLength(2);
    expect(files(paths.images)).toEqual([]);
    expect(getMeta(db, SWEEP_META_KEY)).toBe(at(7 * DAY).toISOString());
  });

  it('is due when never run, a week old, unreadable or in the future', () => {
    expect(isSweepDue(null, T0)).toBe(true);
    expect(isSweepDue(at(-7 * DAY).toISOString(), T0)).toBe(true);
    expect(isSweepDue(at(-7 * DAY + 1).toISOString(), T0)).toBe(false);
    expect(isSweepDue('kaputt', T0)).toBe(true);
    // A clock that was set to the future and then corrected must not block the sweep for years.
    expect(isSweepDue(at(DAY).toISOString(), T0)).toBe(true);
  });

  it('also brings referenced files back from images/.trash', () => {
    const { db, paths } = ctx.deps;
    const id = insertImage(db, KEY_A, at(-60 * DAY), insertRecipe(db, 'Pizza'));
    writeVariants(paths.imagesTrash, KEY_A, at(-DAY));

    runMaintenance(ctx.deps);

    expect(imageIds()).toEqual([id]);
    expect(files(paths.images)).toEqual(variantNames(KEY_A));
    expect(files(paths.imagesTrash)).toEqual([]);
    expect(logs('image sweep')).toEqual([expect.objectContaining({ restoredImages: 1, restoredFiles: 3 })]);
  });
});

describe('start: recovery from images/.trash (F-16, Kap. 10.9)', () => {
  it('restoring yesterday’s database backup makes a replaced image visible again', async () => {
    const { paths } = ctx.deps;
    const { profileId, recipeId, oldImage, backup } = await saveThenReplaceImage();

    // Next day: the backup is restored and the server starts.
    clock = at(DAY);
    const restored = new Database(backup);
    try {
      restored.pragma('foreign_keys = ON');
      const deps: AppDeps = { ...ctx.deps, db: restored };
      runImageStartup(deps);

      expect(files(paths.images)).toEqual(variantNames(KEY_A));
      // The newer image has no row in the restored database: it waits in images/.trash (14 days).
      expect(files(paths.imagesTrash)).toEqual(variantNames(KEY_B));
      expect(logs('image sweep')).toEqual([
        expect.objectContaining({
          level: 'info',
          trigger: 'startup',
          restoredImages: 1,
          restoredFiles: 3,
          missingImages: 0,
          orphansMoved: 3,
        }),
      ]);
      expect(getMeta(restored, SWEEP_META_KEY)).toBe(at(DAY).toISOString());

      const detail = await call(createApp(deps), profileId, 'GET', `/recipes/${recipeId}`);
      const image = ((await detail.json()) as RecipeResponse).recipe.image;
      expect(image?.id).toBe(oldImage);
      expect(image?.urls.l).toBe(`/media/${KEY_A}-l.webp`);
      for (const url of Object.values(image?.urls ?? {})) {
        expect(fs.existsSync(path.join(paths.images, path.basename(url)))).toBe(true);
      }
    } finally {
      restored.close();
    }
  });

  it('restores single variants and logs images missing everywhere with their id', () => {
    const { db, paths } = ctx.deps;
    const partial = insertImage(db, KEY_A, at(-DAY), insertRecipe(db, 'Pizza'));
    const gone = insertImage(db, KEY_B, at(-DAY));
    const complete = insertImage(db, KEY_C, at(-DAY));
    writeVariants(paths.images, KEY_A, at(-DAY), ['s', 'm']);
    writeVariants(paths.imagesTrash, KEY_A, at(-DAY), ['l']);
    writeVariants(paths.images, KEY_B, at(-DAY), ['s']);
    writeVariants(paths.images, KEY_C, at(-DAY));

    runImageStartup(startupDeps());

    expect(imageIds()).toEqual([partial, gone, complete]);
    expect(files(paths.images)).toEqual(
      [...variantNames(KEY_A), `${KEY_B}-s.webp`, ...variantNames(KEY_C)].sort(),
    );
    expect(files(paths.imagesTrash)).toEqual([]);
    expect(logs('image files missing')).toEqual([
      expect.objectContaining({ level: 'warn', count: 1, imageIds: [gone] }),
    ]);
    expect(logs('image sweep')).toEqual([
      expect.objectContaining({ restoredImages: 1, restoredFiles: 1, missingImages: 1, orphansMoved: 0 }),
    ]);
  });

  it('also cleans up tmp/ and counts as this week’s sweep', () => {
    const { db, paths } = ctx.deps;
    writeFile(paths.tmp, 'crashed.upload', at(-3 * HOUR));

    runImageStartup(startupDeps());
    expect(files(paths.tmp)).toEqual([]);
    expect(logs('tmp cleaned')).toEqual([expect.objectContaining({ entries: 1 })]);

    clock = at(5_000);
    runMaintenance(ctx.deps);
    expect(logs('image sweep')).toHaveLength(1);
    expect(getMeta(db, SWEEP_META_KEY)).toBe(T0.toISOString());
  });
});

describe('read-only mode (NF-19)', () => {
  it('skips the start step and every maintenance step', () => {
    const { db, paths } = ctx.deps;
    insertImage(db, KEY_A, at(-60 * DAY));
    writeVariants(paths.imagesTrash, KEY_A, at(-60 * DAY));
    writeVariants(paths.images, KEY_B, at(-60 * DAY));
    writeFile(paths.tmp, 'old.upload', at(-DAY));

    runImageStartup(startupDeps({ state: { db: 'corrupt' } }));
    runMaintenance({ ...ctx.deps, state: { db: 'corrupt' } });

    expect(imageIds()).toHaveLength(1);
    expect(files(paths.imagesTrash)).toEqual(variantNames(KEY_A));
    expect(files(paths.images)).toEqual(variantNames(KEY_B));
    expect(files(paths.tmp)).toEqual(['old.upload']);
    expect(getMeta(db, SWEEP_META_KEY)).toBeNull();
    expect(logs('image recovery skipped: read-only database')).toHaveLength(1);
    expect(logs('image sweep')).toEqual([]);
  });
});

describe('errors are logged, never thrown', () => {
  it('a failing step is logged and the other steps still run', () => {
    const { db, paths } = ctx.deps;
    const id = insertImage(db, KEY_A, at(-30 * DAY));
    writeVariants(paths.images, KEY_A, at(-30 * DAY));
    writeFile(paths.tmp, 'old.upload', at(-DAY));
    db.exec(`
      CREATE TRIGGER fail_image_delete BEFORE DELETE ON images
      BEGIN
        SELECT RAISE(ABORT, 'forced image failure');
      END;
    `);

    expect(() => runMaintenance(ctx.deps)).not.toThrow();

    expect(imageIds()).toEqual([id]);
    expect(files(paths.images)).toEqual(variantNames(KEY_A));
    expect(logs('maintenance failed')).toEqual([
      expect.objectContaining({ level: 'error', task: 'images-unassigned' }),
    ]);
    expect(files(paths.tmp)).toEqual([]);
    expect(logs('maintenance')).toEqual([expect.objectContaining({ tmpDeleted: 1 })]);
  });

  it('an unusable folder fails only its own step; the sweep is retried next hour', () => {
    const { db, paths } = ctx.deps;
    fs.rmSync(paths.tmp, { recursive: true });
    fs.writeFileSync(paths.tmp, 'not a folder');
    vi.spyOn(fs, 'readdirSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('access denied'), { code: 'EACCES' });
    });
    insertImage(db, KEY_A, at(-DAY), insertRecipe(db, 'Pizza'));

    expect(() => runMaintenance(ctx.deps)).not.toThrow();

    const tasks = logs('maintenance failed').map((e) => e.task);
    expect(tasks).toEqual(['image-sweep', 'tmp']);
    expect(getMeta(db, SWEEP_META_KEY)).toBeNull();

    vi.restoreAllMocks();
    clock = at(HOUR);
    runMaintenance(ctx.deps);
    expect(logs('image sweep')).toHaveLength(1);
    expect(getMeta(db, SWEEP_META_KEY)).toBe(at(HOUR).toISOString());
  });

  it('a file that cannot be moved produces one warning, not an exception', () => {
    const { paths } = ctx.deps;
    writeVariants(paths.images, KEY_B, at(-DAY));
    fs.rmSync(paths.imagesTrash, { recursive: true });
    fs.writeFileSync(paths.imagesTrash, 'not a folder');

    expect(() => runMaintenance(ctx.deps)).not.toThrow();
    expect(files(paths.images)).toContain(`${KEY_B}-s.webp`);
    expect(logs('moving orphan image files failed')).toEqual([
      expect.objectContaining({ level: 'warn', failed: 3 }),
    ]);
  });

  it('the start step logs a broken database instead of stopping the start', () => {
    const closed = createTestDb();
    closed.close();
    writeFile(ctx.deps.paths.tmp, 'old.upload', at(-DAY));

    expect(() => runImageStartup(startupDeps({ db: closed }))).not.toThrow();
    expect(logs('image recovery failed')).toEqual([expect.objectContaining({ level: 'error' })]);
    expect(files(ctx.deps.paths.tmp)).toEqual([]);
  });
});

describe('file moves', () => {
  it('fall back to copy and delete across volumes (EXDEV)', () => {
    const { paths } = ctx.deps;
    writeVariants(paths.images, KEY_B, at(-DAY));
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
    });

    runMaintenance(ctx.deps);

    expect(rename).toHaveBeenCalledTimes(3);
    expect(files(paths.images)).toEqual([]);
    expect(files(paths.imagesTrash)).toEqual(variantNames(KEY_B));
    expect(fs.readFileSync(path.join(paths.imagesTrash, `${KEY_B}-l.webp`), 'utf8')).toBe('l');
    expect(mtimeOf(path.join(paths.imagesTrash, `${KEY_B}-l.webp`))).toBe(T0.getTime());
  });

  it('never touch files outside images/, images/.trash and tmp/', () => {
    const { db, paths } = ctx.deps;
    const outside = [
      writeFile(paths.dataDir, `${KEY_B}-s.webp`, at(-60 * DAY)),
      writeFile(paths.backups, 'rezepte-2026-07-01.sqlite', at(-60 * DAY)),
      writeFile(paths.logs, 'app.1.log', at(-60 * DAY)),
    ];
    insertImage(db, `..${path.sep}${KEY_B}`, at(-DAY), insertRecipe(db, 'Pizza'));
    setMeta(db, SWEEP_META_KEY, 'kaputt');

    runImageStartup(startupDeps());
    clock = at(60 * DAY);
    runMaintenance(ctx.deps);

    for (const file of outside) expect(fs.existsSync(file)).toBe(true);
  });
});
