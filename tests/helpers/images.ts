import zlib from 'node:zlib';
import sharp, { type Sharp } from 'sharp';

/**
 * Image fixtures for the M3 tests (F-14, F-15), generated at test time with sharp; nothing binary
 * is checked in. The photo generator paints a "display" image whose left half is red and right
 * half blue, so tests can tell whether the EXIF orientation was applied.
 */

export interface PhotoOptions {
  /** Stored pixel size (before the EXIF orientation is applied). */
  width: number;
  height: number;
  /** 1 (none) or 6 (rotate 90° clockwise to display, as phones write portrait photos). */
  orientation?: 1 | 6;
  /** Adds a GPS IFD to the EXIF data. */
  gps?: boolean;
  quality?: number;
  /** Amplitude of the pseudo-random grain. */
  noise?: number;
  /**
   * Amplitude of a fine texture that survives downscaling; with the defaults the 12-MP fixture
   * gives variant sizes like a detailed photo (about s 40 KB, m 120 KB, l 400 KB).
   */
  texture?: number;
}

const RED = { r: 190, g: 45, b: 35 };
const BLUE = { r: 40, g: 80, b: 185 };

/** Raw RGB pixels: gradients, waves, texture and grain, red/blue halves in display orientation. */
function photoPixels(
  width: number,
  height: number,
  orientation: 1 | 6,
  noise: number,
  texture: number,
): Buffer {
  const px = Buffer.allocUnsafe(width * height * 3);
  let seed = 0x2545f491;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Orientation 6 rotates the stored image 90° clockwise: stored bottom = display left.
      const red = orientation === 6 ? y >= height / 2 : x < width / 2;
      const base = red ? RED : BLUE;
      const shade = 30 * ((orientation === 6 ? x / width : y / height) - 0.5);
      const wave = 14 * Math.sin(x / 57 + Math.sin(y / 91) * 3) + 10 * Math.sin(y / 33 + x / 170);
      const fine =
        texture * Math.sin(x / 4.3 + 2 * Math.sin(y / 23)) * Math.sin(y / 6.1 + 2 * Math.sin(x / 37));
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const grain = ((seed >>> 0) / 4_294_967_296 - 0.5) * 2 * noise;
      const i = (y * width + x) * 3;
      const delta = shade + wave + fine + grain;
      px[i] = clamp(base.r + delta);
      px[i + 1] = clamp(base.g + delta);
      px[i + 2] = clamp(base.b + delta);
    }
  }
  return px;
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

export const GPS_EXIF = {
  IFD3: {
    GPSLatitudeRef: 'N',
    GPSLatitude: '48/1 8/1 2400/100',
    GPSLongitudeRef: 'E',
    GPSLongitude: '11/1 34/1 1200/100',
  },
};

export async function photoJpeg(options: PhotoOptions): Promise<Buffer> {
  const { width, height, orientation = 1, gps = false, quality = 90, noise = 16, texture = 18 } = options;
  const pixels = photoPixels(width, height, orientation, noise, texture);
  let image = sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality });
  if (orientation !== 1) image = image.withMetadata({ orientation });
  if (gps) image = image.withExifMerge(GPS_EXIF);
  return image.toBuffer();
}

let portrait: Promise<Buffer> | null = null;

/**
 * F-15 AK fixture: a 12-MP portrait photo as phones store it (4000×3000 pixels, EXIF orientation 6,
 * GPS position). Displayed it is 3000×4000; generated once per test file.
 */
export function portraitPhoto12mp(): Promise<Buffer> {
  portrait ??= photoJpeg({ width: 4000, height: 3000, orientation: 6, gps: true });
  return portrait;
}

/**
 * Pads a JPEG to targetBytes with comment segments (FF FE) right after SOI; decoders skip them.
 * Gives a realistic phone-sized upload (F-14 AK: 8 MB) without slow noise generation.
 */
export function padJpeg(jpeg: Buffer, targetBytes: number): Buffer {
  const parts: Buffer[] = [jpeg.subarray(0, 2)];
  let size = jpeg.length;
  while (size < targetBytes) {
    const payload = Math.min(65_533, Math.max(1, targetBytes - size - 4));
    const segment = Buffer.alloc(payload + 4, 0x20);
    segment[0] = 0xff;
    segment[1] = 0xfe;
    segment.writeUInt16BE(payload + 2, 2);
    parts.push(segment);
    size += segment.length;
  }
  parts.push(jpeg.subarray(2));
  return Buffer.concat(parts);
}

export function smallJpeg(width = 300, height = 200): Promise<Buffer> {
  return photoJpeg({ width, height, noise: 4 });
}

// --- Decode-cost fixtures (NF-05); scripts/measure-images.ts uses them too.

let detailPhoto: Promise<Buffer> | null = null;
let softPhoto: Promise<Buffer> | null = null;

/**
 * The test photo scaled up to any size: fast to generate, and it compresses like a smooth photo.
 * detail: 1600×1200 with grain (JPEG fixtures); otherwise 400×300 without grain, so even a 60-MP
 * RGBA PNG stays far below the 20-MiB upload limit.
 */
async function scaledPhoto(width: number, height: number, detail: boolean): Promise<Sharp> {
  detailPhoto ??= photoJpeg({ width: 1600, height: 1200, noise: 6 });
  softPhoto ??= photoJpeg({ width: 400, height: 300, noise: 0, texture: 0, quality: 95 });
  const base = await (detail ? detailPhoto : softPhoto);
  return sharp(base).resize(width, height, { fit: 'fill', kernel: 'cubic' });
}

/**
 * Progressive JPEG: libjpeg keeps the DCT coefficients of the whole image in memory to decode it,
 * 6 bytes per pixel with 4:4:4 (a 60-MP file of 2 MB needs about 450 MB RSS).
 */
export async function progressiveJpeg(
  width: number,
  height: number,
  chromaSubsampling: '4:4:4' | '4:2:0' = '4:4:4',
): Promise<Buffer> {
  return (await scaledPhoto(width, height, true))
    .jpeg({ progressive: true, chromaSubsampling, quality: 80 })
    .toBuffer();
}

export interface PngOptions {
  /** Adam7 interlacing: libvips decodes all passes into one buffer first. */
  interlaced?: boolean;
  /** 16 bits per sample. */
  bits16?: boolean;
  /** With an alpha channel (default true). */
  alpha?: boolean;
}

/** A photo-like PNG, by default RGBA with 8 bits per sample (NF-05: a 60-MP one is expensive). */
export async function photoPng(width: number, height: number, options: PngOptions = {}): Promise<Buffer> {
  const { interlaced = false, bits16 = false, alpha = true } = options;
  let image = await scaledPhoto(width, height, false);
  if (alpha) image = image.ensureAlpha(0.8);
  if (bits16) image = image.toColourspace('rgb16');
  return image.png({ compressionLevel: 9, progressive: interlaced }).toBuffer();
}

/** A photo-like WebP; lossless ones are decoded as a whole (4 bytes per pixel). */
export async function photoWebp(
  width: number,
  height: number,
  options: { lossless?: boolean; alpha?: boolean } = {},
): Promise<Buffer> {
  let image = await scaledPhoto(width, height, !options.lossless);
  if (options.alpha) image = image.ensureAlpha(0.8);
  return image.webp(options.lossless ? { lossless: true, effort: 0 } : { quality: 70 }).toBuffer();
}

/**
 * A uniform 16-bit PNG with an embedded Display P3 profile whose pixels are the P3 values
 * `p3` (8-bit scale). P3 (234, 51, 35) is sRGB red (255, 0, 0); a pipeline that drops the profile
 * shows (234, 51, 35) instead.
 */
export function displayP3Png16(
  width: number,
  height: number,
  p3: { r: number; g: number; b: number } = { r: 234, g: 51, b: 35 },
): Promise<Buffer> {
  const pixels = new Uint16Array(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = p3.r * 257;
    pixels[i + 1] = p3.g * 257;
    pixels[i + 2] = p3.b * 257;
  }
  // For rgb16 input sharp's working profile is P3, so withIccProfile('p3') attaches the profile unchanged.
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .toColourspace('rgb16')
    .withIccProfile('p3')
    .png()
    .toBuffer();
}

/** The same colour as an 8-bit JPEG with a Display P3 profile, as iPhones store photos. */
export function displayP3Jpeg(width: number, height: number, srgb = { r: 255, g: 0, b: 0 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: srgb } })
    .withIccProfile('p3')
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

/** Semi-transparent PNG with an alpha channel. */
export function pngWithAlpha(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 30, g: 120, b: 60, alpha: 0.5 } } })
    .png()
    .toBuffer();
}

export function webpImage(width = 640, height = 480): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 170, b: 90 } } })
    .webp({ quality: 80 })
    .toBuffer();
}

/** ISO BMFF header of a HEIC photo: ftyp box with major brand "heic", compatible mif1 and heic. */
export function heicProbe(majorBrand = 'heic'): Buffer {
  const ftyp = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from(`ftyp${majorBrand}`, 'latin1'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('mif1heic', 'latin1'),
  ]);
  return Buffer.concat([ftyp, Buffer.alloc(2048, 0x11)]);
}

/** A PDF that pretends to be a photo (saved as .jpg, sent as image/jpeg). */
export const PDF_AS_JPG = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
  'latin1',
);

/** Valid JPEG signature, then garbage: passes the magic bytes, fails in sharp. */
export function corruptJpeg(): Buffer {
  const garbage = Buffer.alloc(4096);
  for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 7919) & 0xff;
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), garbage]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A PNG whose IHDR claims width×height pixels but carries almost no data: the pixel limit must
 * reject it from the header alone, without allocating the pixels.
 */
export function oversizedPngHeader(width = 10_000, height = 7_000): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(64))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface CountingStream {
  stream: ReadableStream<Uint8Array>;
  /** Bytes handed to the reader so far. */
  readonly pulled: number;
  /** True once the reader cancelled the stream. */
  readonly cancelled: boolean;
}

/**
 * A lazily generated body of totalBytes (JPEG signature, then filler) that counts what the server
 * reads. highWaterMark 0: nothing is produced before the first read.
 */
export function countingStream(totalBytes: number, chunkBytes = 1_048_576): CountingStream {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled >= totalBytes) {
          controller.close();
          return;
        }
        const size = Math.min(chunkBytes, totalBytes - pulled);
        const chunk = new Uint8Array(size).fill(0x55);
        if (pulled === 0) chunk.set([0xff, 0xd8, 0xff, 0xe0].slice(0, size));
        pulled += size;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    stream,
    get pulled() {
      return pulled;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

/** True when the EXIF block (as returned by sharp().metadata().exif) contains a GPS IFD pointer (tag 0x8825). */
export function exifHasGps(exif: Buffer | undefined): boolean {
  if (!exif) return false;
  const tiff = exif.indexOf('MM\0*') >= 0 ? 'MM' : 'II';
  const tag = tiff === 'MM' ? Buffer.from([0x88, 0x25]) : Buffer.from([0x25, 0x88]);
  return exif.includes(tag);
}

/** RGB of one pixel of an encoded image. */
export async function pixelAt(
  image: Buffer,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number }> {
  const data = await sharp(image)
    .removeAlpha()
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer();
  return { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 };
}

/** "red" or "blue" for the halves painted by photoPixels. */
export async function sideColour(image: Buffer, x: number, y: number): Promise<'red' | 'blue' | 'other'> {
  const { r, b } = await pixelAt(image, x, y);
  if (r > b + 60) return 'red';
  if (b > r + 60) return 'blue';
  return 'other';
}
