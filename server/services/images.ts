import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Metadata, OutputInfo, SharpOptions } from 'sharp';
import { IMAGE_DECODE, IMAGE_VARIANTS, LIMITS } from '../../shared/constants.ts';
import type { ImageInfo, ImageUploadResponse } from '../../shared/types.ts';
import { findImage, insertImage } from '../db/repos/images.ts';
import { AppError, isAppError } from '../errors.ts';
import type { AppDeps } from '../types.ts';
import { LOW_DISK_BYTES } from './health.ts';
import {
  type ImageVariant,
  mediaUrls,
  moveAllOrNothing,
  newFileKey,
  removeQuietly,
  VARIANT_NAMES,
  variantFileName,
} from './image-files.ts';

/**
 * Image upload and processing (F-14, F-15, NF-05, NF-24, Kap. 4.6):
 * the raw body streams into DATA_DIR/tmp/<uuid>.upload with a byte counter, then magic bytes,
 * pixel count and decode cost are checked from the header, then a FIFO queue lets at most 2 jobs
 * run sharp at once; a job whose decode needs much memory takes both slots and runs alone. A job
 * decodes the original once (EXIF rotation, shrink-on-load to l) into raw pixels, derives l, m and
 * s from that buffer as WebP without metadata, writes them to tmp/ and moves all three into
 * images/ in the same tick as the DB insert. The upload file is deleted in every case.
 *
 * sharp is imported lazily: when it cannot load, the rest of the app still starts (NF-24).
 */

type SharpModule = typeof import('sharp').default;

export type ImageDeps = Pick<AppDeps, 'db' | 'paths' | 'log' | 'now' | 'state'> & {
  config: Pick<AppDeps['config'], 'maxUploadBytes'>;
};

export interface ImageJobInfo {
  jobId: number;
  requestId: string;
  /** The job holds every queue slot, because its decode needs much memory (NF-05). */
  exclusive: boolean;
}

/** Test and measurement hooks; production passes none. */
export interface ImageJobHooks {
  /** A job left the queue and is about to decode; awaited, so tests can hold jobs here. */
  jobStarted?: (job: ImageJobInfo) => void | Promise<void>;
  /** A job ended, successfully or not. */
  jobFinished?: (job: ImageJobInfo) => void;
  /** Writes one encoded variant to its temp file (default: fs writeFile); tests simulate failures. */
  writeVariant?: (file: string, data: Uint8Array, variant: ImageVariant) => Promise<void>;
}

export interface ImageServiceOptions {
  /** Free bytes on the DATA_DIR volume, null when unknown (never blocks); tests inject low values. */
  freeDiskBytes?: (dir: string) => number | null;
  /** At most this many jobs run sharp at the same time (NF-05: 2). */
  maxJobs?: number;
  hooks?: ImageJobHooks;
  /** Defaults to the lazy import of sharp. */
  loadSharp?: () => Promise<SharpModule>;
  /** Measures the RSS peak of each job; defaults to the process-wide sampler. */
  rssSampler?: RssSampler;
}

export interface UploadRequest {
  /** Raw request body (c.req.raw.body). */
  body: ReadableStream<Uint8Array> | null;
  /** Content-Length header as sent, if any. */
  contentLength: string | undefined;
  requestId: string;
  /** Aborted when the client disconnects; a queued job is then skipped. */
  signal?: AbortSignal;
}

export interface ImageService {
  /** POST /images: 201 body or AppError (400, 413, 415, 503, 507). */
  upload(request: UploadRequest): Promise<ImageUploadResponse>;
  /** GET /images/:id. */
  info(imageId: number): ImageInfo;
  readonly queue: JobQueue;
}

// --- Errors (German messages, Kap. 7.2; the client shows them as they are).

const MIB = 1_048_576;

/** F-14 AK: shown for HEIC/HEIF uploads, device neutral (R6). */
export const HEIC_HINT =
  'Bitte als JPEG speichern – iPhone: Einstellungen > Kamera > Formate > Maximale Kompatibilität; Android: in der Kamera-App HEIF ausschalten';

function tooLarge(maxBytes: number): AppError {
  return new AppError('PAYLOAD_TOO_LARGE', `Bild zu groß (max. ${Math.round(maxBytes / MIB)} MB)`, {
    reason: 'size',
    maxBytes,
  });
}

function tooManyPixels(): AppError {
  const mp = Math.round(LIMITS.uploadMaxPixels / 1_000_000);
  return new AppError('PAYLOAD_TOO_LARGE', `Bild hat zu viele Pixel (max. ${mp} MP)`, {
    reason: 'pixels',
    maxPixels: LIMITS.uploadMaxPixels,
  });
}

/** How the 413 below names the storage layout; the terms export dialogs use (Photoshop, GIMP). */
const WHOLE_IMAGE_LABELS: Record<WholeImageDecode, string> = {
  'progressive-jpeg': 'Progressives JPEG',
  'interlaced-png': 'PNG mit Interlacing',
  'lossless-webp': 'Verlustfreies WebP',
  'webp-alpha': 'WebP mit Transparenz',
};

/**
 * NF-05: the file is stored in a way that needs the whole image in memory to decode (progressive
 * JPEG, interlaced PNG, lossless WebP). maxPixels is the limit for this image's channel layout; the
 * same photo as a normal (baseline) JPEG is accepted up to 60 MP.
 */
function tooManyPixelsForLayout(maxPixels: number, decode: WholeImageDecode): AppError {
  const mp = Math.max(1, Math.floor(maxPixels / 1_000_000));
  return new AppError(
    'PAYLOAD_TOO_LARGE',
    `${WHOLE_IMAGE_LABELS[decode]} hat zu viele Pixel (max. ${mp} MP) – bitte verkleinern oder als normales JPEG speichern`,
    { reason: 'pixels', maxPixels, decode },
  );
}

function unsupportedType(): AppError {
  return new AppError('UNSUPPORTED_MEDIA', 'Nur JPEG, PNG oder WebP', { reason: 'type' });
}

function heicRejected(): AppError {
  return new AppError('UNSUPPORTED_MEDIA', HEIC_HINT, { reason: 'heic' });
}

/** cause keeps sharp's message for the log line of the rejected upload. */
function unreadable(cause?: unknown): AppError {
  const error = new AppError('UNSUPPORTED_MEDIA', 'Bild konnte nicht gelesen werden', {
    reason: 'unreadable',
  });
  if (cause !== undefined) error.cause = cause;
  return error;
}

function noImage(): AppError {
  return new AppError('BAD_REQUEST', 'Kein Bild übertragen');
}

function aborted(): AppError {
  return new AppError('BAD_REQUEST', 'Upload abgebrochen');
}

function insufficientStorage(): AppError {
  return new AppError('INSUFFICIENT_STORAGE', 'Zu wenig freier Speicher auf dem Server');
}

function imagesUnavailable(): AppError {
  return new AppError('IMAGES_UNAVAILABLE', 'Bildverarbeitung nicht verfügbar');
}

function isNoSpace(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOSPC';
}

// --- Magic bytes (Kap. 4.6, NF-21).

export type SniffedType = 'jpeg' | 'png' | 'webp' | 'heic';

/** How many leading bytes of the body sniffImageType needs (ftyp box with a dozen brands). */
export const SNIFF_BYTES = 64;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Major brands of HEIC/HEIF files (ISO/IEC 23008-12); mif1/msf1 are the generic HEIF brands. */
const HEIF_MAJOR_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
/** In the compatible list only the HEVC brands count: AVIF files list mif1 there too. */
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function ascii(bytes: Buffer, start: number, end: number): string {
  return bytes.toString('latin1', start, end);
}

/**
 * Detects the image type from the first bytes of the upload: JPEG FF D8 FF, PNG 89 50 4E 47 0D 0A 1A 0A,
 * WebP "RIFF"…"WEBP"; an ISO BMFF "ftyp" box with a HEIC/HEIF brand is recognised so the client can
 * show the HEIC hint. AVIF and everything else → null. The Content-Type header is never trusted.
 */
export function sniffImageType(head: Uint8Array): SniffedType | null {
  const b = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const major = ascii(b, 8, 12);
    if (HEIF_MAJOR_BRANDS.has(major)) return 'heic';
    if (AVIF_BRANDS.has(major)) return null;
    // Compatible brands start after major brand and minor version, up to the end of the box.
    const boxEnd = Math.min(b.readUInt32BE(0), b.length);
    for (let i = 16; i + 4 <= boxEnd; i += 4) {
      if (HEVC_BRANDS.has(ascii(b, i, i + 4))) return 'heic';
    }
  }
  return null;
}

// --- Queue (NF-05: at most 2 image jobs at once, further jobs wait in FIFO order).

export interface JobQueue {
  /**
   * Runs job once `slots` slots are free (default 1; more than the limit counts as all of them).
   * Strict FIFO: a waiting job that needs every slot is not overtaken by later small jobs.
   */
  run<T>(job: () => Promise<T>, slots?: number): Promise<T>;
  /** Jobs currently holding slots. */
  readonly running: number;
  /** Slots currently held; at most the limit. */
  readonly slotsInUse: number;
  /** Jobs waiting for slots. */
  readonly waiting: number;
}

export function createJobQueue(limit: number): JobQueue {
  const max = Math.max(1, Math.floor(limit));
  const waiters: Array<{ slots: number; start: () => void }> = [];
  let used = 0;
  let running = 0;

  /** Starts waiting jobs from the head of the line while their slots are free; nobody overtakes. */
  const pump = (): void => {
    for (let head = waiters[0]; head && used + head.slots <= max; head = waiters[0]) {
      waiters.shift();
      used += head.slots;
      running++;
      head.start();
    }
  };

  return {
    async run<T>(job: () => Promise<T>, slots = 1): Promise<T> {
      const need = Math.min(max, Math.max(1, Math.floor(slots)));
      await new Promise<void>((start) => {
        waiters.push({ slots: need, start });
        pump();
      });
      try {
        return await job();
      } finally {
        used -= need;
        running--;
        pump();
      }
    },
    get running() {
      return running;
    },
    get slotsInUse() {
      return used;
    },
    get waiting() {
      return waiters.length;
    },
  };
}

// --- RSS sampling (NF-05 evidence in the log).

/** Resident set size of the process in bytes; tests inject a fake. */
export type RssReader = () => number;

/** Calls tick every ms until the returned cancel function runs; the default is an unref'd setInterval. */
export type SampleScheduler = (tick: () => void, ms: number) => () => void;

export interface RssMeasurement {
  /** Ends the measurement (idempotent) and returns the highest RSS seen since start(), in bytes. */
  stop(): number;
}

export interface RssSampler {
  start(): RssMeasurement;
  /** Measurements running right now; the timer only runs while this is above 0. */
  readonly active: number;
}

/** Sampling interval: short enough for the peak inside libvips' decode, which lasts 100 ms and more. */
export const RSS_SAMPLE_MS = 5;

function intervalScheduler(tick: () => void, ms: number): () => void {
  const timer = setInterval(tick, ms);
  // Never keeps the process alive; outside image jobs no timer runs at all (NF-05: 0 % CPU idle).
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Process-wide RSS sampler: while at least one measurement runs, one timer reads the RSS every
 * intervalMs and raises the peak of every running measurement, so two parallel jobs each see the
 * peak of the process while they ran (NF-05: "RSS-Spitze ≤ 250 MB bei zwei gleichzeitigen
 * Uploads"). Samples taken only between the sharp stages missed that peak, which lies inside the
 * decode. start() and stop() sample once themselves, so even a job shorter than the interval has
 * two values.
 */
export function createRssSampler(
  readRss: RssReader = () => process.memoryUsage.rss(),
  schedule: SampleScheduler = intervalScheduler,
  intervalMs: number = RSS_SAMPLE_MS,
): RssSampler {
  const running = new Set<{ peak: number }>();
  let cancel: (() => void) | null = null;

  const sample = (): void => {
    const rss = readRss();
    for (const measurement of running) {
      if (rss > measurement.peak) measurement.peak = rss;
    }
  };

  return {
    start(): RssMeasurement {
      const measurement = { peak: 0 };
      running.add(measurement);
      sample();
      cancel ??= schedule(sample, intervalMs);
      return {
        stop(): number {
          if (!running.has(measurement)) return measurement.peak;
          sample();
          running.delete(measurement);
          if (running.size === 0 && cancel) {
            cancel();
            cancel = null;
          }
          return measurement.peak;
        },
      };
    },
    get active() {
      return running.size;
    },
  };
}

/** The sampler shared by every image service of this process. */
const processRssSampler = createRssSampler();

// --- Decode cost (NF-05: ≤ 250 MB RSS while images are processed, also with two uploads at once).

/** How a whole-image decoder stores the file; see IMAGE_DECODE in shared/constants.ts. */
export type WholeImageDecode = 'progressive-jpeg' | 'interlaced-png' | 'lossless-webp' | 'webp-alpha';

/** What the header tells about an upload, read without decoding a single pixel. */
export interface ImageHeader {
  format: 'jpeg' | 'png' | 'webp';
  /** Stored size, before the EXIF orientation is applied. */
  width: number;
  height: number;
  /** Bands after decoding, alpha included (1 grey, 3 RGB, 4 RGBA or CMYK). */
  channels: number;
  /** 16 bits per sample (PNG). */
  highBitDepth: boolean;
  /** Progressive JPEG or interlaced (Adam7) PNG. */
  progressive: boolean;
  /** JPEG with subsampled chroma (4:2:0, 4:2:2 …). */
  subsampled: boolean;
  hasAlpha: boolean;
  /** WebP whose (first) frame is a VP8L bitstream. */
  lossless: boolean;
}

/** Reads bytes of the upload at an offset; the WebP chunk walk needs a few of them. */
type ByteReader = (offset: number, length: number) => Promise<Buffer>;

/** RIFF chunks the walk looks at before it gives up (VP8X, ICCP, ANIM, ANMF, ALPH come first). */
const WEBP_MAX_CHUNKS = 32;
/** Header of an ANMF chunk before its frame's own chunks (position, size, duration, flags). */
const ANMF_HEADER_BYTES = 16;

/**
 * True when the (first frame of the) WebP is lossless: libwebp decodes a VP8L bitstream as a whole
 * into 4 bytes per pixel, while lossy VP8 is scaled while decoding. Walks the RIFF chunks
 * (https://developers.google.com/speed/webp/docs/riff_container); an unknown layout counts as
 * lossless, the expensive case.
 */
async function webpIsLossless(read: ByteReader): Promise<boolean> {
  let offset = 12; // "RIFF", size, "WEBP"
  for (let i = 0; i < WEBP_MAX_CHUNKS; i++) {
    const head = await read(offset, 8);
    if (head.length < 8) break;
    const fourcc = head.toString('latin1', 0, 4);
    if (fourcc === 'VP8L') return true;
    if (fourcc === 'VP8 ') return false;
    // An animation frame carries its bitstream as sub-chunks after the frame header.
    const size = head.readUInt32LE(4);
    offset += fourcc === 'ANMF' ? 8 + ANMF_HEADER_BYTES : 8 + size + (size % 2);
  }
  return true;
}

function bufferReader(input: Buffer): ByteReader {
  return (offset, length) => Promise.resolve(input.subarray(offset, offset + length));
}

async function withFileReader<T>(file: string, use: (read: ByteReader) => Promise<T>): Promise<T> {
  const handle = await fsp.open(file, 'r');
  try {
    return await use(async (offset, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    });
  } finally {
    await handle.close();
  }
}

/**
 * Format, size and storage layout from the header (Kap. 4.6): 415 for other formats or an
 * unreadable header. The pixel limit is enforced by decodePlan and again by the decode itself.
 */
export async function readHeader(sharp: SharpModule, input: string | Buffer): Promise<ImageHeader> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: false }).metadata();
  } catch (err) {
    throw unreadable(err);
  }
  const { format, width, height } = meta;
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp') throw unsupportedType();
  if (!(width > 0 && height > 0)) throw unreadable();
  let lossless = false;
  if (format === 'webp') {
    try {
      lossless =
        typeof input === 'string'
          ? await withFileReader(input, webpIsLossless)
          : await webpIsLossless(bufferReader(input));
    } catch (err) {
      throw unreadable(err);
    }
  }
  return {
    format,
    width,
    height,
    channels: meta.channels,
    highBitDepth: meta.depth === 'ushort',
    progressive: meta.isProgressive,
    subsampled:
      format === 'jpeg' &&
      meta.chromaSubsampling !== undefined &&
      !meta.chromaSubsampling.startsWith('4:4:4'),
    hasAlpha: meta.hasAlpha,
    lossless,
  };
}

/**
 * An interlaced PNG is decoded into one buffer and then read like a normal PNG, whose strips cost
 * about half as much again at these sizes (measured RSS alone with 72 MB of buffer: 18-MP RGBA up
 * to 224 MB, progressive JPEG 12 MP up to 202 MB on a fresh server; 10-MP RGBA with the factor:
 * up to 216 MB).
 */
const INTERLACED_PNG_FACTOR = 1.5;

/**
 * Bytes a decoder has to hold for the whole image at once, null for the layouts that libvips
 * decodes in strips (baseline JPEG with shrink-on-load, non-interlaced PNG, lossy WebP without alpha):
 * - progressive JPEG: the DCT coefficients of every block, 2 bytes per sample; subsampled chroma
 *   is priced like 4:2:2, because libvips reports 4:2:2 as "4:2:0" too;
 * - interlaced PNG: every Adam7 pass before the first row is complete (see INTERLACED_PNG_FACTOR);
 * - lossless WebP: ARGB, 4 bytes per pixel; lossy WebP: the alpha plane, 1 byte per pixel.
 */
export function wholeImageDecode(header: ImageHeader): { kind: WholeImageDecode; bytes: number } | null {
  const pixels = header.width * header.height;
  if (header.format === 'jpeg') {
    if (!header.progressive) return null;
    const samples = header.subsampled ? Math.max(1, (header.channels + 1) / 2) : header.channels;
    return { kind: 'progressive-jpeg', bytes: pixels * 2 * samples };
  }
  if (header.format === 'png') {
    if (!header.progressive) return null;
    const bytesPerPixel = header.channels * (header.highBitDepth ? 2 : 1) * INTERLACED_PNG_FACTOR;
    return { kind: 'interlaced-png', bytes: pixels * bytesPerPixel };
  }
  if (header.lossless) return { kind: 'lossless-webp', bytes: pixels * 4 };
  return header.hasAlpha ? { kind: 'webp-alpha', bytes: pixels } : null;
}

export interface DecodePlan {
  /** Takes every queue slot, so no second job adds its memory (NF-05). */
  exclusive: boolean;
}

/**
 * Prices an upload by its decode cost before it enters the queue (NF-05, limits and measurements
 * in IMAGE_DECODE): 413 above 60 MP, 413 when the whole-image buffer exceeds the budget of one job,
 * and a job of its own for every input that could push two parallel jobs over 250 MB.
 */
export function decodePlan(header: ImageHeader): DecodePlan {
  const pixels = header.width * header.height;
  if (pixels > LIMITS.uploadMaxPixels) throw tooManyPixels();
  const whole = wholeImageDecode(header);
  if (whole && whole.bytes > IMAGE_DECODE.maxWholeImageBytes) {
    const bytesPerPixel = whole.bytes / pixels;
    throw tooManyPixelsForLayout(Math.floor(IMAGE_DECODE.maxWholeImageBytes / bytesPerPixel), whole.kind);
  }
  const exclusive =
    (whole !== null && whole.bytes > IMAGE_DECODE.exclusiveWholeImageBytes) ||
    header.highBitDepth ||
    (header.format !== 'jpeg' && pixels > IMAGE_DECODE.exclusivePixels);
  return { exclusive };
}

// --- sharp pipeline (F-15).

/** The three variants in memory (together well below 1 MB) plus the size of l. */
export interface RenderedImage {
  width: number;
  height: number;
  files: Record<ImageVariant, Buffer>;
}

/**
 * Size of the card variant s: exactly IMAGE_VARIANTS.s (720×480) when the image covers it without
 * enlarging, otherwise the largest area of that aspect ratio (3:2) inside the image, so s is only
 * cropped, never enlarged (F-15).
 */
export function cardCropSize(width: number, height: number): { width: number; height: number } {
  const target = IMAGE_VARIANTS.s;
  if (width >= target.width && height >= target.height) return { width: target.width, height: target.height };
  const ratio = target.width / target.height;
  let w = Math.min(width, Math.floor(height * ratio));
  let h = Math.round(w / ratio);
  if (h > height) {
    h = height;
    w = Math.floor(h * ratio);
  }
  return { width: Math.max(1, w), height: Math.max(1, h) };
}

function decodeError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  return /pixel limit/i.test(message) ? tooManyPixels() : unreadable(err);
}

/**
 * Decodes the original once and encodes l, m and s from the decoded pixels (F-15): EXIF rotation,
 * shrink-on-load to at most 2048 px long edge, sRGB, never enlarged; no metadata in the output
 * (sharp strips EXIF, GPS and ICC unless told otherwise). Decode failures become 413 (pixel limit)
 * or 415; encode failures are unexpected and propagate. Without a header it reads one itself.
 */
export async function renderVariants(
  sharp: SharpModule,
  input: string | Buffer,
  header?: Pick<ImageHeader, 'highBitDepth'>,
): Promise<RenderedImage> {
  const { s, m, l } = IMAGE_VARIANTS;
  const { highBitDepth } = header ?? (await readHeader(sharp, input));
  const options: SharpOptions = { limitInputPixels: LIMITS.uploadMaxPixels, failOn: 'error' };
  let decoded: { data: Buffer; info: OutputInfo };
  try {
    let image = sharp(input, options);
    // 16-bit input: sharp imports its embedded ICC profile into Display P3 (its working profile for
    // rgb16) and the final cast to 8-bit sRGB drops that conversion, so the colours shift. Converting
    // to 8-bit sRGB first lets the embedded profile map straight to sRGB. Only here: a pipeline
    // colourspace switches off JPEG shrink-on-load (NF-05), and 16 bit only occurs in PNG.
    if (highBitDepth) image = image.pipelineColourspace('srgb');
    decoded = await image
      .rotate()
      .resize({ width: l.longEdge, height: l.longEdge, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    throw decodeError(err);
  }

  const { width, height, channels } = decoded.info;
  const raw = { raw: { width, height, channels } };
  const large = await sharp(decoded.data, raw).webp({ quality: l.quality }).toBuffer();
  const medium = await sharp(decoded.data, raw)
    .resize({ width: m.longEdge, height: m.longEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: m.quality })
    .toBuffer();
  const card = cardCropSize(width, height);
  const small = await sharp(decoded.data, raw)
    .resize({ width: card.width, height: card.height, fit: 'cover', position: 'attention' })
    .webp({ quality: s.quality })
    .toBuffer();
  return { width, height, files: { s: small, m: medium, l: large } };
}

// --- Upload.

/** Free bytes on the volume of dir, null when the file system does not report it (as /health does). */
export function freeDiskBytes(dir: string): number | null {
  try {
    const stats = fs.statfsSync(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function parseContentLength(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

interface Received {
  bytes: number;
  head: Buffer;
}

/**
 * Streams the body into file with a byte counter (Kap. 4.6): never more than maxBytes land on disk,
 * the (max + 1)th byte aborts with 413. The first SNIFF_BYTES are kept for the magic-byte check.
 */
async function receiveBody(
  body: ReadableStream<Uint8Array>,
  file: string,
  maxBytes: number,
): Promise<Received> {
  let bytes = 0;
  let head = Buffer.alloc(0);
  async function* counted(): AsyncGenerator<Uint8Array> {
    try {
      for await (const chunk of body) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw tooLarge(maxBytes);
        if (head.length < SNIFF_BYTES) {
          head = Buffer.concat([head, chunk.subarray(0, SNIFF_BYTES - head.length)]);
        }
        yield chunk;
      }
    } catch (err) {
      if (isAppError(err)) throw err;
      // The request stream failed: the client disconnected or the connection broke.
      throw aborted();
    }
  }
  try {
    await pipeline(counted, fs.createWriteStream(file, { flags: 'wx' }));
  } catch (err) {
    if (isAppError(err)) throw err;
    if (isNoSpace(err)) throw insufficientStorage();
    throw err;
  }
  return { bytes, head };
}

async function defaultLoadSharp(): Promise<SharpModule> {
  const sharp = (await import('sharp')).default;
  // Same settings as server/main.ts (F-15), so tests and scripts run the production configuration.
  sharp.cache(false);
  sharp.concurrency(2);
  return sharp;
}

async function defaultWriteVariant(file: string, data: Uint8Array): Promise<void> {
  await fsp.writeFile(file, data, { flag: 'wx' });
}

const KIB_PER_MIB = 1024;

export function createImageService(deps: ImageDeps, options: ImageServiceOptions = {}): ImageService {
  const hooks = options.hooks ?? {};
  const diskFree = options.freeDiskBytes ?? freeDiskBytes;
  const writeVariant = hooks.writeVariant ?? defaultWriteVariant;
  const maxJobs = Math.max(1, Math.floor(options.maxJobs ?? 2));
  const queue = createJobQueue(maxJobs);
  const rss = options.rssSampler ?? processRssSampler;
  let sharpPromise: Promise<SharpModule> | null = null;
  let jobCounter = 0;

  const loadSharp = async (): Promise<SharpModule> => {
    sharpPromise ??= (options.loadSharp ?? defaultLoadSharp)();
    try {
      return await sharpPromise;
    } catch (err) {
      sharpPromise = null;
      deps.log.error('sharp konnte nicht geladen werden', { err });
      throw imagesUnavailable();
    }
  };

  const processJob = async (
    sharp: SharpModule,
    uploadFile: string,
    header: ImageHeader,
    plan: DecodePlan,
    inputBytes: number,
    request: UploadRequest,
    queuedAt: number,
  ): Promise<ImageUploadResponse> => {
    const job: ImageJobInfo = {
      jobId: ++jobCounter,
      requestId: request.requestId,
      exclusive: plan.exclusive,
    };
    const { paths, log } = deps;
    const fileKey = newFileKey();
    const tmpFiles = {} as Record<ImageVariant, string>;
    for (const variant of VARIANT_NAMES) {
      tmpFiles[variant] = path.join(paths.tmp, `${variantFileName(fileKey, variant)}.part`);
    }
    let measurement: RssMeasurement | null = null;
    try {
      await hooks.jobStarted?.(job);
      // Nobody waits for the answer any more: skip the work (the upload file is removed by the caller).
      if (request.signal?.aborted) throw aborted();
      const started = performance.now();
      measurement = rss.start();

      const rendered = await renderVariants(sharp, uploadFile, header);
      try {
        for (const variant of VARIANT_NAMES) {
          await writeVariant(tmpFiles[variant], rendered.files[variant], variant);
        }
      } catch (err) {
        if (isNoSpace(err)) throw insufficientStorage();
        throw err;
      }

      const outputBytes = {
        s: rendered.files.s.byteLength,
        m: rendered.files.m.byteLength,
        l: rendered.files.l.byteLength,
      };
      fs.mkdirSync(paths.images, { recursive: true });
      // Files and row in one synchronous step (F-15 AK): no other code can run in between.
      moveAllOrNothing(
        VARIANT_NAMES.map((variant) => ({
          from: tmpFiles[variant],
          to: path.join(paths.images, variantFileName(fileKey, variant)),
        })),
      );
      let imageId: number;
      try {
        // meta.image_id_max and the row in one transaction (the id is never handed out twice).
        imageId = deps.db.transaction(() =>
          insertImage(deps.db, {
            fileKey,
            width: rendered.width,
            height: rendered.height,
            bytesTotal: outputBytes.s + outputBytes.m + outputBytes.l,
            createdAt: deps.now().toISOString(),
          }),
        )();
      } catch (err) {
        for (const variant of VARIANT_NAMES)
          removeQuietly(path.join(paths.images, variantFileName(fileKey, variant)));
        throw err;
      }

      // NF-05 evidence: one line per job. rssMb is the highest process RSS sampled every
      // RSS_SAMPLE_MS while the job ran (a parallel job included); maxRssMb is the peak of the whole
      // process since its start, as the OS reports it (Windows: peak working set), for reference.
      const rssPeak = measurement.stop();
      log.info('image processed', {
        requestId: request.requestId,
        imageId,
        inputBytes,
        outputBytes,
        width: rendered.width,
        height: rendered.height,
        exclusive: plan.exclusive,
        durationMs: Math.round(performance.now() - started),
        waitMs: Math.round(started - queuedAt),
        rssMb: Math.round(rssPeak / MIB),
        maxRssMb: Math.round(process.resourceUsage().maxRSS / KIB_PER_MIB),
      });
      return { imageId, urls: mediaUrls(fileKey), width: rendered.width, height: rendered.height };
    } finally {
      measurement?.stop();
      for (const variant of VARIANT_NAMES) removeQuietly(tmpFiles[variant]);
      hooks.jobFinished?.(job);
    }
  };

  const upload = async (request: UploadRequest): Promise<ImageUploadResponse> => {
    if (deps.state.images === 'unavailable') throw imagesUnavailable();
    const free = diskFree(deps.paths.dataDir);
    if (free !== null && free < LOW_DISK_BYTES) throw insufficientStorage();
    const maxBytes = deps.config.maxUploadBytes;
    const declared = parseContentLength(request.contentLength);
    // Refused before a single byte is read (F-14 AK).
    if (declared !== null && declared > maxBytes) throw tooLarge(maxBytes);
    if (!request.body || declared === 0) throw noImage();
    const sharp = await loadSharp();

    fs.mkdirSync(deps.paths.tmp, { recursive: true });
    const uploadFile = path.join(deps.paths.tmp, `${randomUUID()}.upload`);
    try {
      const received = await receiveBody(request.body, uploadFile, maxBytes);
      if (received.bytes === 0) throw noImage();
      const type = sniffImageType(received.head);
      if (type === 'heic') throw heicRejected();
      if (type === null) throw unsupportedType();
      // Header check before the queue: format, pixel count and decode cost without decoding pixels.
      const header = await readHeader(sharp, uploadFile);
      const plan = decodePlan(header);
      const queuedAt = performance.now();
      return await queue.run(
        () => processJob(sharp, uploadFile, header, plan, received.bytes, request, queuedAt),
        plan.exclusive ? maxJobs : 1,
      );
    } catch (err) {
      // The request log has the status; this line adds why, incl. sharp's own message (NF-25).
      if (isAppError(err) && err.status < 500) {
        deps.log.info('image rejected', {
          requestId: request.requestId,
          code: err.code,
          message: err.message,
          cause: err.cause instanceof Error ? err.cause.message : undefined,
        });
      }
      throw err;
    } finally {
      removeQuietly(uploadFile);
    }
  };

  const info = (imageId: number): ImageInfo => {
    const row = findImage(deps.db, imageId);
    if (!row) throw new AppError('NOT_FOUND', 'Bild nicht gefunden');
    return {
      imageId: row.id,
      urls: mediaUrls(row.fileKey),
      width: row.width,
      height: row.height,
      assigned: row.recipeId !== null,
    };
  };

  return { upload, info, queue };
}

// One service (and so one queue) per app instance; keyed by the deps object the app was built with.
const services = new WeakMap<object, ImageService>();

/** The image service of this app instance, created on first use. */
export function imageServiceFor(deps: ImageDeps): ImageService {
  let service = services.get(deps);
  if (!service) {
    service = createImageService(deps);
    services.set(deps, service);
  }
  return service;
}

/** Replaces the service of this app instance, e.g. with test hooks or an injected disk check. */
export function configureImageService(deps: ImageDeps, options: ImageServiceOptions): ImageService {
  const service = createImageService(deps, options);
  services.set(deps, service);
  return service;
}
