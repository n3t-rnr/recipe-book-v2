import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AppError, type ErrorBody, type ErrorCode, isAppError } from '../errors.ts';
import type { AppDeps, AppEnv } from '../types.ts';
import { REQUEST_ID_HEADER } from './request-context.ts';
import { currentRevision, REVISION_HEADER } from './revision.ts';
import { isApiPath, securityHeaderValues } from './security-headers.ts';

/** Hono's own exceptions (e.g. from built-in middleware) mapped onto our codes (Kap. 7.2). */
const HTTP_EXCEPTION_CODES: Partial<Record<number, { code: ErrorCode; message: string }>> = {
  400: { code: 'BAD_REQUEST', message: 'Ungültige Anfrage' },
  404: { code: 'NOT_FOUND', message: 'Nicht gefunden' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Anfrage ist zu groß' },
  415: { code: 'UNSUPPORTED_MEDIA', message: 'Dateityp wird nicht unterstützt' },
};

function toAppError(err: unknown): AppError | null {
  if (isAppError(err)) return err;
  if (err instanceof HTTPException) {
    const known = HTTP_EXCEPTION_CODES[err.status];
    if (known) return new AppError(known.code, known.message);
    if (err.status >= 400 && err.status < 500) return new AppError('BAD_REQUEST', 'Ungültige Anfrage');
  }
  return null;
}

/**
 * Uniform JSON error format (Kap. 7.1). Unexpected errors become 500 INTERNAL; their stack goes
 * to the log only, never into the response (NF-25).
 */
export function errorHandler(deps: AppDeps): ErrorHandler<AppEnv> {
  return (err, c) => {
    // Undefined only in test apps mounted without requestContext.
    const requestId = (c.get('requestId') as string | undefined) ?? '';
    let appError = toAppError(err);
    if (!appError) {
      deps.log.error('unhandled error', { requestId, err });
      appError = new AppError('INTERNAL', 'Unerwarteter Fehler');
    }

    const body: ErrorBody = { error: { code: appError.code, message: appError.message, requestId } };
    if (appError.details !== undefined) body.error.details = appError.details;

    // Middleware that never ran (the error was thrown before it) cannot add its headers,
    // so the error response carries the complete set itself.
    const pathname = c.req.path;
    const headers: Record<string, string> = {
      ...securityHeaderValues(pathname, deps.state.version),
      'Cache-Control': 'no-store',
    };
    if (requestId) headers[REQUEST_ID_HEADER] = requestId;
    if (isApiPath(pathname)) {
      const rev = currentRevision(deps.db);
      if (rev !== null) headers[REVISION_HEADER] = rev;
    }
    return c.json(body, appError.status, headers);
  };
}
