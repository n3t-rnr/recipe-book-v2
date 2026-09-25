import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../server/errors.ts';
import {
  MEDIA_FILE_PATTERN,
  mediaUrls,
  moveAllOrNothing,
  newFileKey,
  VARIANT_NAMES,
} from '../../server/services/image-files.ts';
import {
  cardCropSize,
  createJobQueue,
  createRssSampler,
  decodePlan,
  type ImageHeader,
  RSS_SAMPLE_MS,
  readHeader,
  renderVariants,
  type SampleScheduler,
  SNIFF_BYTES,
  sniffImageType,
  wholeImageDecode,
} from '../../server/services/images.ts';
import { IMAGE_DECODE } from '../../shared/constants.ts';
import {
  corruptJpeg,
  displayP3Jpeg,
  displayP3Png16,
  heicProbe,
  oversizedPngHeader,
  PDF_AS_JPG,
  photoJpeg,
  photoPng,
  photoWebp,
  pixelAt,
  pngWithAlpha,
  progressiveJpeg,
  sideColour,
  webpImage,
} from '../helpers/images.ts';

describe('sniffImageType (magic bytes, Kap. 4.6)', () => {
  it('recognises JPEG, PNG and WebP by their signatures', async () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]))).toBe('jpeg');
    expect(sniffImageType((await pngWithAlpha(4, 4)).subarray(0, SNIFF_BYTES))).toBe('png');
    expect(sniffImageType((await webpImage(4, 4)).subarray(0, SNIFF_BYTES))).toBe('webp');
  });

  it('recognises HEIC and HEIF brands, as major or compatible brand', () => {
    for (const brand of ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']) {
      expect(sniffImageType(heicProbe(brand)), brand).toBe('heic');
    }
    // Major brand unknown, "heic" in the compatible list.
    expect(sniffImageType(heicProbe('MiHE'))).toBe('heic');
  });

  it('does not take AVIF, PDF, RIFF/WAVE or short input for an image', () => {
    const avif = Buffer.concat([
      Buffer.from([0, 0, 0, 28]),
      Buffer.from('ftypavif\0\0\0\0avifmif1miaf', 'latin1'),
    ]);
    expect(sniffImageType(avif)).toBeNull();
    expect(sniffImageType(PDF_AS_JPG)).toBeNull();
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1'))).toBeNull();
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('cardCropSize (variant s, F-15)', () => {
  it('is exactly 720×480 when the image covers it', () => {
    expect(cardCropSize(4000, 3000)).toEqual({ width: 720, height: 480 });
    expect(cardCropSize(1536, 2048)).toEqual({ width: 720, height: 480 });
    expect(cardCropSize(720, 480)).toEqual({ width: 720, height: 480 });
  });

  it('crops smaller images to 3:2 without enlarging them', () => {
    expect(cardCropSize(300, 200)).toEqual({ width: 300, height: 200 });
    expect(cardCropSize(300, 300)).toEqual({ width: 300, height: 200 });
    expect(cardCropSize(200, 300)).toEqual({ width: 200, height: 133 });
    expect(cardCropSize(1000, 400)).toEqual({ width: 600, height: 400 });
    expect(cardCropSize(719, 2000)).toEqual({ width: 719, height: 479 });
    expect(cardCropSize(1, 1)).toEqual({ width: 1, height: 1 });
  });
});

describe('createJobQueue (NF-05)', () => {
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve = (): void => undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it('runs at most two jobs at once and starts waiting jobs in FIFO order', async () => {
    const queue = createJobQueue(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, i) =>
      queue.run(async () => {
        started.push(i);
        await gate.promise;
        return i;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(queue.running).toBe(2);
    expect(queue.waiting).toBe(2);

    gates[1]?.resolve();
    await runs[1];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    expect(queue.running).toBe(2);

    gates[0]?.resolve();
    gates[2]?.resolve();
    gates[3]?.resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(started).toEqual([0, 1, 2, 3]);
    expect(queue.running).toBe(0);
    expect(queue.waiting).toBe(0);
  });

  it('frees the slot when a job fails', async () => {
    const queue = createJobQueue(1);
    await expect(queue.run(() => Promise.reject(new Error('kaputt')))).rejects.toThrow('kaputt');
    expect(await queue.run(() => Promise.resolve('weiter'))).toBe('weiter');
    expect(queue.running).toBe(0);
  });

  it('runs a job that takes every slot alone, and later jobs do not overtake it', async () => {
    const queue = createJobQueue(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: string[] = [];
    const job = (name: string, gate: { promise: Promise<void> }) => async (): Promise<string> => {
      started.push(name);
      await gate.promise;
      return name;
    };
    const small = queue.run(job('klein', gates[0] ?? deferred()));
    const big = queue.run(job('teuer', gates[1] ?? deferred()), 2);
    // A slot is free, but the expensive job is first in line: no overtaking.
    const later = queue.run(job('später', gates[2] ?? deferred()));
    await Promise.resolve();
    expect(started).toEqual(['klein']);
    expect({ running: queue.running, slots: queue.slotsInUse, waiting: queue.waiting }).toEqual({
      running: 1,
      slots: 1,
      waiting: 2,
    });

    gates[0]?.resolve();
    await small;
    await Promise.resolve();
    expect(started).toEqual(['klein', 'teuer']);
    expect({ running: queue.running, slots: queue.slotsInUse, waiting: queue.waiting }).toEqual({
      running: 1,
      slots: 2,
      waiting: 1,
    });
    const last = queue.run(job('zuletzt', gates[3] ?? deferred()));
    await Promise.resolve();
    expect(started).toEqual(['klein', 'teuer']);

    gates[1]?.resolve();
    await big;
    await Promise.resolve();
    // Both waiting jobs start together once the expensive one is done.
    expect(started).toEqual(['klein', 'teuer', 'später', 'zuletzt']);
    expect(queue.running).toBe(2);
    gates[2]?.resolve();
    gates[3]?.resolve();
    expect(await Promise.all([later, last])).toEqual(['später', 'zuletzt']);
    expect({ running: queue.running, slots: queue.slotsInUse, waiting: queue.waiting }).toEqual({
      running: 0,
      slots: 0,
      waiting: 0,
    });
  });

  it('counts more slots than the limit as all of them', async () => {
    const queue = createJobQueue(2);
    let slots = 0;
    expect(
      await queue.run(() => {
        slots = queue.slotsInUse;
        return Promise.resolve('allein');
      }, 5),
    ).toBe('allein');
    expect(slots).toBe(2);
    expect(queue.slotsInUse).toBe(0);
  });
});

describe('createRssSampler (NF-05 evidence)', () => {
  /** A scheduler the test ticks by hand. */
  function manualTimer() {
    const ticks = new Set<() => void>();
    let scheduled = 0;
    let cancelled = 0;
    const schedule: SampleScheduler = (tick, ms) => {
      expect(ms).toBe(RSS_SAMPLE_MS);
      scheduled++;
      ticks.add(tick);
      return () => {
        cancelled++;
        ticks.delete(tick);
      };
    };
    return {
      schedule,
      tick: (): void => {
        for (const tick of [...ticks]) tick();
      },
      get scheduled() {
        return scheduled;
      },
      get cancelled() {
        return cancelled;
      },
    };
  }

  it('catches the peak between the stages, not only at start and end', () => {
    // start, three timer ticks during the decode, stop: the peak lies in the middle.
    const values = [100, 180, 460, 250, 120];
    let reads = 0;
    const timer = manualTimer();
    const sampler = createRssSampler(() => values[reads++] ?? 0, timer.schedule);

    const job = sampler.start();
    timer.tick();
    timer.tick();
    timer.tick();
    expect(job.stop()).toBe(460);
    expect(reads).toBe(5);
    expect({ scheduled: timer.scheduled, cancelled: timer.cancelled }).toEqual({
      scheduled: 1,
      cancelled: 1,
    });
  });

  it('shares one timer between parallel jobs; each sees the process peak while it ran', () => {
    let rss = 100;
    let reads = 0;
    const timer = manualTimer();
    const sampler = createRssSampler(() => {
      reads++;
      return rss;
    }, timer.schedule);

    const first = sampler.start();
    rss = 150;
    timer.tick();
    const second = sampler.start();
    expect(sampler.active).toBe(2);
    rss = 300;
    timer.tick();
    rss = 200;
    expect(first.stop()).toBe(300);
    // The second job still runs, so the timer does too.
    expect(timer.cancelled).toBe(0);
    rss = 280;
    timer.tick();
    rss = 120;
    expect(second.stop()).toBe(300);
    expect({ scheduled: timer.scheduled, cancelled: timer.cancelled, active: sampler.active }).toEqual({
      scheduled: 1,
      cancelled: 1,
      active: 0,
    });

    // stop() is idempotent and reads nothing more.
    const before = reads;
    expect(first.stop()).toBe(300);
    expect(reads).toBe(before);

    // A later job starts a new timer and does not inherit the old peak.
    rss = 90;
    const third = sampler.start();
    expect(third.stop()).toBe(90);
    expect(timer.scheduled).toBe(2);
  });

  it('samples in the background with an unref’d timer and stops it after the last job', async () => {
    let reads = 0;
    const sampler = createRssSampler(() => {
      reads++;
      return 1;
    });
    const refTimers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const before = refTimers();
    const job = sampler.start();
    expect(refTimers()).toBe(before);
    await new Promise((resolve) => setTimeout(resolve, 100));
    job.stop();
    // start and stop, plus at least two timer ticks in 100 ms (Windows timers: ~16 ms resolution).
    expect(reads).toBeGreaterThanOrEqual(4);
    const after = reads;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads).toBe(after);
  });
});

describe('decode cost (NF-05)', () => {
  function header(overrides: Partial<ImageHeader>): ImageHeader {
    return {
      format: 'jpeg',
      width: 4000,
      height: 3000,
      channels: 3,
      highBitDepth: false,
      progressive: false,
      subsampled: true,
      hasAlpha: false,
      lossless: false,
      ...overrides,
    };
  }

  function rejection(input: ImageHeader): AppError {
    try {
      decodePlan(input);
    } catch (err) {
      if (err instanceof AppError) return err;
      throw err;
    }
    throw new Error('expected a 413');
  }

  it('lets baseline JPEGs up to 60 MP share the queue (shrink-on-load)', () => {
    expect(decodePlan(header({ width: 9000, height: 6600 }))).toEqual({ exclusive: false });
    expect(decodePlan(header({ width: 9000, height: 6600, subsampled: false }))).toEqual({
      exclusive: false,
    });
    expect(wholeImageDecode(header({ width: 9000, height: 6600 }))).toBeNull();
    const huge = rejection(header({ width: 10_000, height: 7_000 }));
    expect(huge.message).toBe('Bild hat zu viele Pixel (max. 60 MP)');
  });

  it('runs progressive 4:4:4 JPEGs up to 10 MP alone and refuses larger ones with 413', () => {
    expect(IMAGE_DECODE.maxWholeImageBytes).toBe(60_000_000);
    const atLimit = header({ width: 4000, height: 2500, progressive: true, subsampled: false });
    expect(wholeImageDecode(atLimit)).toEqual({ kind: 'progressive-jpeg', bytes: 60_000_000 });
    expect(decodePlan(atLimit)).toEqual({ exclusive: true });

    const over = rejection(header({ width: 4001, height: 2500, progressive: true, subsampled: false }));
    expect(over.status).toBe(413);
    expect(over.code).toBe('PAYLOAD_TOO_LARGE');
    expect(over.message).toBe(
      'Progressives JPEG hat zu viele Pixel (max. 10 MP) – bitte verkleinern oder als normales JPEG speichern',
    );
    expect(over.details).toEqual({ reason: 'pixels', maxPixels: 10_000_000, decode: 'progressive-jpeg' });

    // A small progressive JPEG (≤ 32 MB of coefficients) still shares the queue.
    expect(decodePlan(header({ width: 2300, height: 1500, progressive: true, subsampled: false }))).toEqual({
      exclusive: false,
    });
    expect(decodePlan(header({ width: 2400, height: 2400, progressive: true, subsampled: false }))).toEqual({
      exclusive: true,
    });
  });

  it('prices subsampled, CMYK and grey progressive JPEGs by their samples', () => {
    const limit = (h: Partial<ImageHeader>) => rejection(header({ progressive: true, ...h })).details;
    // Subsampled chroma is priced like 4:2:2: 15 MP, so a 12-MP 4:2:0 export passes.
    expect(decodePlan(header({ width: 4000, height: 3000, progressive: true }))).toEqual({ exclusive: true });
    expect(decodePlan(header({ width: 6000, height: 2500, progressive: true }))).toEqual({ exclusive: true });
    expect(limit({ width: 6001, height: 2500 })).toMatchObject({ maxPixels: 15_000_000 });
    expect(limit({ width: 4000, height: 3000, channels: 4, subsampled: false })).toMatchObject({
      maxPixels: 7_500_000,
    });
    expect(limit({ width: 9000, height: 6000, channels: 1, subsampled: false })).toMatchObject({
      maxPixels: 30_000_000,
    });
  });

  it('refuses large interlaced PNGs and lossless WebPs; lossy WebP pays for its alpha plane only', () => {
    const png = (h: Partial<ImageHeader>) =>
      header({ format: 'png', subsampled: false, progressive: true, ...h });
    expect(decodePlan(png({ channels: 4, width: 4000, height: 2500 }))).toEqual({ exclusive: true });
    expect(rejection(png({ channels: 4, width: 4001, height: 2500 })).details).toEqual({
      reason: 'pixels',
      maxPixels: 10_000_000,
      decode: 'interlaced-png',
    });
    expect(rejection(png({ channels: 4, width: 4001, height: 2500 })).message).toBe(
      'PNG mit Interlacing hat zu viele Pixel (max. 10 MP) – bitte verkleinern oder als normales JPEG speichern',
    );
    expect(rejection(png({ width: 4000, height: 3334 })).details).toMatchObject({ maxPixels: 13_333_333 });
    expect(rejection(png({ highBitDepth: true, width: 3000, height: 2223 })).details).toMatchObject({
      maxPixels: 6_666_666,
    });

    const webp = (h: Partial<ImageHeader>) => header({ format: 'webp', subsampled: false, ...h });
    expect(decodePlan(webp({ lossless: true, width: 6000, height: 2500 }))).toEqual({ exclusive: true });
    expect(rejection(webp({ lossless: true, width: 6001, height: 2500 })).message).toBe(
      'Verlustfreies WebP hat zu viele Pixel (max. 15 MP) – bitte verkleinern oder als normales JPEG speichern',
    );
    expect(wholeImageDecode(webp({ hasAlpha: true, channels: 4, width: 3000, height: 2000 }))).toEqual({
      kind: 'webp-alpha',
      bytes: 6_000_000,
    });
    expect(decodePlan(webp({ hasAlpha: true, channels: 4, width: 3000, height: 2000 }))).toEqual({
      exclusive: false,
    });
    // Even with alpha a 60-MP WebP stays below the buffer limit; it runs alone by its pixel count.
    expect(decodePlan(webp({ hasAlpha: true, channels: 4, width: 9000, height: 6600 }))).toEqual({
      exclusive: true,
    });
  });

  it('runs PNG and WebP above 8 MP and every 16-bit PNG alone', () => {
    const png = (h: Partial<ImageHeader>) => header({ format: 'png', subsampled: false, channels: 4, ...h });
    expect(IMAGE_DECODE.exclusivePixels).toBe(8_000_000);
    expect(decodePlan(png({ width: 4000, height: 2000 }))).toEqual({ exclusive: false });
    expect(decodePlan(png({ width: 4001, height: 2000 }))).toEqual({ exclusive: true });
    expect(decodePlan(png({ width: 9000, height: 6600 }))).toEqual({ exclusive: true });
    expect(decodePlan(png({ width: 64, height: 48, highBitDepth: true }))).toEqual({ exclusive: true });
    expect(decodePlan(header({ format: 'webp', width: 4000, height: 2000 }))).toEqual({ exclusive: false });
    expect(decodePlan(header({ format: 'webp', width: 4001, height: 2000 }))).toEqual({ exclusive: true });
  });
});

describe('readHeader (Kap. 4.6)', () => {
  let dir: string | null = null;
  // Production setting (F-15): without the operation cache libvips closes file inputs after use,
  // so Windows can delete them.
  beforeAll(() => {
    sharp.cache(false);
  });
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('reads the storage layout without decoding pixels', async () => {
    expect(await readHeader(sharp, await progressiveJpeg(64, 48))).toMatchObject({
      format: 'jpeg',
      width: 64,
      height: 48,
      channels: 3,
      progressive: true,
      subsampled: false,
      highBitDepth: false,
    });
    expect(await readHeader(sharp, await progressiveJpeg(64, 48, '4:2:0'))).toMatchObject({
      progressive: true,
      subsampled: true,
    });
    expect(await readHeader(sharp, await photoJpeg({ width: 64, height: 48 }))).toMatchObject({
      progressive: false,
    });
    expect(await readHeader(sharp, await photoPng(40, 30, { interlaced: true }))).toMatchObject({
      format: 'png',
      channels: 4,
      hasAlpha: true,
      progressive: true,
      highBitDepth: false,
    });
    expect(await readHeader(sharp, await photoPng(40, 30, { bits16: true, alpha: false }))).toMatchObject({
      channels: 3,
      progressive: false,
      highBitDepth: true,
    });
  });

  it('tells lossless from lossy WebP, from a buffer and from the upload file', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-header-'));
    const cases = [
      { name: 'lossy', data: await photoWebp(40, 30), lossless: false, hasAlpha: false },
      {
        name: 'lossy-alpha',
        data: await photoWebp(40, 30, { alpha: true }),
        lossless: false,
        hasAlpha: true,
      },
      {
        name: 'lossless',
        data: await photoWebp(40, 30, { lossless: true }),
        lossless: true,
        hasAlpha: false,
      },
      {
        name: 'lossless-alpha',
        data: await photoWebp(40, 30, { lossless: true, alpha: true }),
        lossless: true,
        hasAlpha: true,
      },
    ];
    for (const { name, data, lossless, hasAlpha } of cases) {
      const file = path.join(dir, `${name}.upload`);
      fs.writeFileSync(file, data);
      expect(await readHeader(sharp, data), name).toMatchObject({ format: 'webp', lossless, hasAlpha });
      expect(await readHeader(sharp, file), name).toMatchObject({ format: 'webp', lossless, hasAlpha });
    }
  });

  it('refuses other formats with 415', async () => {
    const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#808080' } })
      .tiff()
      .toBuffer();
    const error = await readHeader(sharp, tiff).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toBe('Nur JPEG, PNG oder WebP');
    const broken = await readHeader(sharp, PDF_AS_JPG).catch((err: unknown) => err);
    expect((broken as AppError).status).toBe(415);
  });
});

describe('renderVariants (F-15)', () => {
  it('applies the EXIF orientation and derives l, m and s from one decode', async () => {
    // Stored 2400×1600 with orientation 6 → displayed 1600×2400 (portrait).
    const input = await photoJpeg({ width: 2400, height: 1600, orientation: 6, gps: true });
    const out = await renderVariants(sharp, input);
    expect({ width: out.width, height: out.height }).toEqual({ width: 1365, height: 2048 });

    const l = await sharp(out.files.l).metadata();
    const m = await sharp(out.files.m).metadata();
    const s = await sharp(out.files.s).metadata();
    expect([l.format, m.format, s.format]).toEqual(['webp', 'webp', 'webp']);
    expect({ width: l.width, height: l.height }).toEqual({ width: 1365, height: 2048 });
    expect(Math.max(m.width, m.height)).toBe(1200);
    expect(m.height).toBeGreaterThan(m.width);
    expect({ width: s.width, height: s.height }).toEqual({ width: 720, height: 480 });
    // Left half red, right half blue in display orientation, in every variant.
    for (const file of [out.files.l, out.files.m, out.files.s]) {
      const meta = await sharp(file).metadata();
      expect(await sideColour(file, 5, Math.floor(meta.height / 2))).toBe('red');
      expect(await sideColour(file, meta.width - 6, Math.floor(meta.height / 2))).toBe('blue');
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    }
  });

  it('never enlarges and keeps the alpha channel', async () => {
    const out = await renderVariants(sharp, await pngWithAlpha(300, 300));
    expect({ width: out.width, height: out.height }).toEqual({ width: 300, height: 300 });
    const m = await sharp(out.files.m).metadata();
    const s = await sharp(out.files.s).metadata();
    expect({ width: m.width, height: m.height }).toEqual({ width: 300, height: 300 });
    expect({ width: s.width, height: s.height }).toEqual({ width: 300, height: 200 });
    expect((await sharp(out.files.l).metadata()).hasAlpha).toBe(true);
  });

  it('rejects unreadable data with 415 and too many pixels with 413', async () => {
    const corrupt = await renderVariants(sharp, corruptJpeg()).catch((err: unknown) => err);
    expect(corrupt).toBeInstanceOf(AppError);
    expect((corrupt as AppError).status).toBe(415);
    const huge = await renderVariants(sharp, oversizedPngHeader()).catch((err: unknown) => err);
    expect(huge).toBeInstanceOf(AppError);
    expect((huge as AppError).status).toBe(413);
    expect((huge as AppError).message).toBe('Bild hat zu viele Pixel (max. 60 MP)');
  });

  it('keeps the colour management of a 16-bit PNG with a Display P3 profile', async () => {
    const png16 = await displayP3Png16(96, 64);
    const source = await sharp(png16).metadata();
    expect({ depth: source.depth, hasProfile: source.hasProfile }).toEqual({
      depth: 'ushort',
      hasProfile: true,
    });

    // Without a header renderVariants reads it itself; with one (as the upload passes it) the same.
    for (const out of [
      await renderVariants(sharp, png16),
      await renderVariants(sharp, png16, { highBitDepth: true }),
    ]) {
      for (const file of [out.files.l, out.files.m, out.files.s]) {
        const { r, g, b } = await pixelAt(file, 10, 10);
        // P3 (234, 51, 35) is sRGB red; the P3 values themselves would mean the profile was dropped.
        expect(r).toBeGreaterThanOrEqual(245);
        expect(g).toBeLessThanOrEqual(12);
        expect(b).toBeLessThanOrEqual(12);
      }
    }
  });

  it('maps an 8-bit JPEG with a Display P3 profile (iPhone photos) to the same sRGB colour', async () => {
    const out = await renderVariants(sharp, await displayP3Jpeg(96, 64));
    const reference = await pixelAt(
      (await renderVariants(sharp, await displayP3Png16(96, 64))).files.l,
      10,
      10,
    );
    const { r, g, b } = await pixelAt(out.files.l, 10, 10);
    expect(Math.abs(r - reference.r)).toBeLessThanOrEqual(6);
    expect(Math.abs(g - reference.g)).toBeLessThanOrEqual(6);
    expect(Math.abs(b - reference.b)).toBeLessThanOrEqual(6);
  });
});

describe('image files (Kap. 4.6)', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('creates 16-hex file keys and /media URLs that the media route accepts', () => {
    const key = newFileKey();
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(newFileKey()).not.toBe(key);
    const urls = mediaUrls(key);
    expect(urls).toEqual({ s: `/media/${key}-s.webp`, m: `/media/${key}-m.webp`, l: `/media/${key}-l.webp` });
    for (const url of Object.values(urls)) expect(url.slice('/media/'.length)).toMatch(MEDIA_FILE_PATTERN);
    expect(VARIANT_NAMES).toEqual(['l', 'm', 's']);
  });

  it('moveAllOrNothing takes back the moved files when one rename fails', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-move-'));
    const target = path.join(dir, 'images');
    fs.mkdirSync(target);
    const a = path.join(dir, 'a.part');
    const b = path.join(dir, 'b.part');
    fs.writeFileSync(a, 'a');
    fs.writeFileSync(b, 'b');
    const moves = [
      { from: a, to: path.join(target, 'a.webp') },
      { from: b, to: path.join(target, 'b.webp') },
      { from: path.join(dir, 'fehlt.part'), to: path.join(target, 'c.webp') },
    ];
    expect(() => moveAllOrNothing(moves)).toThrow();
    expect(fs.readdirSync(target)).toEqual([]);
  });
});
