/**
 * Photo upload of the editor (F-14, NF-09, Kap. 7.5): POST /api/v1/images with the file as raw body via
 * XMLHttpRequest, because fetch reports no upload progress. Unlike API requests (10 s in total) an upload
 * only gives up after 30 s without any progress, so a 12 MB photo over a slow WLAN still completes.
 * Errors are ApiErrors with the server's German message (413, 415 with the HEIC hint, 503, 507) or
 * NETWORK/TIMEOUT; a cancelled upload rejects with an AbortError. Part of the lazy editor chunk.
 *
 * NF-01: the lazy editor takes few bindings from the entry chunk; each one adds an export to it. When
 * this was written, a separate shared chunk made that cost ~0.8 KB of initial JS, hence the literals
 * below. Since the entry-chunk group in vite.config.ts it costs only a few bytes, so importing the
 * constants would now be fine; tests/unit/upload.test.ts checks that the literals equal
 * shared/constants.ts and the texts of de.ts.
 */
import { LIMITS } from '../../../shared/constants.ts';
import type { ErrorCode } from '../../../shared/error-codes.ts';
import type { DetailImage, ImageInfo, ImageUploadResponse } from '../../../shared/types.ts';
import { deEditor } from '../i18n/de-editor.ts';
import { connection } from '../state/connection.svelte.ts';
import { ApiError, get } from './api.ts';

/** `${API_BASE}/images` (Kap. 7.5). */
export const UPLOAD_URL = '/api/v1/images';
/** CLIENT_HEADER and PROFILE_HEADER of shared/constants.ts (Kap. 7.1). */
export const UPLOAD_HEADERS = { client: 'X-Rezepte-Client', profile: 'X-Profile-Id' } as const;

/** An upload gives up after this long without progress (NF-09 AK), not after a total time. */
export const UPLOAD_INACTIVITY_MS = 30_000;

/** Types the server takes as Content-Type; anything else goes as octet-stream and the magic bytes decide. */
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Codes POST /images can answer with (Kap. 7.2, 7.5); others count as INTERNAL but keep their message. */
const UPLOAD_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'BAD_REQUEST',
  'PROFILE_REQUIRED',
  'PROFILE_UNKNOWN',
  'NOT_FOUND',
  'MISDIRECTED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA',
  'INTERNAL',
  'IMAGES_UNAVAILABLE',
  'READ_ONLY',
  'INSUFFICIENT_STORAGE',
]);
const TEXTS = deEditor.photo.errors;

/** The fields of ProgressEvent the upload reads (no DOM types: the unit tests type-check without them). */
export interface ProgressLike {
  readonly loaded: number;
  readonly total: number;
  readonly lengthComputable: boolean;
}

type Handler = ((event: ProgressLike) => void) | null;

/** The part of XMLHttpRequest the upload uses; tests pass a fake. */
export interface XhrLike {
  readonly status: number;
  readonly responseText: string;
  readonly upload: { onprogress: Handler; onload: Handler };
  onprogress: Handler;
  onload: Handler;
  onerror: Handler;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  getResponseHeader(name: string): string | null;
  send(body: Blob): void;
  abort(): void;
}

/** The browser's XMLHttpRequest; reached through globalThis, since lib/upload.ts is also type-checked for Node. */
function browserXhr(): XhrLike {
  const { XMLHttpRequest: Xhr } = globalThis as unknown as { XMLHttpRequest: new () => XhrLike };
  return new Xhr();
}

export interface UploadProgress {
  /** 0–1 of the body sent. */
  fraction: number;
  /** true once the body is on the server and it processes the image (F-15). */
  processing: boolean;
}

export interface UploadOptions {
  /** Active profile for X-Profile-Id (Kap. 7.1). */
  profileId: number | null;
  onprogress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  inactivityMs?: number;
  createXhr?: () => XhrLike;
}

/** State of the photo section's upload (ImagePicker); 'done' also when nothing was chosen. */
export type UploadPhase = 'sending' | 'processing' | 'done' | 'failed';

/**
 * A chosen photo is not in the form yet, and leaving the editor would lose it (F-14): it is uploading,
 * or its upload failed and "Erneut hochladen" can still send it. A file the server refused (413, 415)
 * cannot be sent again, so nothing is lost with it.
 */
export function photoPending(phase: UploadPhase, retryable: boolean): boolean {
  return phase === 'sending' || phase === 'processing' || (phase === 'failed' && retryable);
}

/** Too big for the server (F-14 AK): the client rejects it before sending. */
export function tooLarge(file: Blob): boolean {
  return file.size > LIMITS.uploadBytes;
}

/** The form's image from the server's answer (same shape as RecipeDetail.image). */
export function toDetailImage(res: ImageUploadResponse): DetailImage {
  return { id: res.imageId, urls: { ...res.urls }, width: res.width, height: res.height };
}

function readUpload(data: unknown): ImageUploadResponse | null {
  const d = data as Partial<ImageUploadResponse> | null;
  const urls = d?.urls;
  const ok =
    typeof d?.imageId === 'number' &&
    typeof d.width === 'number' &&
    typeof d.height === 'number' &&
    typeof urls?.s === 'string' &&
    typeof urls.m === 'string' &&
    typeof urls.l === 'string';
  return ok ? (d as ImageUploadResponse) : null;
}

function parseJson(text: string): unknown {
  try {
    return text === '' ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Server error body → ApiError; like lib/api.ts, a proxy's 502–504 without our JSON counts as offline. */
export function uploadError(status: number, text: string, headerId: string | null = null): ApiError {
  const error = (parseJson(text) as { error?: Record<string, unknown> } | undefined)?.error;
  if (error && typeof error.code === 'string') {
    const code: ErrorCode = UPLOAD_CODES.has(error.code) ? (error.code as ErrorCode) : 'INTERNAL';
    const message =
      typeof error.message === 'string' && error.message.trim() !== '' ? error.message : TEXTS.INTERNAL;
    const requestId = typeof error.requestId === 'string' ? error.requestId : headerId;
    return new ApiError(code, message, { status, details: error.details, requestId });
  }
  if (status === 502 || status === 503 || status === 504) {
    return new ApiError('NETWORK', TEXTS.NETWORK, { status });
  }
  return new ApiError('INTERNAL', TEXTS.INTERNAL, { status, requestId: headerId });
}

/**
 * Uploads one photo. Resolves with the unassigned image (201); the recipe gets it with imageId on save.
 * Progress drives the bar; every progress event restarts the inactivity timer.
 */
export function uploadImage(file: Blob, options: UploadOptions): Promise<ImageUploadResponse> {
  const {
    profileId,
    onprogress,
    signal,
    inactivityMs = UPLOAD_INACTIVITY_MS,
    createXhr = browserXhr,
  } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Abgebrochen', 'AbortError'));
      return;
    }
    const xhr = createXhr();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    const finish = (): void => {
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (err: unknown): void => {
      if (done) return;
      finish();
      reject(err);
    };
    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        xhr.abort();
        fail(new ApiError('TIMEOUT', TEXTS.TIMEOUT));
      }, inactivityMs);
    };
    function onAbort(): void {
      xhr.abort();
      fail(new DOMException('Abgebrochen', 'AbortError'));
    }

    xhr.upload.onprogress = (event) => {
      arm();
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      onprogress?.({ fraction: total > 0 ? Math.min(1, event.loaded / total) : 0, processing: false });
    };
    xhr.upload.onload = () => {
      arm();
      onprogress?.({ fraction: 1, processing: true });
    };
    xhr.onprogress = arm;
    xhr.onerror = () => {
      connection.markOffline();
      fail(new ApiError('NETWORK', TEXTS.NETWORK));
    };
    xhr.onload = () => {
      if (done) return;
      finish();
      connection.noteHeaders(
        xhr.getResponseHeader('X-Data-Revision'),
        xhr.getResponseHeader('X-App-Version'),
      );
      if (xhr.status === 201 || xhr.status === 200) {
        const res = readUpload(parseJson(xhr.responseText));
        connection.markOnline();
        if (res) resolve(res);
        else reject(new ApiError('INTERNAL', TEXTS.INTERNAL, { status: xhr.status }));
        return;
      }
      const error = uploadError(xhr.status, xhr.responseText, xhr.getResponseHeader('X-Request-Id'));
      if (error.code === 'NETWORK') connection.markOffline();
      else connection.markOnline();
      reject(error);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.open('POST', UPLOAD_URL);
    xhr.setRequestHeader('Content-Type', IMAGE_TYPES.has(file.type) ? file.type : 'application/octet-stream');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader(UPLOAD_HEADERS.client, '1');
    if (profileId !== null) xhr.setRequestHeader(UPLOAD_HEADERS.profile, String(profileId));
    arm();
    xhr.send(file);
  });
}

/** Result of checking a draft's photo on the server (F-09 AK). */
export type ImageState = 'present' | 'missing' | 'unknown';

/** GET /images/:id: 404 = deleted (unassigned uploads expire after 7 days); other failures are unknown. */
export async function imageState(
  id: number,
  load: (path: string) => Promise<ImageInfo> = (path) => get<ImageInfo>(path),
): Promise<ImageState> {
  try {
    await load(`/images/${id}`);
    return 'present';
  } catch (err) {
    return err instanceof ApiError && err.code === 'NOT_FOUND' ? 'missing' : 'unknown';
  }
}
