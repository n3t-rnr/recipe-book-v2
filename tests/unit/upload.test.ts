// Photo upload of the editor (client/src/lib/upload.ts; F-14, NF-09, Kap. 7.5) against a fake
// XMLHttpRequest: request shape, progress, the inactivity timeout (not a total timeout), error mapping
// with the server's German messages, abort, and the draft photo check (GET /images/:id).
// connection.svelte.ts uses runes, which need the Svelte compiler; Vitest runs without it, so it is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, CLIENT_HEADER, LIMITS, PROFILE_HEADER } from '../../shared/constants.ts';
import type { ImageInfo, ImageUploadResponse } from '../../shared/types.ts';

const mocks = vi.hoisted(() => ({
  markOffline: vi.fn(),
  markOnline: vi.fn(),
  noteHeaders: vi.fn(),
}));

vi.mock('../../client/src/state/connection.svelte.ts', () => ({
  connection: {
    markOffline: mocks.markOffline,
    markOnline: mocks.markOnline,
    noteHeaders: mocks.noteHeaders,
    onReconnect: () => () => {},
  },
}));

const { ApiError } = await import('../../client/src/lib/api.ts');
const { ERROR_TEXTS } = await import('../../client/src/i18n/de.ts');
const {
  UPLOAD_HEADERS,
  UPLOAD_INACTIVITY_MS,
  UPLOAD_URL,
  imageState,
  photoPending,
  toDetailImage,
  tooLarge,
  uploadError,
  uploadImage,
} = await import('../../client/src/lib/upload.ts');
type XhrLike = import('../../client/src/lib/upload.ts').XhrLike;
type ProgressLike = import('../../client/src/lib/upload.ts').ProgressLike;
type UploadProgress = import('../../client/src/lib/upload.ts').UploadProgress;

const ANSWER: ImageUploadResponse = {
  imageId: 42,
  urls: {
    s: '/media/0123456789abcdef-s.webp',
    m: '/media/0123456789abcdef-m.webp',
    l: '/media/0123456789abcdef-l.webp',
  },
  width: 2048,
  height: 1536,
};

function progressEvent(loaded: number, total: number, lengthComputable = true): ProgressLike {
  return { loaded, total, lengthComputable };
}

class FakeXhr implements XhrLike {
  status = 0;
  responseText = '';
  readonly upload: XhrLike['upload'] = { onprogress: null, onload: null };
  onprogress: XhrLike['onprogress'] = null;
  onload: XhrLike['onload'] = null;
  onerror: XhrLike['onerror'] = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  responseHeaders: Record<string, string> = {};
  body: Blob | null = null;
  aborted = false;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name] ?? null;
  }

  send(body: Blob): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
  }

  sendProgress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.onprogress?.(progressEvent(loaded, total, lengthComputable));
  }

  bodySent(): void {
    this.upload.onload?.(progressEvent(1, 1));
  }

  respond(status: number, body: unknown, headers: Record<string, string> = {}): void {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.responseHeaders = headers;
    this.onload?.(progressEvent(0, 0));
  }

  fail(): void {
    this.onerror?.(progressEvent(0, 0));
  }
}

function jpeg(bytes = 1000, type = 'image/jpeg'): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function start(file: Blob = jpeg(), extra: { profileId?: number | null; signal?: AbortSignal } = {}) {
  const xhr = new FakeXhr();
  const progress: UploadProgress[] = [];
  const promise = uploadImage(file, {
    profileId: extra.profileId === undefined ? 3 : extra.profileId,
    onprogress: (p) => progress.push(p),
    createXhr: () => xhr,
    ...(extra.signal ? { signal: extra.signal } : {}),
  });
  // Unhandled rejections would fail the run before an assertion looks at them.
  promise.catch(() => {});
  return { xhr, progress, promise };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.markOffline.mockClear();
  mocks.markOnline.mockClear();
  mocks.noteHeaders.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shared values kept as literals (NF-01, see upload.ts)', () => {
  it('match shared/constants.ts and de.ts', async () => {
    const { deEditor } = await import('../../client/src/i18n/de-editor.ts');
    expect(UPLOAD_URL).toBe(`${API_BASE}/images`);
    expect(UPLOAD_HEADERS).toEqual({ client: CLIENT_HEADER, profile: PROFILE_HEADER });
    expect(deEditor.photo.errors.NETWORK).toBe(ERROR_TEXTS.NETWORK);
    expect(deEditor.photo.errors.INTERNAL).toBe(ERROR_TEXTS.INTERNAL);
  });
});

describe('uploadImage: request', () => {
  it('posts the raw file with the app and profile headers (Kap. 7.1, 7.5)', async () => {
    const file = jpeg(1234);
    const { xhr, promise } = start(file);
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/v1/images');
    expect(xhr.body).toBe(file);
    expect(xhr.headers).toEqual({
      'Content-Type': 'image/jpeg',
      Accept: 'application/json',
      'X-Rezepte-Client': '1',
      'X-Profile-Id': '3',
    });
    xhr.respond(201, ANSWER, { 'X-Data-Revision': '7', 'X-App-Version': '0.1.0' });
    await expect(promise).resolves.toEqual(ANSWER);
    expect(mocks.noteHeaders).toHaveBeenCalledWith('7', '0.1.0');
    expect(mocks.markOnline).toHaveBeenCalled();
  });

  it('keeps PNG and WebP types and sends anything else as octet-stream (the magic bytes decide)', () => {
    expect(start(jpeg(10, 'image/png')).xhr.headers['Content-Type']).toBe('image/png');
    expect(start(jpeg(10, 'image/webp')).xhr.headers['Content-Type']).toBe('image/webp');
    // HEIC must reach the server to get the 415 with the hint, not a 400 for the Content-Type.
    expect(start(jpeg(10, 'image/heic')).xhr.headers['Content-Type']).toBe('application/octet-stream');
    expect(start(jpeg(10, '')).xhr.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('omits X-Profile-Id without an active profile', () => {
    expect(start(jpeg(), { profileId: null }).xhr.headers['X-Profile-Id']).toBeUndefined();
  });

  it('rejects an answer that is not an image', async () => {
    const { xhr, promise } = start();
    xhr.respond(201, { imageId: 'x' });
    await expect(promise).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

describe('uploadImage: progress', () => {
  it('reports the sent fraction, then processing once the body is on the server', async () => {
    const { xhr, progress, promise } = start(jpeg(1000));
    xhr.sendProgress(250, 1000);
    xhr.sendProgress(720, 1000);
    // Without a computable length the file size is the total.
    xhr.sendProgress(900, 0, false);
    xhr.bodySent();
    xhr.respond(201, ANSWER);
    await promise;
    expect(progress).toEqual([
      { fraction: 0.25, processing: false },
      { fraction: 0.72, processing: false },
      { fraction: 0.9, processing: false },
      { fraction: 1, processing: true },
    ]);
  });
});

describe('uploadImage: inactivity timeout (NF-09)', () => {
  it('gives up after 30 s without progress', async () => {
    const { xhr, promise } = start();
    vi.advanceTimersByTime(UPLOAD_INACTIVITY_MS - 1);
    expect(xhr.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(xhr.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(UPLOAD_INACTIVITY_MS).toBe(30_000);
  });

  it('is not a total timeout: 12 MB at 1 Mbit/s (about 100 s) completes while progress keeps coming', async () => {
    const size = 12 * 1024 * 1024;
    const { xhr, promise } = start(jpeg(size));
    // 1 Mbit/s = 125 000 bytes per second; browsers report progress about every 50 ms, here once a second.
    let sent = 0;
    while (sent < size) {
      vi.advanceTimersByTime(1000);
      sent = Math.min(size, sent + 125_000);
      xhr.sendProgress(sent, size);
    }
    xhr.bodySent();
    // The server processes the photo (≤ 2 s, F-15) before it answers.
    vi.advanceTimersByTime(2000);
    xhr.respond(201, ANSWER);
    await expect(promise).resolves.toEqual(ANSWER);
    expect(xhr.aborted).toBe(false);
  });

  it('restarts the timer on every progress event, also while the server processes', async () => {
    const { xhr, promise } = start();
    vi.advanceTimersByTime(29_000);
    xhr.sendProgress(500, 1000);
    vi.advanceTimersByTime(29_000);
    xhr.bodySent();
    vi.advanceTimersByTime(29_000);
    expect(xhr.aborted).toBe(false);
    vi.advanceTimersByTime(1000);
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('stops the timer after the answer', async () => {
    const { xhr, promise } = start();
    xhr.respond(201, ANSWER);
    await promise;
    vi.advanceTimersByTime(UPLOAD_INACTIVITY_MS * 2);
    expect(xhr.aborted).toBe(false);
  });
});

describe('uploadImage: errors', () => {
  it('passes the server messages of 413, 415 (HEIC hint), 503 and 507 through', async () => {
    const heic =
      'Bitte als JPEG speichern – iPhone: Einstellungen > Kamera > Formate > Maximale Kompatibilität; Android: in der Kamera-App HEIF ausschalten';
    const cases = [
      { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Bild hat zu viele Pixel (max. 60 MP)' },
      { status: 415, code: 'UNSUPPORTED_MEDIA', message: heic, details: { reason: 'heic' } },
      {
        status: 503,
        code: 'IMAGES_UNAVAILABLE',
        message: 'Die Bildverarbeitung ist gerade nicht verfügbar.',
      },
      {
        status: 507,
        code: 'INSUFFICIENT_STORAGE',
        message: 'Der Speicher auf dem Rezepte-PC ist fast voll.',
      },
    ];
    for (const c of cases) {
      const { xhr, promise } = start();
      xhr.respond(c.status, {
        error: { code: c.code, message: c.message, details: c.details, requestId: 'r1' },
      });
      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ code: c.code, message: c.message, status: c.status, requestId: 'r1' });
      if (c.details) expect((err as InstanceType<typeof ApiError>).details).toEqual(c.details);
    }
    expect(mocks.markOffline).not.toHaveBeenCalled();
  });

  it('maps a network failure to NETWORK and marks the connection offline', async () => {
    const { xhr, promise } = start();
    xhr.sendProgress(100, 1000);
    xhr.fail();
    await expect(promise).rejects.toMatchObject({ code: 'NETWORK', message: ERROR_TEXTS.NETWORK });
    expect(mocks.markOffline).toHaveBeenCalledOnce();
  });

  it('treats a proxy 502–504 without our JSON as offline, other foreign answers as INTERNAL', () => {
    expect(uploadError(502, '<html>Bad Gateway</html>')).toMatchObject({ code: 'NETWORK' });
    expect(uploadError(504, '')).toMatchObject({ code: 'NETWORK' });
    expect(uploadError(500, 'kaputt', 'req-9')).toMatchObject({ code: 'INTERNAL', requestId: 'req-9' });
  });

  it('keeps the message of an unexpected code and falls back to a German text without one', () => {
    expect(
      uploadError(418, JSON.stringify({ error: { code: 'TEAPOT', message: 'Ich bin eine Kanne' } })),
    ).toMatchObject({ code: 'INTERNAL', message: 'Ich bin eine Kanne' });
    expect(
      uploadError(413, JSON.stringify({ error: { code: 'PAYLOAD_TOO_LARGE', message: ' ' } })),
    ).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: ERROR_TEXTS.INTERNAL,
    });
  });
});

describe('uploadImage: abort', () => {
  it('rejects with an AbortError and aborts the request', async () => {
    const controller = new AbortController();
    const { xhr, promise } = start(jpeg(), { signal: controller.signal });
    xhr.sendProgress(10, 1000);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(xhr.aborted).toBe(true);
    // A late answer or timer changes nothing.
    xhr.respond(201, ANSWER);
    vi.advanceTimersByTime(UPLOAD_INACTIVITY_MS);
    expect(mocks.markOffline).not.toHaveBeenCalled();
  });

  it('does not start with an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const xhr = new FakeXhr();
    const promise = uploadImage(jpeg(), { profileId: 1, signal: controller.signal, createXhr: () => xhr });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(xhr.url).toBe('');
  });
});

describe('helpers', () => {
  it('rejects files over 20 MiB before sending (F-14 AK)', () => {
    expect(tooLarge({ size: LIMITS.uploadBytes } as Blob)).toBe(false);
    expect(tooLarge({ size: LIMITS.uploadBytes + 1 } as Blob)).toBe(true);
    expect(tooLarge({ size: 25 * 1024 * 1024 } as Blob)).toBe(true);
  });

  it('turns the upload answer into the form image', () => {
    const image = toDetailImage(ANSWER);
    expect(image).toEqual({ id: 42, urls: ANSWER.urls, width: 2048, height: 1536 });
    expect(image.urls).not.toBe(ANSWER.urls);
  });
});

describe('photoPending: leaving the editor would lose the chosen photo (F-14)', () => {
  it('holds while the photo uploads or its upload can be repeated', () => {
    expect(photoPending('sending', true)).toBe(true);
    expect(photoPending('processing', true)).toBe(true);
    expect(photoPending('failed', true)).toBe(true);
  });

  it('does not hold once the photo is in the form, without a choice, or for a refused file (413, 415)', () => {
    expect(photoPending('done', true)).toBe(false);
    expect(photoPending('failed', false)).toBe(false);
    // "retryable" only matters for a failed upload.
    expect(photoPending('sending', false)).toBe(true);
    expect(photoPending('done', false)).toBe(false);
  });
});

describe('imageState (draft photo check, F-09 AK)', () => {
  it('asks GET /images/:id and maps 404 to missing, other failures to unknown', async () => {
    const info: ImageInfo = { ...ANSWER, assigned: false };
    const paths: string[] = [];
    expect(
      await imageState(42, async (path) => {
        paths.push(path);
        return info;
      }),
    ).toBe('present');
    expect(paths).toEqual(['/images/42']);
    expect(
      await imageState(42, async () => {
        throw new ApiError('NOT_FOUND', 'Nicht gefunden', { status: 404 });
      }),
    ).toBe('missing');
    expect(
      await imageState(42, async () => {
        throw new ApiError('NETWORK', ERROR_TEXTS.NETWORK);
      }),
    ).toBe('unknown');
  });
});
