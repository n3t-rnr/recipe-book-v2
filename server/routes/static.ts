import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context, Hono } from 'hono';
import type { AppDeps, AppEnv } from '../types.ts';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';
const TEXT_PLAIN = 'text/plain; charset=utf-8';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function contentType(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Rejects "..", hidden files, separators (also the decoded "%2f"/"%5c"), drive letters and NTFS
 * streams (":"), NUL and control characters, and trailing dots/spaces that Windows silently strips.
 */
function isUnsafeSegment(segment: string): boolean {
  if (segment === '' || segment.startsWith('.') || segment.endsWith('.') || segment.endsWith(' '))
    return true;
  for (const ch of segment) {
    if (ch === '/' || ch === '\\' || ch === ':' || ch.charCodeAt(0) < 0x20) return true;
  }
  return false;
}

/**
 * Decodes a percent-encoded relative URL path into file name segments, or null if any segment is
 * unsafe (NF-21 path protection). Plain dot segments are already resolved by the URL parser;
 * encoded variants like "..%2f" arrive here and are caught per segment.
 */
function safeSegments(encoded: string): string[] | null {
  const segments: string[] = [];
  for (const raw of encoded.split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (isUnsafeSegment(segment)) return null;
    segments.push(segment);
  }
  return segments.length > 0 ? segments : null;
}

interface FoundFile {
  file: string;
  size: number;
}

/**
 * Looks up base/segments and accepts it only if the real on-disk path is spelled exactly like the
 * request. This defeats case tricks and 8.3 short names on Windows (e.g. /INDEX.HTML would
 * otherwise deliver index.html without its CSP) and symlinks pointing out of the base directory.
 */
async function findFile(baseDir: string, segments: readonly string[]): Promise<FoundFile | null> {
  try {
    const [realBase, realFile] = await Promise.all([
      fs.realpath(baseDir),
      fs.realpath(path.join(baseDir, ...segments)),
    ]);
    if (realFile !== path.join(realBase, ...segments)) return null;
    const stat = await fs.stat(realFile);
    return stat.isFile() ? { file: realFile, size: stat.size } : null;
  } catch {
    return null;
  }
}

async function sendFile(c: Context<AppEnv>, found: FoundFile, cacheControl: string): Promise<Response> {
  const headers = {
    'Content-Type': contentType(found.file),
    'Content-Length': String(found.size),
    'Cache-Control': cacheControl,
  };
  // Hono answers HEAD by running the GET route; skip reading the file in that case.
  if (c.req.method === 'HEAD') return c.body(null, 200, headers);
  // Built files are small (NF-01 budgets), so reading them whole is simpler than streaming.
  return c.body(new Uint8Array(await fs.readFile(found.file)), 200, headers);
}

function notFound(c: Context<AppEnv>): Response {
  return c.text('Nicht gefunden', 404, { 'Content-Type': TEXT_PLAIN });
}

function cspHash(source: string): string {
  const digest = createHash('sha256').update(source, 'utf8').digest('base64');
  return `'sha256-${digest}'`;
}

/** CSP source hashes of every inline <script> without src, for script-src (Kap. 7.8). */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(match[1] ?? '')) continue;
    hashes.push(cspHash(match[2] ?? ''));
  }
  return hashes;
}

export function indexCsp(html: string): string {
  const scriptSrc = ["'self'", ...inlineScriptHashes(html)].join(' ');
  return [
    "default-src 'self'",
    "img-src 'self' blob: data:",
    `script-src ${scriptSrc}`,
    "style-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

interface IndexEntry {
  mtimeMs: number;
  size: number;
  body: Uint8Array<ArrayBuffer>;
  csp: string;
}

/**
 * Static delivery in the order of Kap. 7.8: hashed assets, root files of the build, SPA fallback,
 * 404. Registered after the API routes; /api paths never reach it.
 */
export function registerStatic(app: Hono<AppEnv>, deps: AppDeps): void {
  const clientDir = deps.clientDir;
  const assetsDir = path.join(clientDir, 'assets');
  const indexFile = path.join(clientDir, 'index.html');
  // Read and hashed once per build; the stat check picks up a rebuild without a restart.
  let indexCache: IndexEntry | null = null;

  const loadIndex = async (): Promise<IndexEntry | null> => {
    const stat = await fs.stat(indexFile).catch(() => null);
    if (!stat) {
      indexCache = null;
      return null;
    }
    if (indexCache && indexCache.mtimeMs === stat.mtimeMs && indexCache.size === stat.size) return indexCache;
    const raw = await fs.readFile(indexFile);
    indexCache = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      body: new Uint8Array(raw),
      csp: indexCsp(raw.toString('utf8')),
    };
    return indexCache;
  };

  const sendIndex = async (c: Context<AppEnv>): Promise<Response> => {
    const index = await loadIndex();
    if (!index) {
      return c.text('Die Oberfläche ist noch nicht gebaut – bitte pnpm build ausführen.', 503, {
        'Content-Type': TEXT_PLAIN,
        'Cache-Control': 'no-store',
      });
    }
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(index.body.byteLength),
      'Cache-Control': NO_CACHE,
      'Content-Security-Policy': index.csp,
    };
    if (c.req.method === 'HEAD') return c.body(null, 200, headers);
    return c.body(index.body, 200, headers);
  };

  app.get('*', async (c) => {
    // Raw (still percent-encoded) path; safeSegments decodes per segment so "%2F" cannot split one.
    const pathname = new URL(c.req.url).pathname;

    if (isUnder(pathname, '/assets')) {
      const segments = safeSegments(pathname.slice('/assets/'.length));
      const found = segments ? await findFile(assetsDir, segments) : null;
      return found ? sendFile(c, found, IMMUTABLE) : notFound(c);
    }

    let lastSegment: string;
    try {
      lastSegment = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
    } catch {
      return notFound(c);
    }

    if (path.extname(lastSegment) !== '') {
      const segments = safeSegments(pathname.slice(1));
      if (!segments) return notFound(c);
      // Never deliver the SPA document without its CSP.
      if (segments.length === 1 && segments[0] === 'index.html') return sendIndex(c);
      const found = await findFile(clientDir, segments);
      return found ? sendFile(c, found, NO_CACHE) : notFound(c);
    }

    if (isUnder(pathname, '/api') || isUnder(pathname, '/media')) return notFound(c);
    return sendIndex(c);
  });

  app.all('*', (c) => notFound(c));
}
