import { describe, expect, it } from 'vitest';
import { CLIENT_HEADERS, createTestContext } from '../helpers/app.ts';

describe('app smoke', () => {
  it('builds the app and answers unknown API paths with 404 JSON', async () => {
    const ctx = createTestContext();
    try {
      const res = await ctx.app.request('http://localhost:8080/api/v1/nope', { headers: CLIENT_HEADERS });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    } finally {
      ctx.cleanup();
    }
  });
});
