import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppDeps, AppEnv } from '../types.ts';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * First middleware: assigns the request id and writes exactly one log line per request (NF-25).
 * The durations in this line are the evidence for the performance budgets (NF-04, NF-05).
 */
export function requestContext(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    const requestId = randomUUID();
    c.set('requestId', requestId);
    // Stays 500 if next() rejects: Hono only routes Error instances to onError, anything else
    // bubbles up to here and is answered by the app-level error handler afterwards.
    let status = 500;
    try {
      await next();
      c.header(REQUEST_ID_HEADER, requestId);
      status = c.res.status;
    } finally {
      const durationMs = Math.round((performance.now() - start) * 10) / 10;
      const fields = { requestId, method: c.req.method, path: c.req.path, status, durationMs };
      if (status >= 500) deps.log.error('request', fields);
      else deps.log.info('request', fields);
    }
  };
}
