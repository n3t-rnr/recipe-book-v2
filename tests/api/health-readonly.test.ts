import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/app.ts';

const URL_BASE = 'http://localhost:8080/api/v1';

describe('health and revision with a damaged database (NF-19)', () => {
  let ctx: TestContext | null = null;
  afterEach(() => {
    ctx?.cleanup();
    ctx = null;
  });

  it('answers 200 with status read-only and null values when meta cannot be read', async () => {
    ctx = createTestContext();
    ctx.deps.state.db = 'corrupt';
    ctx.deps.db.exec('DROP TABLE meta');

    const health = await ctx.app.request(`${URL_BASE}/health`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as Record<string, unknown>;
    expect(body.status).toBe('read-only');
    expect(body.db).toBe('corrupt');
    expect(body.dataRevision).toBeNull();
    expect(body.lastBackupAt).toBeNull();
    expect(body.lastBackupError).toBeNull();

    const revision = await ctx.app.request(`${URL_BASE}/revision`);
    expect(revision.status).toBe(200);
    expect(await revision.json()).toEqual({ dataRevision: null });
  });
});
