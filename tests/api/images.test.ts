import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getMeta } from '../../server/db/repos/meta.ts';
import { LOW_DISK_BYTES } from '../../server/services/health.ts';
import { expireUnassignedImages } from '../../server/services/image-cleanup.ts';
import { configureImageService, HEIC_HINT, type ImageJobInfo } from '../../server/services/images.ts';
import type { ErrorBody } from '../../shared/error-codes.ts';
import { normalize } from '../../shared/normalize.ts';
import type { ImageInfo, ImageUploadResponse, RecipeResponse } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';
import {
  corruptJpeg,
  countingStream,
  exifHasGps,
  heicProbe,
  oversizedPngHeader,
  PDF_AS_JPG,
  padJpeg,
  photoPng,
  pngWithAlpha,
  portraitPhoto12mp,
  progressiveJpeg,
  sideColour,
  smallJpeg,
  webpImage,
} from '../helpers/images.ts';

const API = 'http://localhost:8080/api/v1';
const SLOW = 30_000;

let ctx: TestContext;
let profileId: number;

beforeEach(() => {
  ctx = createTestContext();
  profileId = Number(
    ctx.deps.db.prepare('INSERT INTO profiles(name, name_key) VALUES (?, ?)').run('Anna', normalize('Anna'))
      .lastInsertRowid,
  );
});

afterEach(() => {
  ctx.cleanup();
});

interface UploadOptions {
  contentType?: string;
  /** Defaults to Anna; null sends no X-Profile-Id. */
  profileId?: number | null;
  headers?: Record<string, string>;
}

async function upload(
  body: Uint8Array | ReadableStream<Uint8Array>,
  options: UploadOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...CLIENT_HEADERS,
    'Content-Type': options.contentType ?? 'image/jpeg',
    ...options.headers,
  };
  const id = options.profileId === undefined ? profileId : options.profileId;
  if (id !== null) headers['X-Profile-Id'] = String(id);
  const init: RequestInit & { duplex?: 'half' } = { method: 'POST', headers, body };
  if (body instanceof ReadableStream) init.duplex = 'half';
  return await ctx.app.request(`${API}/images`, init);
}

async function errorOf(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

function listDir(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

function imageRows(): Array<{ id: number; recipe_id: number | null; file_key: string; bytes_total: number }> {
  return ctx.deps.db
    .prepare('SELECT id, recipe_id, file_key, bytes_total FROM images ORDER BY id')
    .all() as Array<{
    id: number;
    recipe_id: number | null;
    file_key: string;
    bytes_total: number;
  }>;
}

function variantFile(url: string): string {
  return path.join(ctx.deps.paths.images, url.slice('/media/'.length));
}

/** Nothing of a rejected upload may remain: no variant, no temp file, no row. */
function expectNothingStored(): void {
  expect(listDir(ctx.deps.paths.images)).toEqual([]);
  expect(listDir(ctx.deps.paths.tmp)).toEqual([]);
  expect(imageRows()).toEqual([]);
}

let portrait: Buffer;

beforeAll(async () => {
  portrait = await portraitPhoto12mp();
}, SLOW);

describe('POST /api/v1/images – accepted uploads (F-14, F-15)', () => {
  it(
    'accepts an 8 MB JPEG: three variants in images/, an unassigned row, no temp files, one log line',
    async () => {
      const body = padJpeg(portrait, 8 * 1024 * 1024);
      expect(body.length).toBeGreaterThanOrEqual(8 * 1024 * 1024);
      const revisionBefore = Number(
        ctx.deps.db.prepare("SELECT value FROM meta WHERE key = 'data_revision'").pluck().get(),
      );

      const res = await upload(body);
      expect(res.status).toBe(201);
      const image = (await res.json()) as ImageUploadResponse;
      const key = /^\/media\/([0-9a-f]{16})-s\.webp$/.exec(image.urls.s)?.[1];
      expect(key).toBeDefined();
      expect(image).toEqual({
        imageId: expect.any(Number),
        urls: { s: `/media/${key}-s.webp`, m: `/media/${key}-m.webp`, l: `/media/${key}-l.webp` },
        width: 1536,
        height: 2048,
      });

      expect(listDir(ctx.deps.paths.images)).toEqual([`${key}-l.webp`, `${key}-m.webp`, `${key}-s.webp`]);
      expect(listDir(ctx.deps.paths.tmp)).toEqual([]);
      const sizes = ['s', 'm', 'l'].map(
        (v) => fs.statSync(path.join(ctx.deps.paths.images, `${key}-${v}.webp`)).size,
      );
      expect(imageRows()).toEqual([
        { id: image.imageId, recipe_id: null, file_key: key, bytes_total: sizes.reduce((a, b) => a + b, 0) },
      ]);
      const createdAt = ctx.deps.db.prepare('SELECT created_at FROM images').pluck().get();
      expect(createdAt).toBe('2026-09-23T10:05:00.000Z');

      // A successful upload is a write: open clients learn about it (F-36).
      expect(res.headers.get('X-Data-Revision')).toBe(String(revisionBefore + 1));

      // NF-05 evidence in the log.
      const lines = ctx.log.entries.filter((e) => e.msg === 'image processed');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 'info',
        imageId: image.imageId,
        inputBytes: body.length,
        outputBytes: { s: sizes[0], m: sizes[1], l: sizes[2] },
        width: 1536,
        height: 2048,
        exclusive: false,
        durationMs: expect.any(Number),
        rssMb: expect.any(Number),
        maxRssMb: expect.any(Number),
      });
      // The sampled peak is a real RSS and never above the peak the OS reports for the process.
      const rssMb = Number(lines[0]?.rssMb);
      const maxRssMb = Number(lines[0]?.maxRssMb);
      expect(rssMb).toBeGreaterThan(0);
      expect(rssMb).toBeLessThanOrEqual(maxRssMb + 1);
    },
    SLOW,
  );

  it(
    '12-MP portrait with EXIF orientation 6 and GPS: upright variants without metadata, within the size budget',
    async () => {
      const source = await sharp(portrait).metadata();
      expect({ width: source.width, height: source.height, orientation: source.orientation }).toEqual({
        width: 4000,
        height: 3000,
        orientation: 6,
      });
      expect(exifHasGps(source.exif)).toBe(true);

      const res = await upload(portrait);
      expect(res.status).toBe(201);
      const image = (await res.json()) as ImageUploadResponse;

      const files = {
        s: fs.readFileSync(variantFile(image.urls.s)),
        m: fs.readFileSync(variantFile(image.urls.m)),
        l: fs.readFileSync(variantFile(image.urls.l)),
      };
      const meta = {
        s: await sharp(files.s).metadata(),
        m: await sharp(files.m).metadata(),
        l: await sharp(files.l).metadata(),
      };
      expect([meta.s.format, meta.m.format, meta.l.format]).toEqual(['webp', 'webp', 'webp']);
      // l: long edge 2048, m: long edge 1200, both portrait; s: exactly the card size.
      expect({ width: meta.l.width, height: meta.l.height }).toEqual({ width: 1536, height: 2048 });
      expect({ width: meta.m.width, height: meta.m.height }).toEqual({ width: 900, height: 1200 });
      expect({ width: meta.s.width, height: meta.s.height }).toEqual({ width: 720, height: 480 });
      for (const variant of ['s', 'm', 'l'] as const) {
        const { width, height, exif, icc, xmp, orientation } = meta[variant];
        // Upright: the photo's left half is red, the right half blue.
        expect(await sideColour(files[variant], 5, Math.floor(height / 2)), variant).toBe('red');
        expect(await sideColour(files[variant], width - 6, Math.floor(height / 2)), variant).toBe('blue');
        expect({ exif, icc, xmp, orientation }, variant).toEqual({
          exif: undefined,
          icc: undefined,
          xmp: undefined,
          orientation: undefined,
        });
      }
      // F-15 AK size budget of the start values.
      expect(files.s.length).toBeLessThanOrEqual(60 * 1024);
      expect(files.m.length).toBeLessThanOrEqual(200 * 1024);
      expect(files.l.length).toBeLessThanOrEqual(600 * 1024);
    },
    SLOW,
  );

  it('never enlarges a small photo', async () => {
    const res = await upload(await smallJpeg(300, 200));
    expect(res.status).toBe(201);
    const image = (await res.json()) as ImageUploadResponse;
    expect({ width: image.width, height: image.height }).toEqual({ width: 300, height: 200 });
    for (const url of Object.values(image.urls)) {
      const meta = await sharp(variantFile(url)).metadata();
      expect({ width: meta.width, height: meta.height }).toEqual({ width: 300, height: 200 });
    }
  });

  it('accepts PNG with transparency and WebP, whatever Content-Type the client sends', async () => {
    const png = await upload(await pngWithAlpha(), { contentType: 'application/octet-stream' });
    expect(png.status).toBe(201);
    const pngImage = (await png.json()) as ImageUploadResponse;
    expect((await sharp(variantFile(pngImage.urls.l)).metadata()).hasAlpha).toBe(true);

    const webp = await upload(await webpImage(), { contentType: 'image/png' });
    expect(webp.status).toBe(201);
    const webpImageBody = (await webp.json()) as ImageUploadResponse;
    expect({ width: webpImageBody.width, height: webpImageBody.height }).toEqual({ width: 640, height: 480 });
    expect(imageRows()).toHaveLength(2);
  });
});

describe('POST /api/v1/images – rejected uploads (F-14, F-15, NF-21, NF-24)', () => {
  it('stops reading a streamed body after 20 MiB with 413 and leaves no temp file', async () => {
    const body = countingStream(25 * 1024 * 1024);
    const res = await upload(body.stream);
    expect(res.status).toBe(413);
    const error = await errorOf(res);
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(error.message).toBe('Bild zu groß (max. 20 MB)');
    expect(error.details).toEqual({ reason: 'size', maxBytes: 20_971_520 });
    expect(body.pulled).toBeLessThanOrEqual(20_971_520 + 1024 * 1024);
    expect(body.cancelled).toBe(true);
    expectNothingStored();
  });

  it('refuses a Content-Length over 20 MiB with 413 before reading the body', async () => {
    const body = countingStream(20_971_521);
    const res = await upload(body.stream, { headers: { 'Content-Length': '20971521' } });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).message).toBe('Bild zu groß (max. 20 MB)');
    expect(body.pulled).toBe(0);
    expectNothingStored();
  });

  it('accepts exactly 20 MiB as far as the size goes', async () => {
    // Magic bytes of a JPEG, then filler: passes the byte limit, fails later as unreadable.
    const body = countingStream(20_971_520);
    const res = await upload(body.stream, { headers: { 'Content-Length': '20971520' } });
    expect(res.status).toBe(415);
    expect((await errorOf(res)).message).toBe('Bild konnte nicht gelesen werden');
    expect(body.pulled).toBe(20_971_520);
    expectNothingStored();
  });

  it('rejects a PDF saved as .jpg with 415 "Nur JPEG, PNG oder WebP"', async () => {
    const res = await upload(PDF_AS_JPG);
    expect(res.status).toBe(415);
    const error = await errorOf(res);
    expect(error).toMatchObject({
      code: 'UNSUPPORTED_MEDIA',
      message: 'Nur JPEG, PNG oder WebP',
      details: { reason: 'type' },
    });
    expectNothingStored();
  });

  it('rejects HEIC/HEIF with 415, reason "heic" and the hint for iPhone and Android', async () => {
    const res = await upload(heicProbe(), { contentType: 'application/octet-stream' });
    expect(res.status).toBe(415);
    const error = await errorOf(res);
    expect(error.code).toBe('UNSUPPORTED_MEDIA');
    expect(error.details).toEqual({ reason: 'heic' });
    expect(error.message).toBe(HEIC_HINT);
    expect(error.message).toBe(
      'Bitte als JPEG speichern – iPhone: Einstellungen > Kamera > Formate > Maximale Kompatibilität; Android: in der Kamera-App HEIF ausschalten',
    );
    expectNothingStored();
  });

  it('rejects a corrupt JPEG with 415 "Bild konnte nicht gelesen werden"', async () => {
    const res = await upload(corruptJpeg());
    expect(res.status).toBe(415);
    expect(await errorOf(res)).toMatchObject({
      code: 'UNSUPPORTED_MEDIA',
      message: 'Bild konnte nicht gelesen werden',
      details: { reason: 'unreadable' },
    });
    // The log keeps sharp's own reason for the diagnosis on the server PC.
    expect(ctx.log.entries.find((e) => e.msg === 'image rejected')).toMatchObject({
      code: 'UNSUPPORTED_MEDIA',
      message: 'Bild konnte nicht gelesen werden',
      cause: expect.stringMatching(/jpeg/i),
    });
    expectNothingStored();
  });

  it('rejects an image over 60 MP with 413 from its header alone', async () => {
    const res = await upload(oversizedPngHeader(10_000, 7_000), { contentType: 'image/png' });
    expect(res.status).toBe(413);
    const error = await errorOf(res);
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(error.message).toBe('Bild hat zu viele Pixel (max. 60 MP)');
    expect(error.details).toEqual({ reason: 'pixels', maxPixels: 60_000_000 });
    expectNothingStored();
  });

  it(
    'rejects a progressive 4:4:4 JPEG over 10 MP with 413 before decoding it (NF-05)',
    async () => {
      // 4001 × 2500 = 10,002,500 pixels: over 60 MB of DCT coefficients plus the rest of the job.
      const res = await upload(await progressiveJpeg(4001, 2500));
      expect(res.status).toBe(413);
      expect(await errorOf(res)).toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
        message:
          'Progressives JPEG hat zu viele Pixel (max. 10 MP) – bitte verkleinern oder als normales JPEG speichern',
        details: { reason: 'pixels', maxPixels: 10_000_000, decode: 'progressive-jpeg' },
      });
      expect(ctx.log.entries.some((e) => e.msg === 'image processed')).toBe(false);
      expectNothingStored();
    },
    SLOW,
  );

  it(
    'accepts a progressive JPEG at the limit and processes it alone',
    async () => {
      const res = await upload(await progressiveJpeg(4000, 2500));
      expect(res.status).toBe(201);
      expect(((await res.json()) as ImageUploadResponse).width).toBe(2048);
      expect(ctx.log.entries.find((e) => e.msg === 'image processed')).toMatchObject({
        exclusive: true,
        rssMb: expect.any(Number),
        maxRssMb: expect.any(Number),
      });
    },
    SLOW,
  );

  it('rejects an empty body with 400', async () => {
    const res = await upload(new Uint8Array(0));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).toBe('Kein Bild übertragen');
    expectNothingStored();
  });

  it('needs an active profile (401) and does not bump the data revision on errors', async () => {
    const before = await ctx.app.request(`${API}/revision`, { headers: { Host: 'localhost:8080' } });
    const revision = before.headers.get('X-Data-Revision');

    const missing = await upload(await smallJpeg(), { profileId: null });
    expect(missing.status).toBe(401);
    expect((await errorOf(missing)).code).toBe('PROFILE_REQUIRED');
    const unknown = await upload(await smallJpeg(), { profileId: 999 });
    expect(unknown.status).toBe(401);
    expect((await errorOf(unknown)).code).toBe('PROFILE_UNKNOWN');
    const rejected = await upload(PDF_AS_JPG);
    expect(rejected.headers.get('X-Data-Revision')).toBe(revision);
    expectNothingStored();
  });

  it('answers 503 IMAGES_UNAVAILABLE when sharp is not loaded (NF-24)', async () => {
    ctx.deps.state.images = 'unavailable';
    const res = await upload(await smallJpeg());
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toMatchObject({
      code: 'IMAGES_UNAVAILABLE',
      message: 'Bildverarbeitung nicht verfügbar',
    });
    expectNothingStored();
  });

  it('answers 503 when sharp fails to load on first use', async () => {
    configureImageService(ctx.deps, { loadSharp: () => Promise.reject(new Error('libvips fehlt')) });
    const res = await upload(await smallJpeg());
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('IMAGES_UNAVAILABLE');
    expect(ctx.log.entries.some((e) => e.msg === 'sharp konnte nicht geladen werden')).toBe(true);
    expectNothingStored();
  });

  it('answers 507 when less than 200 MB are free in DATA_DIR (NF-24)', async () => {
    const seen: string[] = [];
    configureImageService(ctx.deps, {
      freeDiskBytes: (dir) => {
        seen.push(dir);
        return LOW_DISK_BYTES - 1;
      },
    });
    const res = await upload(await smallJpeg());
    expect(res.status).toBe(507);
    expect(await errorOf(res)).toMatchObject({ code: 'INSUFFICIENT_STORAGE' });
    expect(seen).toEqual([ctx.deps.paths.dataDir]);
    expectNothingStored();

    configureImageService(ctx.deps, { freeDiskBytes: () => LOW_DISK_BYTES });
    expect((await upload(await smallJpeg())).status).toBe(201);
  });

  it(
    'leaves no variant and no row when writing the third variant fails (F-15 AK)',
    async () => {
      const written: string[] = [];
      configureImageService(ctx.deps, {
        hooks: {
          writeVariant: async (file, data, variant) => {
            written.push(variant);
            if (written.length === 3) throw new Error('Datenträger voll (simuliert)');
            await fs.promises.writeFile(file, data);
          },
        },
      });
      const res = await upload(await smallJpeg(900, 600));
      expect(res.status).toBe(500);
      expect((await errorOf(res)).code).toBe('INTERNAL');
      expect(written).toEqual(['l', 'm', 's']);
      expectNothingStored();
    },
    SLOW,
  );
});

describe('POST /api/v1/images – queue (NF-05)', () => {
  it('processes at most two uploads at a time; the third waits for a free slot', async () => {
    const release: Array<() => void> = [];
    let running = 0;
    let maxRunning = 0;
    const started: number[] = [];
    let onStart: () => void = () => undefined;
    configureImageService(ctx.deps, {
      hooks: {
        jobStarted: (job: ImageJobInfo) => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          started.push(job.jobId);
          onStart();
          return new Promise<void>((resolve) => release.push(resolve));
        },
        jobFinished: () => {
          running--;
        },
      },
    });
    const waitForStarts = (count: number): Promise<void> =>
      new Promise((resolve) => {
        const check = (): void => {
          if (started.length >= count) resolve();
        };
        onStart = check;
        check();
      });

    const photo = await smallJpeg(600, 400);
    const uploads = [upload(photo), upload(photo), upload(photo)];
    await waitForStarts(2);
    // Give the third upload every chance to overtake the queue.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(started).toHaveLength(2);
    expect(maxRunning).toBe(2);

    release.shift()?.();
    await waitForStarts(3);
    expect(maxRunning).toBe(2);
    // jobStarted registers the release synchronously, so the second and third job are in the list.
    expect(release).toHaveLength(2);
    for (const next of release.splice(0)) next();

    const responses = await Promise.all(uploads);
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(maxRunning).toBe(2);
    expect(running).toBe(0);
    expect(imageRows()).toHaveLength(3);
    expect(listDir(ctx.deps.paths.tmp)).toEqual([]);
  });

  it('runs an expensive upload alone: it waits for the running job, later uploads wait for it', async () => {
    const release: Array<() => void> = [];
    const started: ImageJobInfo[] = [];
    let running = 0;
    const overlaps: number[] = [];
    const service = configureImageService(ctx.deps, {
      hooks: {
        jobStarted: (job) => {
          running++;
          started.push(job);
          overlaps.push(running);
          return new Promise<void>((resolve) => release.push(resolve));
        },
        jobFinished: () => {
          running--;
        },
      },
    });
    const until = async (condition: () => boolean): Promise<void> => {
      for (let i = 0; i < 500 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(condition()).toBe(true);
    };

    const photo = await smallJpeg(600, 400);
    // A 16-bit PNG always runs alone (NF-05), however small.
    const expensive = await photoPng(120, 80, { bits16: true });
    const first = upload(photo);
    await until(() => started.length === 1);
    const second = upload(expensive, { contentType: 'image/png' });
    await until(() => service.queue.waiting === 1);
    const third = upload(photo);
    await until(() => service.queue.waiting === 2);
    // One slot is free, but the expensive job needs both and nobody overtakes it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(started.map((j) => j.exclusive)).toEqual([false]);

    release.shift()?.();
    await until(() => started.length === 2);
    expect(started[1]?.exclusive).toBe(true);
    expect(service.queue.slotsInUse).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(started).toHaveLength(2);

    release.shift()?.();
    await until(() => started.length === 3);
    release.shift()?.();

    const responses = await Promise.all([first, second, third]);
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    // Nothing ever ran next to the expensive job.
    expect(overlaps).toEqual([1, 1, 1]);
    const lines = ctx.log.entries.filter((e) => e.msg === 'image processed');
    expect(lines.map((e) => e.exclusive)).toEqual([false, true, false]);
  });
});

describe('image ids are never handed out twice (F-09, F-16)', () => {
  async function uploaded(): Promise<ImageUploadResponse> {
    const res = await upload(await smallJpeg(600, 400));
    expect(res.status).toBe(201);
    return (await res.json()) as ImageUploadResponse;
  }

  async function status(imageId: number): Promise<number> {
    return (await ctx.app.request(`${API}/images/${imageId}`, { headers: { Host: 'localhost:8080' } }))
      .status;
  }

  it('an expired upload keeps its id: the next upload gets a new one, the old id answers 404', async () => {
    const old = await uploaded();
    // Eight days later the maintenance removes the never assigned upload (F-16).
    expect(expireUnassignedImages(ctx.deps, new Date('2026-10-01T10:05:00.000Z'))).toBe(1);
    expect(getMeta(ctx.deps.db, 'image_id_max')).toBe(String(old.imageId));

    const next = await uploaded();
    expect(next.imageId).toBeGreaterThan(old.imageId);
    expect(await status(old.imageId)).toBe(404);
    expect(await status(next.imageId)).toBe(200);
  });

  it('a removed recipe image keeps its id, so a stale editor never gets another photo', async () => {
    const photo = await uploaded();
    const headers = { ...CLIENT_HEADERS, 'X-Profile-Id': String(profileId) };
    const created = await ctx.app.request(`${API}/recipes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Flammkuchen', createKey: 'bild-id-0001', imageId: photo.imageId }),
    });
    expect(created.status).toBe(201);
    const recipeId = ((await created.json()) as RecipeResponse).recipe.id;
    const removed = await ctx.app.request(`${API}/recipes/${recipeId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ title: 'Flammkuchen', version: 1, imageId: null }),
    });
    expect(removed.status).toBe(200);
    expect(imageRows()).toEqual([]);

    const next = await uploaded();
    expect(next.imageId).toBeGreaterThan(photo.imageId);
    expect(await status(photo.imageId)).toBe(404);
    // Saving the stale draft with the old id is refused instead of taking the new photo.
    const stale = await ctx.app.request(`${API}/recipes/${recipeId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ title: 'Flammkuchen', version: 2, imageId: photo.imageId }),
    });
    expect(stale.status).toBe(400);
  });

  it('also reserves ids of rows written without the counter (older databases)', async () => {
    ctx.deps.db
      .prepare(
        "INSERT INTO images(id, file_key, width, height, bytes_total, created_at) VALUES (41, '0123456789abcdef', 600, 400, 1, '2026-09-01T00:00:00.000Z')",
      )
      .run();
    expect(expireUnassignedImages(ctx.deps)).toBe(1);
    expect((await uploaded()).imageId).toBe(42);
  });
});

describe('GET /api/v1/images/:id (Kap. 7.5, F-09)', () => {
  it('describes an uploaded image and whether a recipe uses it', async () => {
    const res = await upload(await smallJpeg(600, 400));
    const image = (await res.json()) as ImageUploadResponse;

    const info = await ctx.app.request(`${API}/images/${image.imageId}`, {
      headers: { Host: 'localhost:8080' },
    });
    expect(info.status).toBe(200);
    expect(info.headers.get('Cache-Control')).toBe('no-store');
    expect((await info.json()) as ImageInfo).toEqual({ ...image, assigned: false });

    const created = await ctx.app.request(`${API}/recipes`, {
      method: 'POST',
      headers: { ...CLIENT_HEADERS, 'X-Profile-Id': String(profileId) },
      body: JSON.stringify({ title: 'Flammkuchen', createKey: 'bild-test-0001', imageId: image.imageId }),
    });
    expect(created.status).toBe(201);
    const recipe = ((await created.json()) as RecipeResponse).recipe;
    expect(recipe.image).toEqual({ id: image.imageId, urls: image.urls, width: 600, height: 400 });

    const after = await ctx.app.request(`${API}/images/${image.imageId}`, {
      headers: { Host: 'localhost:8080' },
    });
    expect(((await after.json()) as ImageInfo).assigned).toBe(true);
  });

  it('answers 404 for unknown, removed or malformed ids', async () => {
    for (const id of ['4711', '0', '007', 'abc']) {
      const res = await ctx.app.request(`${API}/images/${id}`, { headers: { Host: 'localhost:8080' } });
      expect(res.status, id).toBe(404);
      expect((await errorOf(res)).code, id).toBe('NOT_FOUND');
    }
    const res = await ctx.app.request(`${API}/images/4711`, { headers: { Host: 'localhost:8080' } });
    expect((await errorOf(res)).message).toBe('Bild nicht gefunden');
  });
});
