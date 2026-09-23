import { Hono } from 'hono';
import { currentRevision } from '../middleware/revision.ts';
import { buildHealth } from '../services/health.ts';
import type { AppDeps, AppEnv } from '../types.ts';

/** Operational endpoints (Kap. 7.8). Backups and export follow in M6. */
export function opsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/health', (c) => c.json(buildHealth(deps)));

  // Polled every 60 s by every open client (F-36), so it reads a single meta row and nothing else.
  // null instead of a 500 when a damaged DB cannot even read meta (read-only mode, NF-19).
  app.get('/revision', (c) => {
    const revision = currentRevision(deps.db);
    return c.json({ dataRevision: revision === null ? null : Number(revision) });
  });

  // Resolved per request: an IP change must show up without a restart (F-39).
  app.get('/server-info', (c) => c.json(deps.netInfo()));

  return app;
}
