import type { MiddlewareHandler } from 'hono';
import { bumpDataRevision, getDataRevision } from '../db/repos/meta.ts';
import type { DB } from '../db/types.ts';
import type { AppDeps, AppEnv } from '../types.ts';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const REVISION_HEADER = 'X-Data-Revision';

/** Current data revision as header value, or null when the DB cannot be read (corrupt file). */
export function currentRevision(db: DB): string | null {
  try {
    return String(getDataRevision(db));
  } catch {
    return null;
  }
}

/**
 * Bumps meta.data_revision after every successful write (Kap. 5.4, F-36) and puts the revision
 * on every API response so open clients notice changes from other devices.
 */
export function revision(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const status = c.res.status;
    if (WRITE_METHODS.has(c.req.method) && status >= 200 && status < 300 && deps.state.db === 'ok') {
      try {
        bumpDataRevision(deps.db);
      } catch (err) {
        // The write itself succeeded; failing the response now would make the client retry it.
        deps.log.error('data revision bump failed', { requestId: c.get('requestId'), err });
      }
    }
    const value = currentRevision(deps.db);
    if (value !== null) c.header(REVISION_HEADER, value);
  };
}
