// Profile store (client/src/state/profile.svelte.ts): 401 PROFILE_UNKNOWN drops the deleted profile
// from the choice and reloads the list (F-02); a list that failed while offline reloads after the
// reconnect (NF-09); an older answer never overwrites a newer one.
// The store uses runes, which only the Svelte compiler understands, and Vitest runs without the Svelte
// plugin: the test strips the types, compiles the module with svelte/compiler and imports the result;
// its imports point to the real files, and the rune-based ones (router, connection) plus api.ts are mocked.
import fs from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../../shared/types.ts';

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    ApiError,
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(),
    unknownHandler: null as ((id: number) => void) | null,
    reconnect: [] as Array<() => void>,
    navigate: vi.fn<(url: string, options?: unknown) => void>(),
    routeName: 'recipes',
  };
});

vi.mock('../../client/src/lib/api.ts', () => ({
  ApiError: mocks.ApiError,
  get: mocks.get,
  setProfileSource: () => {},
  setProfileUnknownHandler: (handler: (id: number) => void) => {
    mocks.unknownHandler = handler;
  },
}));

vi.mock('../../client/src/lib/router.svelte.ts', () => ({
  router: {
    get route() {
      return { name: mocks.routeName, params: {}, path: '/rezepte' };
    },
    url: '/rezepte',
    navigate: mocks.navigate,
  },
}));

vi.mock('../../client/src/state/connection.svelte.ts', () => ({
  connection: {
    onReconnect: (listener: () => void) => {
      mocks.reconnect.push(listener);
      return () => {};
    },
  },
}));

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STATE_DIR = path.join(ROOT, 'client/src/state');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-store-'));

/** Compiles the store to plain JS whose imports are absolute, so the mocks above apply to them. */
function compileStore(): string {
  const source = fs.readFileSync(path.join(STATE_DIR, 'profile.svelte.ts'), 'utf8');
  const { js } = compileModule(stripTypeScriptTypes(source), {
    filename: 'profile.svelte.js',
    generate: 'client',
  });
  const require = createRequire(import.meta.url);
  const code = js.code.replace(
    /(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g,
    (_all, head: string, q: string, spec: string) => {
      const target = spec.startsWith('.') ? path.resolve(STATE_DIR, spec) : require.resolve(spec);
      return `${head}${q}${target.replaceAll('\\', '/')}${q}`;
    },
  );
  const file = path.join(tmpDir, 'profile.svelte.js');
  fs.writeFileSync(file, code);
  return file.replaceAll('\\', '/');
}

interface Store {
  id: number | null;
  list: Profile[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  notice: string | null;
  readonly current: Profile | null;
  readonly stale: boolean;
  load(): Promise<void>;
  select(id: number): void;
}

const { profile } = (await import(/* @vite-ignore */ compileStore())) as { profile: Store };

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function p(id: number, name: string): Profile {
  return { id, name, avatar: 'avatar-1', initials: name.slice(0, 1), ratingCount: 0, favoriteCount: 0 };
}

/** A GET /profiles answer the test resolves or rejects later. */
function deferred() {
  let resolve: (profiles: Profile[]) => void = () => {};
  let reject: (err: Error) => void = () => {};
  const promise = new Promise<unknown>((res, rej) => {
    resolve = (profiles) => res({ profiles });
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function loaded(profiles: Profile[], activeId: number | null): Promise<void> {
  mocks.get.mockResolvedValueOnce({ profiles });
  await profile.load();
  profile.id = activeId;
  profile.notice = null;
}

const anna = p(1, 'Anna');
const ben = p(2, 'Ben');

beforeEach(() => {
  mocks.get.mockReset();
  mocks.navigate.mockReset();
  mocks.routeName = 'recipes';
});

describe('profile store: 401 PROFILE_UNKNOWN (F-02)', () => {
  it('registers a handler with lib/api.ts', () => {
    expect(mocks.unknownHandler).toBeTypeOf('function');
  });

  it('drops the deleted active profile, opens the choice with a notice and reloads the list', async () => {
    await loaded([anna, ben], 1);
    const reload = deferred();
    mocks.get.mockReturnValueOnce(reload.promise);

    mocks.unknownHandler?.(1);

    // Gone from the choice at once, before the reload answers.
    expect(profile.list.map((x) => x.id)).toEqual([2]);
    expect(profile.id).toBeNull();
    expect(profile.notice).toBe('Profil nicht mehr vorhanden');
    expect(mocks.navigate).toHaveBeenCalledWith('/profil?next=%2Frezepte', { replace: true });
    expect(mocks.get).toHaveBeenCalledWith('/profiles', { profile: false });
    expect(profile.stale).toBe(false);

    reload.resolve([ben, p(3, 'Clara')]);
    await flush();
    expect(profile.list.map((x) => x.id)).toEqual([2, 3]);
    expect(profile.status).toBe('ready');
  });

  it('keeps the active profile when the rejected id belongs to the profile used before a switch', async () => {
    await loaded([anna, ben], 2);
    mocks.get.mockResolvedValueOnce({ profiles: [ben] });

    mocks.unknownHandler?.(1);

    expect(profile.id).toBe(2);
    expect(profile.notice).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(profile.list.map((x) => x.id)).toEqual([2]);
    await flush();
    expect(profile.current?.name).toBe('Ben');
  });

  it('drops an answer of a load that started before the 401 and arrives after the reload', async () => {
    await loaded([anna, ben], 2);
    const before = deferred();
    const after = deferred();
    mocks.get.mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise);

    void profile.load();
    mocks.unknownHandler?.(1);
    after.resolve([ben]);
    await flush();
    before.resolve([anna, ben]);
    await flush();

    expect(profile.list.map((x) => x.id)).toEqual([2]);
  });
});

describe('profile store: reload after a reconnect (NF-09)', () => {
  it('reloads a list that failed while the server was away', async () => {
    mocks.get.mockRejectedValueOnce(new mocks.ApiError('NETWORK', 'Server nicht erreichbar'));
    await profile.load();
    expect(profile.status).toBe('error');
    expect(profile.stale).toBe(true);

    mocks.get.mockResolvedValueOnce({ profiles: [anna] });
    for (const listener of mocks.reconnect) listener();
    await flush();

    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(profile.status).toBe('ready');
    expect(profile.list.map((x) => x.id)).toEqual([1]);
  });

  it('leaves a loaded list alone', async () => {
    await loaded([anna], 1);
    mocks.get.mockClear();
    for (const listener of mocks.reconnect) listener();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(profile.stale).toBe(false);
  });
});
