import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDataRevision } from '../../server/db/repos/meta.ts';
import { AppError, type ErrorBody } from '../../server/errors.ts';
import { errorHandler } from '../../server/middleware/error.ts';
import { requestContext } from '../../server/middleware/request-context.ts';
import { revision } from '../../server/middleware/revision.ts';
import type { AppEnv } from '../../server/types.ts';
import { CLIENT_HEADERS, createTestContext, FAKE_NET_INFO, type TestContext } from '../helpers/app.ts';

const BASE = 'http://localhost:8080';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.cleanup();
});

async function errorOf(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

function requestLines() {
  return ctx.log.entries.filter((e) => e.msg === 'request');
}

describe('host check (NF-21)', () => {
  it('answers a foreign host with 421 MISDIRECTED as JSON', async () => {
    const res = await ctx.app.request('http://evil.example/api/v1/health', {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(421);
    expect(res.headers.get('content-type')).toContain('application/json');
    const error = await errorOf(res);
    expect(error.code).toBe('MISDIRECTED');
    expect(error.requestId).toBe(res.headers.get('x-request-id'));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const warn = ctx.log.entries.find((e) => e.msg === 'host rejected');
    expect(warn?.level).toBe('warn');
    expect(warn?.host).toBe('evil.example');
  });

  it('shows browser navigations a German HTML page with the right URLs', async () => {
    const res = await ctx.app.request('http://evil.example:8080/rezepte/42', {
      headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    });
    expect(res.status).toBe(421);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('<title>Falsche Adresse</title>');
    for (const { url } of FAKE_NET_INFO.urls) {
      expect(html).toContain(`<a href="${url}">${url}</a>`);
    }
    expect(html).not.toMatch(/<script|<style|style=/i);
  });

  it('rejects look-alike names that only share a suffix or prefix', async () => {
    for (const host of ['kueche-pc.evil.example', '192.168.178.99.nip.io', 'kueche-pc.local.evil']) {
      const res = await ctx.app.request(`http://${host}/api/v1/revision`);
      expect(res.status, host).toBe(421);
    }
  });

  it('allows every IP literal, so an IP change needs no restart', async () => {
    for (const origin of [
      'http://192.168.178.20:8080',
      'http://192.168.178.99:8080',
      'http://10.0.0.5',
      'http://[fd00::5]:8080',
    ]) {
      const res = await ctx.app.request(`${origin}/rezepte`);
      expect(res.status, origin).toBe(200);
    }
  });

  it('allows the configured names regardless of case and port', async () => {
    for (const origin of [
      'http://kueche-pc:8080',
      'http://KUECHE-PC.local:8080',
      'http://kueche-pc.fritz.box',
    ]) {
      const res = await ctx.app.request(`${origin}/`);
      expect(res.status, origin).toBe(200);
    }
  });
});

describe('client guard (NF-21, NF-19)', () => {
  it('rejects a write without X-Rezepte-Client with 400 BAD_REQUEST', async () => {
    const res = await ctx.app.request(`${BASE}/api/v1/x`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toBe('Anfrage ohne App-Kennung abgelehnt');
    expect(error.requestId).toBe(res.headers.get('x-request-id'));
    // The guard runs before the revision middleware; the error handler still adds the API headers.
    expect(res.headers.get('x-data-revision')).toBe('0');
    expect(res.headers.get('x-app-version')).toBe('0.1.0-test');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a wrong X-Rezepte-Client value', async () => {
    const res = await ctx.app.request(`${BASE}/api/v1/x`, {
      method: 'DELETE',
      headers: { 'X-Rezepte-Client': 'yes' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects a body that is not JSON (form or text/plain, the CORS-simple types)', async () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const res = await ctx.app.request(`${BASE}/api/v1/x`, {
        method: 'POST',
        headers: { 'X-Rezepte-Client': '1', 'Content-Type': contentType },
        body: '{"a":1}',
      });
      expect(res.status, contentType).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toBe('Falscher Inhaltstyp');
    }
  });

  it('rejects a body without any Content-Type', async () => {
    const res = await ctx.app.request(`${BASE}/api/v1/x`, {
      method: 'PUT',
      headers: { 'X-Rezepte-Client': '1' },
      body: new Uint8Array([123, 125]),
    });
    expect(res.status).toBe(400);
  });

  it('lets valid writes through (JSON with charset, and writes without a body)', async () => {
    const withCharset = await ctx.app.request(`${BASE}/api/v1/x`, {
      method: 'POST',
      headers: { ...CLIENT_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
      body: '{"a":1}',
    });
    expect(withCharset.status).toBe(404);
    const noBody = await ctx.app.request(`${BASE}/api/v1/x`, {
      method: 'DELETE',
      headers: { 'X-Rezepte-Client': '1' },
    });
    expect(noBody.status).toBe(404);
  });

  it('does not require the client header for reads', async () => {
    const res = await ctx.app.request(`${BASE}/api/v1/unknown`);
    expect(res.status).toBe(404);
  });

  it('answers a JSON body over 1 MB with 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await ctx.app.request(`${BASE}/api/v1/x`, {
      method: 'POST',
      headers: CLIENT_HEADERS,
      body: JSON.stringify({ text: 'a'.repeat(1_100_000) }),
    });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('accepts a JSON body just under 1 MB', async () => {
    const res = await ctx.app.request(`${BASE}/api/v1/x`, {
      method: 'POST',
      headers: CLIENT_HEADERS,
      body: JSON.stringify({ text: 'a'.repeat(1_000_000) }),
    });
    expect(res.status).toBe(404);
  });

  it('accepts raw image bodies on the upload path and exempts them from the JSON limit', async () => {
    const res = await ctx.app.request(`${BASE}/api/v1/images`, {
      method: 'POST',
      headers: { 'X-Rezepte-Client': '1', 'Content-Type': 'image/jpeg' },
      body: new Uint8Array(1_200_000),
    });
    // The guard lets it through (no 400, no JSON-limit 413); the upload route asks for a profile first (M3).
    expect(res.status).toBe(401);
    const json = await ctx.app.request(`${BASE}/api/v1/images`, {
      method: 'POST',
      headers: CLIENT_HEADERS,
      body: '{}',
    });
    expect(json.status).toBe(400);
  });

  it('answers writes with 503 READ_ONLY when the database is corrupt, but still serves reads', async () => {
    ctx.deps.state.db = 'corrupt';
    const res = await ctx.app.request(`${BASE}/api/v1/x`, {
      method: 'POST',
      headers: CLIENT_HEADERS,
      body: '{}',
    });
    expect(res.status).toBe(503);
    const error = await errorOf(res);
    expect(error.code).toBe('READ_ONLY');
    expect(error.message).toBe('Datenbank beschädigt – nur Lesen möglich');
    const read = await ctx.app.request(`${BASE}/api/v1/unknown`);
    expect(read.status).toBe(404);
  });
});

describe('API headers and error format (Kap. 7.1)', () => {
  it('answers an unknown API path with 404 NOT_FOUND JSON and all API headers', async () => {
    const res = await ctx.app.request(`${BASE}/api/v1/unknown`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-app-version')).toBe('0.1.0-test');
    expect(res.headers.get('x-data-revision')).toBe('0');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    const requestId = res.headers.get('x-request-id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const body = (await res.json()) as ErrorBody;
    expect(body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String), requestId } });
  });

  it('gives every request its own id', async () => {
    const a = await ctx.app.request(`${BASE}/api/v1/unknown`);
    const b = await ctx.app.request(`${BASE}/api/v1/unknown`);
    expect(a.headers.get('x-request-id')).not.toBe(b.headers.get('x-request-id'));
  });
});

describe('request log (NF-25)', () => {
  it('writes exactly one request line per request with durationMs', async () => {
    const responses = [
      await ctx.app.request(`${BASE}/api/v1/unknown`),
      await ctx.app.request(`${BASE}/rezepte/42`),
      await ctx.app.request(`${BASE}/assets/index-abc123.js`, { method: 'HEAD' }),
      await ctx.app.request('http://evil.example/'),
      await ctx.app.request(`${BASE}/api/v1/x`, { method: 'POST', body: '{}' }),
    ];
    const lines = requestLines();
    expect(lines).toHaveLength(responses.length);
    lines.forEach((line, i) => {
      const res = responses[i];
      expect(line.level).toBe('info');
      expect(line.requestId).toBe(res?.headers.get('x-request-id'));
      expect(line.status).toBe(res?.status);
      expect(typeof line.durationMs).toBe('number');
      expect(line.durationMs).toBeGreaterThanOrEqual(0);
      // rounded to 0.1 ms: rounding again changes nothing
      const ms = line.durationMs as number;
      expect(Math.round(ms * 10) / 10).toBe(ms);
    });
    expect(lines.map((l) => [l.method, l.path])).toEqual([
      ['GET', '/api/v1/unknown'],
      ['GET', '/rezepte/42'],
      ['HEAD', '/assets/index-abc123.js'],
      ['GET', '/'],
      ['POST', '/api/v1/x'],
    ]);
  });
});

describe('unhandled errors (NF-25)', () => {
  function throwingApp() {
    const app = new Hono<AppEnv>();
    app.use('*', requestContext(ctx.deps));
    app.get('/api/v1/boom', () => {
      throw new Error('boom: secret detail');
    });
    app.get('/api/v1/http-413', () => {
      throw new HTTPException(413);
    });
    app.get('/api/v1/http-405', () => {
      throw new HTTPException(405);
    });
    app.get('/api/v1/details', () => {
      throw new AppError('VALIDATION', 'Titel darf nicht leer sein', [{ field: 'title', message: 'leer' }]);
    });
    app.onError(errorHandler(ctx.deps));
    return app;
  }

  it('answers 500 INTERNAL without stack and logs the stack', async () => {
    const res = await throwingApp().request(`${BASE}/api/v1/boom`);
    expect(res.status).toBe(500);
    const text = await res.text();
    const body = JSON.parse(text) as ErrorBody;
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'requestId']);
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('Unerwarteter Fehler');
    expect(body.error.requestId).toBe(res.headers.get('x-request-id'));
    expect(text).not.toContain('boom');
    expect(text).not.toContain('stack');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const logged = ctx.log.entries.find((e) => e.msg === 'unhandled error');
    expect(logged?.level).toBe('error');
    expect(logged?.requestId).toBe(body.error.requestId);
    const err = logged?.err as Error;
    expect(err.stack).toContain('boom: secret detail');

    const lines = requestLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('error');
    expect(lines[0]?.status).toBe(500);
  });

  it('maps Hono HTTP exceptions onto the error codes', async () => {
    const app = throwingApp();
    const tooLarge = await app.request(`${BASE}/api/v1/http-413`);
    expect(tooLarge.status).toBe(413);
    expect((await errorOf(tooLarge)).code).toBe('PAYLOAD_TOO_LARGE');
    const other = await app.request(`${BASE}/api/v1/http-405`);
    expect(other.status).toBe(400);
    expect((await errorOf(other)).code).toBe('BAD_REQUEST');
    expect(ctx.log.entries.some((e) => e.msg === 'unhandled error')).toBe(false);
  });

  it('passes AppError details through', async () => {
    const res = await throwingApp().request(`${BASE}/api/v1/details`);
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe('VALIDATION');
    expect(error.details).toEqual([{ field: 'title', message: 'leer' }]);
  });
});

describe('data revision (F-36)', () => {
  function revisionApp() {
    const app = new Hono<AppEnv>();
    app.use('/api/*', revision(ctx.deps));
    app.post('/api/v1/created', (c) => c.json({ ok: true }, 201));
    app.post('/api/v1/invalid', (c) => c.json({ ok: false }, 400));
    app.delete('/api/v1/thrown', () => {
      throw new AppError('NOT_FOUND', 'Gibt es nicht');
    });
    app.get('/api/v1/read', (c) => c.json({ ok: true }));
    app.onError(errorHandler(ctx.deps));
    return app;
  }

  it('increments after a successful write and reports the new value', async () => {
    const res = await revisionApp().request(`${BASE}/api/v1/created`, { method: 'POST' });
    expect(res.status).toBe(201);
    expect(getDataRevision(ctx.deps.db)).toBe(1);
    expect(res.headers.get('x-data-revision')).toBe('1');
  });

  it('stays unchanged for failed writes and reads, but still reports the revision', async () => {
    const app = revisionApp();
    const invalid = await app.request(`${BASE}/api/v1/invalid`, { method: 'POST' });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('x-data-revision')).toBe('0');
    const thrown = await app.request(`${BASE}/api/v1/thrown`, { method: 'DELETE' });
    expect(thrown.status).toBe(404);
    expect(thrown.headers.get('x-data-revision')).toBe('0');
    const read = await app.request(`${BASE}/api/v1/read`);
    expect(read.status).toBe(200);
    expect(read.headers.get('x-data-revision')).toBe('0');
    expect(getDataRevision(ctx.deps.db)).toBe(0);
  });

  it('does not write in read-only mode', async () => {
    ctx.deps.state.db = 'corrupt';
    const res = await revisionApp().request(`${BASE}/api/v1/created`, { method: 'POST' });
    expect(res.status).toBe(201);
    expect(getDataRevision(ctx.deps.db)).toBe(0);
  });
});
