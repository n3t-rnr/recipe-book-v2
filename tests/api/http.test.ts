import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/app.ts';

/**
 * Requests over a real socket through @hono/node-server. In-process app.request() cannot show how
 * the node adapter presents body-less requests (it always attaches the request stream).
 */
describe('client guard over real HTTP (Kap. 7.1, NF-21)', () => {
  let ctx: TestContext;
  let server: ReturnType<typeof serve>;
  let base = '';

  beforeAll(async () => {
    ctx = createTestContext();
    await new Promise<void>((resolve) => {
      server = serve({ fetch: ctx.app.fetch, port: 0, hostname: '127.0.0.1' }, (info: AddressInfo) => {
        base = `http://127.0.0.1:${info.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.cleanup();
  });

  it('accepts DELETE without body and without Content-Type', async () => {
    const res = await fetch(`${base}/api/v1/nope`, {
      method: 'DELETE',
      headers: { 'X-Rezepte-Client': '1' },
    });
    // reaches the API catch-all instead of failing with "Falscher Inhaltstyp"
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('accepts POST with Content-Length 0 and no Content-Type', async () => {
    const res = await fetch(`${base}/api/v1/nope`, {
      method: 'POST',
      headers: { 'X-Rezepte-Client': '1', 'Content-Length': '0' },
    });
    expect(res.status).toBe(404);
  });

  it('still rejects a text/plain body', async () => {
    const res = await fetch(`${base}/api/v1/nope`, {
      method: 'POST',
      headers: { 'X-Rezepte-Client': '1', 'Content-Type': 'text/plain' },
      body: 'hallo',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('Falscher Inhaltstyp');
  });
});
