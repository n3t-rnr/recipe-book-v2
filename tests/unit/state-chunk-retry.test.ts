// Route chunks after a reconnect (lib/chunk-retry.ts, NF-09): the browser keeps a failed chunk import
// failed, so the view that shows it reloads the page once the server answers — at most once per pause,
// so a chunk that is really missing cannot cause a reload loop.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChunkRetry, mayReloadForChunk, RELOAD_PAUSE_MS } from '../../client/src/lib/chunk-retry.ts';

/** Lets the .then callbacks of settled promises run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(start = 'tags') {
  let where = start;
  const chunks = new ChunkRetry(() => where);
  return {
    chunks,
    go: (view: string) => {
      where = view;
    },
  };
}

function fail(chunks: ChunkRetry): void {
  chunks.track(Promise.reject(new Error('offline'))).catch(() => {});
}

describe('ChunkRetry', () => {
  it('reports a failed chunk of the view shown now', async () => {
    const { chunks } = setup();
    expect(chunks.failed).toBe(false);
    fail(chunks);
    await settle();
    expect(chunks.failed).toBe(true);
  });

  it('forgets the failure once a newer load succeeded', async () => {
    const { chunks, go } = setup();
    fail(chunks);
    await settle();
    go('more');
    void chunks.track(Promise.resolve('ok'));
    await settle();
    go('tags');
    expect(chunks.failed).toBe(false);
  });

  it('ignores an older load that settles after a newer one', async () => {
    const { chunks, go } = setup('more');
    let resolveOld: (value: string) => void = () => {};
    void chunks.track(
      new Promise<string>((resolve) => {
        resolveOld = resolve;
      }),
    );
    go('tags');
    fail(chunks);
    await settle();
    resolveOld('late');
    await settle();
    expect(chunks.failed).toBe(true);
  });

  it('does not report a view the user has already left', async () => {
    const { chunks, go } = setup('tags');
    fail(chunks);
    await settle();
    go('recipes');
    expect(chunks.failed).toBe(false);
  });

  it('passes the promise through unchanged', async () => {
    const { chunks } = setup();
    const mod = { default: 'Tags' };
    await expect(chunks.track(Promise.resolve(mod))).resolves.toBe(mod);
    const err = new Error('offline');
    await expect(chunks.track(Promise.reject(err))).rejects.toBe(err);
  });
});

describe('mayReloadForChunk', () => {
  function stubStorage(storageThrows = false): Record<string, string> {
    const stored: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => {
        if (storageThrows) throw new Error('SecurityError');
        return stored[key] ?? null;
      },
      setItem: (key: string, value: string) => {
        stored[key] = value;
      },
    });
    return stored;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows the first reload and notes the time', () => {
    const stored = stubStorage();
    expect(mayReloadForChunk(1_000_000)).toBe(true);
    expect(Object.values(stored)).toEqual(['1000000']);
  });

  it('refuses another reload within the pause (the reloaded page failed the same way)', () => {
    stubStorage();
    expect(mayReloadForChunk(1_000_000)).toBe(true);
    expect(mayReloadForChunk(1_000_000 + RELOAD_PAUSE_MS - 1)).toBe(false);
    expect(mayReloadForChunk(1_000_000 + RELOAD_PAUSE_MS)).toBe(true);
  });

  it('refuses without session storage, so it can never loop', () => {
    stubStorage(true);
    expect(mayReloadForChunk(1_000_000)).toBe(false);
  });
});
