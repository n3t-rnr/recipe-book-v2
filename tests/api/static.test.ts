import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexCsp, inlineScriptHashes } from '../../server/routes/static.ts';
import {
  createTestContext,
  FIXTURE_INDEX_HTML,
  FIXTURE_THEME_SCRIPT,
  type TestContext,
} from '../helpers/app.ts';

const BASE = 'http://localhost:8080';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.cleanup();
});

const get = (pathname: string, init?: RequestInit) => ctx.app.request(`${BASE}${pathname}`, init);

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

describe('static delivery order (Kap. 7.8)', () => {
  it('serves hashed assets as immutable with the right type', async () => {
    const js = await get('/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(js.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await js.text()).toBe('console.log("app");\n');

    const css = await get('/assets/index-abc123.css');
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
  });

  it('answers HEAD with headers but without a body', async () => {
    const res = await get('/assets/index-abc123.js', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength('console.log("app");\n')));
    expect(await res.text()).toBe('');

    const index = await get('/rezepte', { method: 'HEAD' });
    expect(index.status).toBe(200);
    expect(index.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await index.text()).toBe('');
  });

  it('serves root files of the build with no-cache', async () => {
    const res = await get('/manifest.webmanifest');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(((await res.json()) as { name: string }).name).toBe('Rezepte');

    const icon = await get('/favicon.ico');
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toBe('image/x-icon');
    expect(icon.headers.get('cache-control')).toBe('no-cache');
  });

  it('serves files in subfolders of the build root', async () => {
    fs.mkdirSync(path.join(ctx.deps.clientDir, 'icons'));
    fs.writeFileSync(path.join(ctx.deps.clientDir, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50]));
    const res = await get('/icons/icon-192.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers SPA routes with index.html, no-cache and the CSP with the theme script hash', async () => {
    const res = await get('/rezepte/42');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(FIXTURE_INDEX_HTML);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain(`script-src 'self' 'sha256-${sha256(FIXTURE_THEME_SCRIPT)}';`);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' blob: data:");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('serves / and /index.html like any SPA route (never without CSP)', async () => {
    for (const pathname of ['/', '/index.html', '/favoriten?tag=3']) {
      const res = await get(pathname);
      expect(res.status, pathname).toBe(200);
      expect(res.headers.get('content-security-policy'), pathname).toContain('sha256-');
      expect(res.headers.get('cache-control'), pathname).toBe('no-cache');
    }
  });

  it('answers everything else with 404 text', async () => {
    for (const pathname of ['/fehlt.png', '/assets/fehlt.js', '/assets/', '/assets', '/media/abc']) {
      const res = await get(pathname);
      expect(res.status, pathname).toBe(404);
      expect(res.headers.get('content-type'), pathname).toBe('text/plain; charset=utf-8');
      expect(await res.text(), pathname).toBe('Nicht gefunden');
    }
    const post = await get('/rezepte', { method: 'POST' });
    expect(post.status).toBe(404);
    // /api itself belongs to the API catch-all (JSON), never to the SPA fallback.
    const api = await get('/api');
    expect(api.status).toBe(404);
    expect(api.headers.get('content-security-policy')).toBeNull();
  });

  it('never delivers index.html under another spelling (case-insensitive NTFS, trailing dot/space)', async () => {
    for (const pathname of [
      '/INDEX.HTML',
      '/Index.html',
      '/index.html.',
      '/index.html%20',
      '/ASSETS/index-abc123.js',
    ]) {
      const res = await get(pathname);
      expect(res.status, pathname).toBe(404);
    }
  });

  it('answers 503 with a hint when the client is not built', async () => {
    fs.rmSync(path.join(ctx.deps.clientDir, 'index.html'));
    const res = await get('/rezepte');
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('Die Oberfläche ist noch nicht gebaut – bitte pnpm build ausführen.');
  });

  it('picks up a rebuilt index.html without a restart', async () => {
    await get('/');
    const script = 'document.documentElement.dataset.theme="dark"';
    fs.writeFileSync(
      path.join(ctx.deps.clientDir, 'index.html'),
      `<!doctype html><script>${script}</script>\n`,
    );
    const res = await get('/');
    expect(res.headers.get('content-security-policy')).toContain(`'sha256-${sha256(script)}'`);
  });
});

describe('path traversal (NF-21)', () => {
  it.each([
    '/media/../rezepte.sqlite',
    '/media/%2e%2e%2frezepte.sqlite',
    '/assets/..%5Cindex.html',
    '/assets/%2e%2e%2findex.html',
    '/assets/..%2f..%2fpackage.json',
    '/assets/%2e%2e%5c%2e%2e%5cpackage.json',
    '/icons/..%2f..%2frezepte.sqlite',
    '/assets/index-abc123.js%00.png',
    '/assets/C:%5CWindows%5Cwin.ini',
    '/assets/%E0%A4%A.js',
    '/.hidden/secret.txt',
  ])('answers %s with 404', async (pathname) => {
    const res = await get(pathname);
    expect(res.status).toBe(404);
  });

  it('resolves /assets/%2e%2e/index.html to /index.html (URL parser) and still sends the CSP', async () => {
    // WHATWG URL parsing (browser, @hono/node-server and Request alike) treats %2e%2e as "..",
    // so this never reaches the assets handler with a dot segment.
    const res = await get('/assets/%2e%2e/index.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain(`'sha256-${sha256(FIXTURE_THEME_SCRIPT)}'`);
  });
});

describe('CSP helpers', () => {
  it('hashes only inline scripts, byte-exact', () => {
    const html = '<script>a()</script><script type="module" src="/x.js"></script><SCRIPT>\n b() \n</SCRIPT>';
    expect(inlineScriptHashes(html)).toEqual([
      `'sha256-${sha256('a()')}'`,
      `'sha256-${sha256('\n b() \n')}'`,
    ]);
  });

  it("falls back to script-src 'self' without inline scripts", () => {
    expect(indexCsp('<html></html>')).toContain("script-src 'self'; style-src");
  });
});
