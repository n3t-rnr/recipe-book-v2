import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { API_BASE, CLIENT_HEADER, LIMITS } from '../../shared/constants.ts';
import { AppError } from '../errors.ts';
import type { AppDeps, AppEnv } from '../types.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Raw image upload (F-14, M3): own content types and its own, larger size limit in the route. */
const UPLOAD_PATH = `${API_BASE}/images`;
const UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream']);

function mediaType(header: string | undefined): string {
  return (header ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function hasBody(req: Request, viaNodeServer: boolean): boolean {
  if (req.headers.has('transfer-encoding')) return true;
  const length = req.headers.get('content-length');
  if (length !== null) return Number(length) > 0;
  // Real HTTP/1.1: neither header means no body (RFC 9112 §6.3). @hono/node-server still attaches the
  // (empty) request stream, so only in-process requests (app.request in tests) consult the stream.
  if (viaNodeServer) return false;
  return req.body !== null;
}

const jsonLimit = bodyLimit({
  maxSize: LIMITS.jsonBodyBytes,
  onError: () => {
    throw new AppError('PAYLOAD_TOO_LARGE', 'Anfrage ist zu groß (max. 1 MB)');
  },
});

/**
 * Cross-site protection for writes (NF-21): a foreign web page can neither set the custom header
 * nor send application/json without a CORS preflight, which this server never answers positively.
 * Also enforces read-only mode (NF-19) and the JSON body limit (Kap. 7.1).
 */
export function clientGuard(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();

    if (c.req.header(CLIENT_HEADER) !== '1') {
      throw new AppError('BAD_REQUEST', 'Anfrage ohne App-Kennung abgelehnt');
    }

    const isUpload = c.req.path === UPLOAD_PATH;
    const viaNodeServer = Boolean((c.env as { incoming?: unknown } | undefined)?.incoming);
    if (hasBody(c.req.raw, viaNodeServer)) {
      const type = mediaType(c.req.header('content-type'));
      const accepted = isUpload ? UPLOAD_TYPES.has(type) : type === 'application/json';
      if (!accepted) throw new AppError('BAD_REQUEST', 'Falscher Inhaltstyp');
    }

    if (deps.state.db === 'corrupt') {
      throw new AppError('READ_ONLY', 'Datenbank beschädigt – nur Lesen möglich');
    }

    if (isUpload) return next();
    return jsonLimit(c, next);
  };
}
