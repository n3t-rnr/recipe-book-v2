// Tag store (client/src/state/tags.svelte.ts): one GET /tags for chip row, filter sheet, tag page and the
// editor autocomplete (F-18 AK3 „lokale Tag-Liste, kein Request je Taste“); it goes stale with every write
// (X-Data-Revision), keeps its list on failure (F-33) and never lets an older answer win.
// Like state-profile.test.ts: Vitest runs without the Svelte plugin, so the test compiles the rune module
// with svelte/compiler and mocks its imports (api.ts, the rune-based connection store).
import fs from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagCount, TagsResponse } from '../../shared/types.ts';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(),
  connection: { dataRevision: null as string | null },
}));

vi.mock('../../client/src/lib/api.ts', () => ({ get: mocks.get }));
vi.mock('../../client/src/state/connection.svelte.ts', () => ({ connection: mocks.connection }));

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STATE_DIR = path.join(ROOT, 'client/src/state');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-store-'));
const require = createRequire(import.meta.url);
/** The browser build of 'svelte' (effects, untrack); Node's resolution would pick the server build. */
const SVELTE_CLIENT = path.join(path.dirname(require.resolve('svelte/package.json')), 'src/index-client.js');

/** Compiles a rune module to plain JS whose imports are absolute, so the mocks above apply to them. */
function compile(source: string, name: string): string {
  const { js } = compileModule(stripTypeScriptTypes(source), { filename: name, generate: 'client' });
  const code = js.code.replace(
    /(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g,
    (_all, head: string, q: string, spec: string) => {
      const target = spec.startsWith('.')
        ? path.resolve(STATE_DIR, spec)
        : spec === 'svelte'
          ? SVELTE_CLIENT
          : require.resolve(spec);
      return `${head}${q}${target.replaceAll('\\', '/')}${q}`;
    },
  );
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, code);
  return file.replaceAll('\\', '/');
}

interface Store {
  list: readonly TagCount[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: unknown;
  readonly stale: boolean;
  ensure(): Promise<void>;
  load(): Promise<void>;
}

const file = compile(fs.readFileSync(path.join(STATE_DIR, 'tags.svelte.ts'), 'utf8'), 'tags.svelte.js');
/** A component-like $effect that calls ensure() without untrack (as a screen might); counts its runs. */
const watchFile = compile(
  `import { tags } from '${file}';
export function watchEnsure(onRun) {
  return $effect.root(() => {
    $effect(() => {
      onRun();
      void tags.ensure();
    });
  });
}`,
  'watch.svelte.js',
);

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A fresh store per test: the module keeps one instance. */
async function freshStore(): Promise<Store> {
  vi.resetModules();
  return ((await import(/* @vite-ignore */ file)) as { tags: Store }).tags;
}

function tag(id: number, name: string, count: number): TagCount {
  return { id, name, count };
}

/**
 * A GET /tags answer the test resolves or rejects later. Like lib/api.ts, the answer's X-Data-Revision
 * reaches the connection store before the body is handed over.
 */
function deferred() {
  let resolve: (tags: TagCount[], revision: number) => void = () => {};
  let reject: (err: Error) => void = () => {};
  const promise = new Promise<TagsResponse>((res, rej) => {
    resolve = (tags, revision) => {
      mocks.connection.dataRevision = String(revision);
      res({ tags, revision });
    };
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Answers the next GET /tags at once. */
function answer(tags: TagCount[], revision: number): void {
  mocks.get.mockImplementationOnce(async () => {
    mocks.connection.dataRevision = String(revision);
    return { tags, revision } satisfies TagsResponse;
  });
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const veg = tag(1, 'Vegetarisch', 12);
const vegan = tag(2, 'Vegan', 3);

beforeEach(() => {
  mocks.get.mockReset();
  mocks.connection.dataRevision = null;
});

describe('tag store: loading', () => {
  it('starts empty and stale', async () => {
    const tags = await freshStore();
    expect(tags.list).toEqual([]);
    expect(tags.status).toBe('idle');
    expect(tags.error).toBeNull();
    expect(tags.stale).toBe(true);
  });

  it('loads GET /tags once and shares the running request', async () => {
    const tags = await freshStore();
    const pending = deferred();
    mocks.get.mockReturnValueOnce(pending.promise);

    const first = tags.ensure();
    const second = tags.ensure();
    expect(second).toBe(first);
    expect(tags.status).toBe('loading');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/tags');

    pending.resolve([veg, vegan], 5);
    await first;
    expect(tags.status).toBe('ready');
    expect(tags.list).toEqual([veg, vegan]);
    expect(tags.stale).toBe(false);

    // Loaded and current: no further request (F-18 AK3: no request per keystroke).
    await tags.ensure();
    await tags.ensure();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('goes stale after any write (new X-Data-Revision) and loads again on ensure()', async () => {
    const tags = await freshStore();
    answer([veg], 5);
    await tags.ensure();
    expect(tags.stale).toBe(false);

    // A write elsewhere answered with revision 6 (own editor save, another device).
    mocks.connection.dataRevision = '6';
    expect(tags.stale).toBe(true);
    expect(tags.status).toBe('ready');

    answer([veg, vegan], 6);
    await tags.ensure();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(tags.list).toEqual([veg, vegan]);
    expect(tags.stale).toBe(false);
  });

  it('stays stale while loading, until the new list is there', async () => {
    const tags = await freshStore();
    answer([veg], 5);
    await tags.load();
    const pending = deferred();
    mocks.get.mockReturnValueOnce(pending.promise);

    const reload = tags.load();
    expect(tags.status).toBe('loading');
    expect(tags.stale).toBe(true);
    // The old list stays visible while loading.
    expect(tags.list).toEqual([veg]);

    pending.resolve([vegan], 5);
    await reload;
    expect(tags.stale).toBe(false);
    expect(tags.list).toEqual([vegan]);
  });

  it('replaces a running load when a write happened after it started', async () => {
    const tags = await freshStore();
    answer([veg], 5);
    await tags.load();
    mocks.connection.dataRevision = '6';
    const before = deferred();
    mocks.get.mockReturnValueOnce(before.promise);
    const first = tags.ensure();

    // Saving a recipe with a new tag answers with revision 7 while the first request runs; its answer
    // may not contain the new tag, so the store must not settle on it.
    mocks.connection.dataRevision = '7';
    const after = deferred();
    mocks.get.mockReturnValueOnce(after.promise);
    const second = tags.ensure();
    expect(second).not.toBe(first);
    expect(mocks.get).toHaveBeenCalledTimes(3);

    const grill = tag(3, 'Grillen', 1);
    after.resolve([veg, grill], 7);
    await second;
    before.resolve([veg], 6);
    await first;
    expect(tags.list).toEqual([veg, grill]);
    expect(tags.status).toBe('ready');
    expect(mocks.connection.dataRevision).toBe('6');
    // The late answer carried an older revision header (as lib/api.ts would note it); the list is newer.
    mocks.connection.dataRevision = '7';
    expect(tags.stale).toBe(false);
  });

  it('drops an older answer arriving after a newer one', async () => {
    const tags = await freshStore();
    const older = deferred();
    const newer = deferred();
    mocks.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const first = tags.load();
    const second = tags.load();
    newer.resolve([veg, vegan], 8);
    await second;
    older.resolve([tag(9, 'Veraltet', 1)], 7);
    await first;

    expect(tags.list).toEqual([veg, vegan]);
    expect(tags.status).toBe('ready');
  });

  it('keeps loading while only the older of two loads answered', async () => {
    const tags = await freshStore();
    const older = deferred();
    const newer = deferred();
    mocks.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    void tags.load();
    const second = tags.load();
    older.resolve([veg], 3);
    await flush();
    expect(tags.status).toBe('loading');
    expect(tags.list).toEqual([]);
    // ensure() waits for the newer load instead of starting a third one.
    expect(tags.ensure()).toBe(second);
    newer.resolve([vegan], 3);
    await second;
    expect(tags.list).toEqual([vegan]);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});

describe('tag store: failure (F-33, NF-09)', () => {
  it('keeps the list, reports the error and resolves', async () => {
    const tags = await freshStore();
    answer([veg], 5);
    await tags.load();

    const offline = new Error('Server nicht erreichbar');
    mocks.get.mockRejectedValueOnce(offline);
    await expect(tags.load()).resolves.toBeUndefined();
    expect(tags.status).toBe('error');
    expect(tags.error).toBe(offline);
    expect(tags.list).toEqual([veg]);
    expect(tags.stale).toBe(true);
  });

  it('never rejects, even when the request throws synchronously', async () => {
    const tags = await freshStore();
    mocks.get.mockImplementationOnce(() => {
      throw new Error('kaputt');
    });
    await expect(tags.ensure()).resolves.toBeUndefined();
    expect(tags.status).toBe('error');
  });

  it('loads again after a failure and clears the error („Erneut versuchen“)', async () => {
    const tags = await freshStore();
    mocks.get.mockRejectedValueOnce(new Error('Zeitüberschreitung'));
    await tags.ensure();
    expect(tags.status).toBe('error');

    answer([veg], 2);
    await tags.ensure();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(tags.status).toBe('ready');
    expect(tags.error).toBeNull();
    expect(tags.list).toEqual([veg]);
  });

  it('ignores the failure of an outdated load', async () => {
    const tags = await freshStore();
    const older = deferred();
    mocks.get.mockReturnValueOnce(older.promise);
    void tags.load();
    answer([veg], 4);
    await tags.load();
    older.reject(new Error('abgebrochen'));
    await flush();
    expect(tags.status).toBe('ready');
    expect(tags.error).toBeNull();
  });
});

describe('tag store in an $effect', () => {
  it('ensure() and load() subscribe the effect to nothing, so a failed load starts no other', async () => {
    const tags = await freshStore();
    const { watchEnsure } = (await import(/* @vite-ignore */ watchFile)) as {
      watchEnsure: (onRun: () => void) => () => void;
    };
    const { flushSync } = (await import(/* @vite-ignore */ SVELTE_CLIENT.replaceAll('\\', '/'))) as {
      flushSync: () => void;
    };
    mocks.connection.dataRevision = '5';
    mocks.get.mockRejectedValue(new Error('Server nicht erreichbar'));
    let runs = 0;

    const stop = watchEnsure(() => {
      runs++;
    });
    flushSync();
    for (let i = 0; i < 5; i++) {
      await flush();
      flushSync();
    }
    stop();

    // status went idle → loading → error, the effect ran once: its only dependency would be its own.
    expect(tags.status).toBe('error');
    expect(runs).toBe(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
