// 401 PROFILE_UNKNOWN (F-02): lib/api.ts reports the profile id the rejected request carried, so the
// profile store drops exactly that entry (and forgets it only when it is still the active one).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real connection store uses runes (compiled by the Svelte plugin only); api.ts needs just its methods.
vi.mock('../../client/src/state/connection.svelte.ts', () => ({
  connection: { markOffline: vi.fn(), markOnline: vi.fn(), noteHeaders: vi.fn() },
}));

const { get, setProfileSource, setProfileUnknownHandler } = await import('../../client/src/lib/api.ts');

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('PROFILE_UNKNOWN handler', () => {
  const handler = vi.fn<(id: number) => void>();
  let currentId: number | null = 7;

  beforeEach(() => {
    currentId = 7;
    handler.mockReset();
    setProfileSource(() => currentId);
    setProfileUnknownHandler(handler);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes the id the rejected request carried', async () => {
    const fetchMock = vi.fn(async () =>
      answer(401, { error: { code: 'PROFILE_UNKNOWN', message: 'Profil nicht mehr vorhanden' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pending = get('/recipes');
    // The user switches to another profile while the request runs: the handler still gets 7.
    currentId = 9;
    await expect(pending).rejects.toMatchObject({ code: 'PROFILE_UNKNOWN', status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(7);
  });

  it('is not called for requests without a profile or for other errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer(401, { error: { code: 'PROFILE_UNKNOWN', message: 'x' } })),
    );
    await expect(get('/profiles', { profile: false })).rejects.toMatchObject({ code: 'PROFILE_UNKNOWN' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer(404, { error: { code: 'NOT_FOUND', message: 'x' } })),
    );
    await expect(get('/recipes/1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(handler).not.toHaveBeenCalled();
  });
});
