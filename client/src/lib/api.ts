/**
 * The only way the client talks to the server (Kap. 7.1): base /api/v1, app header, profile header,
 * 10 s timeout (NF-09), typed errors with German messages (NF-10) and connection tracking (F-33).
 */
import { API_BASE, CLIENT_HEADER, PROFILE_HEADER } from '../../../shared/constants.ts';
import { ERROR_CODES, type ErrorCode } from '../../../shared/error-codes.ts';
import { type ClientErrorCode, ERROR_TEXTS } from '../i18n/de.ts';
import { connection } from '../state/connection.svelte.ts';
import { buildQuery, type QueryInput } from './routes.ts';

/** Requests give up after 10 s so the UI can offer "Erneut versuchen" (NF-09). */
export const REQUEST_TIMEOUT_MS = 10_000;

export type ApiErrorCode = ErrorCode | ClientErrorCode;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Error of every API call. `message` is German: the server's message, else the text from de.ts. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(
    code: ApiErrorCode,
    message: string,
    extra: { status?: number; details?: unknown; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = extra.status ?? 0;
    this.details = extra.details;
    this.requestId = extra.requestId ?? null;
  }
}

/** True when the caller's AbortSignal cancelled the request (outdated search etc.); show nothing. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** German text for any thrown value, for toasts and error states. */
export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : ERROR_TEXTS.INTERNAL;
}

export interface RequestOptions {
  /** JSON body; sets Content-Type: application/json. */
  body?: unknown;
  query?: QueryInput;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** false omits X-Profile-Id (profile management works without an active profile, Kap. 7.1). */
  profile?: boolean;
}

// Hooks set by state/profile.svelte.ts; kept as setters so api.ts does not import the profile store.
let profileSource: () => number | null = () => null;
let profileUnknownHandler: (id: number) => void = () => {};

export function setProfileSource(source: () => number | null): void {
  profileSource = source;
}

/**
 * Called when the server rejects a profile with 401 PROFILE_UNKNOWN (F-02), with the id the request
 * carried: after a switch it may differ from the active one.
 */
export function setProfileUnknownHandler(handler: (id: number) => void): void {
  profileUnknownHandler = handler;
}

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

interface WireError {
  error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown };
}

function toApiError(res: Response, data: unknown): ApiError {
  const error = (data as WireError | undefined)?.error;
  const headerId = res.headers.get('X-Request-Id');
  if (error && typeof error.code === 'string') {
    const code: ErrorCode = KNOWN_CODES.has(error.code) ? (error.code as ErrorCode) : 'INTERNAL';
    const message =
      typeof error.message === 'string' && error.message.trim() !== '' ? error.message : ERROR_TEXTS[code];
    const requestId = typeof error.requestId === 'string' ? error.requestId : headerId;
    return new ApiError(code, message, { status: res.status, details: error.details, requestId });
  }
  // Not our JSON: something in between answered, e.g. the Vite dev proxy while the server is down.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return new ApiError('NETWORK', ERROR_TEXTS.NETWORK, { status: res.status });
  }
  return new ApiError('INTERNAL', ERROR_TEXTS.INTERNAL, { status: res.status, requestId: headerId });
}

/**
 * Sends a request to `${API_BASE}${path}` and returns the parsed JSON body (undefined for 204).
 * Throws ApiError (codes of Kap. 7.2 plus NETWORK and TIMEOUT) or the caller's AbortError.
 */
export async function request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, signal, timeoutMs = REQUEST_TIMEOUT_MS, profile = true } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = (): void => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });

  const headers: Record<string, string> = { Accept: 'application/json', [CLIENT_HEADER]: '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const profileId = profile ? profileSource() : null;
  if (profileId !== null) headers[PROFILE_HEADER] = String(profileId);
  const q = query ? buildQuery(query) : '';
  const url = `${API_BASE}${path}${q === '' ? '' : `?${q}`}`;

  const failure = (err: unknown): unknown => {
    if (timedOut) return new ApiError('TIMEOUT', ERROR_TEXTS.TIMEOUT);
    if (signal?.aborted) return isAbortError(err) ? err : new DOMException('Abgebrochen', 'AbortError');
    connection.markOffline();
    return new ApiError('NETWORK', ERROR_TEXTS.NETWORK);
  };

  try {
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      text = await res.text();
    } catch (err) {
      throw failure(err);
    }
    connection.noteHeaders(res.headers.get('X-Data-Revision'), res.headers.get('X-App-Version'));

    let data: unknown;
    if (text !== '') {
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined;
      }
    }
    if (res.ok) {
      connection.markOnline();
      // Our own server is trusted; runtime validation of input lives in the editor chunk (NF-02).
      return data as T;
    }
    const error = toApiError(res, data);
    if (error.code === 'NETWORK') connection.markOffline();
    else connection.markOnline();
    if (error.code === 'PROFILE_UNKNOWN' && profileId !== null) profileUnknownHandler(profileId);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

type ReadOptions = Omit<RequestOptions, 'body'>;

export function get<T>(path: string, options?: ReadOptions): Promise<T> {
  return request<T>('GET', path, options);
}

export function post<T>(path: string, body?: unknown, options?: ReadOptions): Promise<T> {
  return request<T>('POST', path, { ...options, body });
}

export function put<T>(path: string, body?: unknown, options?: ReadOptions): Promise<T> {
  return request<T>('PUT', path, { ...options, body });
}

export function patch<T>(path: string, body?: unknown, options?: ReadOptions): Promise<T> {
  return request<T>('PATCH', path, { ...options, body });
}

export function del<T = undefined>(path: string, options?: ReadOptions): Promise<T> {
  return request<T>('DELETE', path, options);
}

/** Cheap reachability check for "Erneut versuchen" and the online event; true when the server answers. */
export async function ping(): Promise<boolean> {
  try {
    await get<{ dataRevision: string }>('/revision', { profile: false });
    return true;
  } catch {
    return false;
  }
}
