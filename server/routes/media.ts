import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Context, Hono } from 'hono';
import { MEDIA_FILE_PATTERN } from '../services/image-files.ts';
import type { AppDeps, AppEnv } from '../types.ts';

const IMMUTABLE = 'public, max-age=31536000, immutable';

function notFound(c: Context<AppEnv>): Response {
  // A missing file can come back (restore from images/.trash, F-16), so the 404 is never cached.
  return c.text('Nicht gefunden', 404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
}

/**
 * GET/HEAD /media/:file (Kap. 7.5, NF-06, NF-21): the WebP variants from DATA_DIR/images, streamed,
 * with an immutable cache (every upload gets a new file key). Only names matching
 * ^[0-9a-f]{16}-(s|m|l)\.webp$ are served, checked on the raw, still percent-encoded path, so
 * encoded separators or dots never reach the file system; images/.trash is never served.
 * Registered before the static delivery, which therefore never sees /media paths.
 */
export function registerMedia(app: Hono<AppEnv>, deps: AppDeps): void {
  app.get('/media/*', async (c) => {
    const pathname = new URL(c.req.url).pathname;
    const name = pathname.slice('/media/'.length);
    if (!pathname.startsWith('/media/') || !MEDIA_FILE_PATTERN.test(name)) return notFound(c);

    let handle: fs.FileHandle;
    try {
      handle = await fs.open(path.join(deps.paths.images, name), 'r');
    } catch {
      return notFound(c);
    }
    let size: number;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        await handle.close();
        return notFound(c);
      }
      size = stat.size;
    } catch {
      await handle.close().catch(() => undefined);
      return notFound(c);
    }

    const headers = {
      'Content-Type': 'image/webp',
      'Content-Length': String(size),
      'Cache-Control': IMMUTABLE,
    };
    // Hono answers HEAD through the GET route; no stream is opened for it.
    if (c.req.method === 'HEAD') {
      await handle.close();
      return c.body(null, 200, headers);
    }
    // The stream closes the handle at its end or when the client goes away (cancel → destroy).
    const stream = Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
    return c.body(stream, 200, headers);
  });
}
