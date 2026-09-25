// lib/api.ts keeps a server error code only when it is one of Kap. 7.2 (ERROR_CODES); anything else,
// including the client-side codes NETWORK and TIMEOUT, becomes INTERNAL. api.ts derives the known codes
// from ERROR_TEXTS (NF-01), so this pins that it still matches ERROR_CODES exactly.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_TEXTS } from '../../client/src/i18n/de.ts';
import { ERROR_CODES } from '../../shared/error-codes.ts';

// The real connection store uses runes (compiled by the Svelte plugin only); api.ts needs just its methods.
vi.mock('../../client/src/state/connection.svelte.ts', () => ({
  connection: { markOffline: vi.fn(), markOnline: vi.fn(), noteHeaders: vi.fn() },
}));

const { get } = await import('../../client/src/lib/api.ts');

function serverError(code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: '' } }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function codeFor(sent: string): Promise<unknown> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => serverError(sent)),
  );
  return get('/profiles', { profile: false }).then(
    () => undefined,
    (err: unknown) => (err as { code?: unknown }).code,
  );
}

describe('server error codes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps every code of Kap. 7.2', async () => {
    for (const code of ERROR_CODES) expect(await codeFor(code), code).toBe(code);
  });

  it('maps client-side, unknown and prototype names to INTERNAL', async () => {
    const known = new Set<string>(ERROR_CODES);
    const clientOnly = Object.keys(ERROR_TEXTS).filter((code) => !known.has(code));
    expect(clientOnly).toContain('NETWORK');
    for (const code of [...clientOnly, 'NOPE', 'constructor', '__proto__', 'toString']) {
      expect(await codeFor(code), code).toBe('INTERNAL');
    }
  });

  it('falls back to the German text of the code when the message is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => serverError('NOT_FOUND')),
    );
    await expect(get('/profiles', { profile: false })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: ERROR_TEXTS.NOT_FOUND,
    });
  });
});
