import { API_BASE, CLIENT_HEADER } from '../../shared/constants.ts';

/** Requests give up after 10 s so the UI can offer "Erneut versuchen" (NF-09). */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * network: server unreachable · timeout: no answer within 10 s · http: error status · parse: body is not JSON ·
 * aborted: the caller's signal fired (nothing to show).
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse' | 'aborted';

/** Error of every API call; `code` is the server's error code (Kap. 7.2) or the kind for client-side failures. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;

  constructor(kind: ApiErrorKind, message: string, status = 0, code: string = kind) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

/** GET `${API_BASE}${path}` and return the JSON body; every failure becomes an ApiError. */
export async function getJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  // A caller's signal (e.g. leaving the view) aborts the same request as the timeout.
  const outer = init.signal;
  const forwardAbort = (): void => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', forwardAbort, { once: true });

  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set(CLIENT_HEADER, '1');

  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { ...init, method: 'GET', headers, signal: controller.signal });
    } catch (err) {
      if (timedOut) throw new ApiError('timeout', 'Zeitüberschreitung');
      if (controller.signal.aborted) throw new ApiError('aborted', 'Abgebrochen');
      throw new ApiError('network', err instanceof Error ? err.message : 'Netzwerkfehler');
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      if (timedOut) throw new ApiError('timeout', 'Zeitüberschreitung');
      if (controller.signal.aborted) throw new ApiError('aborted', 'Abgebrochen');
      throw new ApiError(res.ok ? 'parse' : 'http', `Ungültige Antwort (${res.status})`, res.status);
    }

    if (!res.ok) {
      const error = (body as ErrorBody | null)?.error;
      const code = typeof error?.code === 'string' ? error.code : 'http';
      const message = typeof error?.message === 'string' ? error.message : `HTTP ${res.status}`;
      throw new ApiError('http', message, res.status, code);
    }
    // The server is our own and trusted; runtime validation lives in the editor chunk (zod/mini, NF-02).
    return body as T;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forwardAbort);
  }
}
