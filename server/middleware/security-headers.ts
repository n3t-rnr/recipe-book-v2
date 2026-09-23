import type { MiddlewareHandler } from 'hono';
import type { AppDeps, AppEnv } from '../types.ts';

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Headers every response carries (NF-21), plus the API extras from Kap. 7.1.
 * Exported because responses produced before this middleware runs (host check, error handler)
 * must carry them too.
 */
export function securityHeaderValues(pathname: string, version: string): Record<string, string> {
  if (!isApiPath(pathname)) return { ...BASE_HEADERS };
  return { ...BASE_HEADERS, 'Cache-Control': 'no-store', 'X-App-Version': version };
}

export function securityHeaders(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    // Set after next(): c.header() on a finalized context also reaches raw Response objects
    // (static files), which prepared headers set before next() would miss.
    for (const [name, value] of Object.entries(securityHeaderValues(c.req.path, deps.state.version))) {
      c.header(name, value);
    }
  };
}
