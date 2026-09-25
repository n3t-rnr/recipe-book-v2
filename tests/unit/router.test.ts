// Client router (Kap. 6.2, F-02, F-34): the pure parts (matching, params, query building, redirects, the
// recorded URL per history position) and, on a simulated History API, filter changes inside an open sheet
// (Kap. 6.3: „Änderungen wirken sofort“): the sheet stays open and the page keeps the new URL after Back,
// the close button or a reload (F-34 AK3/AK4).
import fs from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseUrls, pathBefore, recordUrl } from '../../client/src/lib/history-urls.ts';
import {
  buildQuery,
  buildUrl,
  idParam,
  matchPath,
  paths,
  redirectFor,
  routeMeta,
  safeNext,
  titleFor,
} from '../../client/src/lib/routes.ts';

describe('matchPath', () => {
  it('matches every route of Kap. 6.2', () => {
    expect(matchPath('/').name).toBe('root');
    expect(matchPath('/profil').name).toBe('profile');
    expect(matchPath('/rezepte').name).toBe('recipes');
    expect(matchPath('/rezepte/neu').name).toBe('recipeNew');
    expect(matchPath('/rezepte/42').name).toBe('recipe');
    expect(matchPath('/rezepte/42/bearbeiten').name).toBe('recipeEdit');
    expect(matchPath('/favoriten').name).toBe('favorites');
    expect(matchPath('/tags').name).toBe('tags');
    expect(matchPath('/mehr').name).toBe('more');
    expect(matchPath('/mehr/verbinden').name).toBe('connect');
    expect(matchPath('/mehr/papierkorb').name).toBe('trash');
    expect(matchPath('/mehr/status').name).toBe('status');
  });

  it('keeps /rezepte/neu apart from /rezepte/:id', () => {
    expect(matchPath('/rezepte/neu')).toEqual({ name: 'recipeNew', params: {}, path: '/rezepte/neu' });
    expect(matchPath('/rezepte/42')).toEqual({ name: 'recipe', params: { id: '42' }, path: '/rezepte/42' });
    expect(matchPath('/rezepte/neu/bearbeiten').name).toBe('notFound');
  });

  it('accepts only positive integer ids', () => {
    for (const bad of ['/rezepte/abc', '/rezepte/0', '/rezepte/-1', '/rezepte/1.5', '/rezepte/007']) {
      expect(matchPath(bad).name, bad).toBe('notFound');
    }
    expect(matchPath('/rezepte/12345678901234567').name).toBe('notFound');
  });

  it('decodes params and treats malformed escapes as not found', () => {
    expect(matchPath('/rezepte/%34%32')).toMatchObject({ name: 'recipe', params: { id: '42' } });
    expect(matchPath('/rezepte/%6Eeu').name).toBe('recipeNew');
    expect(matchPath('/rezepte/%E0%A4%A').name).toBe('notFound');
    expect(matchPath('/rezepte/4%2F2').name).toBe('notFound');
  });

  it('ignores trailing slashes and keeps paths case-sensitive', () => {
    expect(matchPath('/rezepte/').name).toBe('recipes');
    expect(matchPath('/rezepte/42/').path).toBe('/rezepte/42');
    expect(matchPath('/Rezepte').name).toBe('notFound');
  });

  it('answers unknown app paths with notFound (F-34)', () => {
    expect(matchPath('/gibt-es-nicht')).toEqual({ name: 'notFound', params: {}, path: '/gibt-es-nicht' });
    expect(matchPath('/rezepte/42/kochen').name).toBe('notFound');
  });
});

describe('idParam', () => {
  it('returns the numeric id or null', () => {
    expect(idParam(matchPath('/rezepte/42'))).toBe(42);
    expect(idParam(matchPath('/rezepte'))).toBeNull();
  });
});

describe('buildQuery and buildUrl', () => {
  it('encodes values, keeps commas in lists and skips empty values', () => {
    expect(
      buildQuery({ q: 'käse spätzle', tags: [3, 7], tagMode: 'any', fav: true, minRating: 4, sort: null }),
    ).toBe('q=k%C3%A4se%20sp%C3%A4tzle&tags=3,7&tagMode=any&fav=1&minRating=4');
    expect(buildQuery({ q: '', fav: false, tags: [], sort: undefined })).toBe('');
  });

  it('round-trips through URLSearchParams', () => {
    const query = buildQuery({ q: 'Crème & Brûlée', tags: ['1', '2'] });
    const parsed = new URLSearchParams(query);
    expect(parsed.get('q')).toBe('Crème & Brûlée');
    expect(parsed.get('tags')).toBe('1,2');
  });

  it('builds URLs with and without a query', () => {
    expect(buildUrl('/rezepte')).toBe('/rezepte');
    expect(buildUrl('/rezepte', { sort: 'title' })).toBe('/rezepte?sort=title');
    expect(paths.recipe(42)).toBe('/rezepte/42');
    expect(paths.recipeEdit(42)).toBe('/rezepte/42/bearbeiten');
    expect(paths.recipeNew({ title: 'Spazle' })).toBe('/rezepte/neu?title=Spazle');
    expect(paths.profile({ next: '/rezepte/42' })).toBe('/profil?next=%2Frezepte%2F42');
  });

  it('carries the list filter in detail URLs (two panes from 1024 px, F-34)', () => {
    expect(paths.recipe(42, { tags: [3, 7], q: 'käse' })).toBe('/rezepte/42?tags=3,7&q=k%C3%A4se');
    expect(paths.recipe(42, {})).toBe('/rezepte/42');
    expect(paths.recipe(42, { q: null, tags: [], tagMode: null, sort: null })).toBe('/rezepte/42');
    expect(matchPath(paths.recipe(42, { tags: [3] }).split('?')[0] ?? '')).toMatchObject({
      name: 'recipe',
      params: { id: '42' },
    });
  });
});

describe('redirects (F-02)', () => {
  it('sends "/" to the list or, without a remembered profile, to the profile choice', () => {
    expect(redirectFor(matchPath('/'), '/', true)).toBe('/rezepte');
    expect(redirectFor(matchPath('/'), '/', false)).toBe('/profil');
  });

  it('opens the profile choice first for routes that need a profile and keeps the target', () => {
    expect(redirectFor(matchPath('/rezepte/42'), '/rezepte/42', false)).toBe('/profil?next=%2Frezepte%2F42');
    expect(redirectFor(matchPath('/rezepte/42'), '/rezepte/42', true)).toBeNull();
    expect(redirectFor(matchPath('/profil'), '/profil', false)).toBeNull();
    expect(redirectFor(matchPath('/mehr/verbinden'), '/mehr/verbinden', false)).toBeNull();
    expect(redirectFor(matchPath('/nirgends'), '/nirgends', false)).toBeNull();
  });

  it('accepts only same-origin app paths as "next" target', () => {
    expect(safeNext('/rezepte/42?x=1')).toBe('/rezepte/42?x=1');
    expect(safeNext('//evil.example/rezepte')).toBeNull();
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('/profil')).toBeNull();
    expect(safeNext('/gibt-es-nicht')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

describe('previous history entry without the Navigation API (F-34)', () => {
  it('knows the detail below the editor, so saving goes back instead of stacking a second detail', () => {
    const urls = new Map<number, string>();
    recordUrl(urls, 0, '/rezepte', false); // initial
    recordUrl(urls, 1, '/rezepte/42', true); // open the detail
    recordUrl(urls, 2, '/rezepte/42/bearbeiten', true); // "Bearbeiten"
    recordUrl(urls, 3, '/rezepte/42/bearbeiten', true); // the editor's guard entry
    expect(pathBefore(urls, 2)).toBe('/rezepte/42');
    expect(pathBefore(urls, 1)).toBe('/rezepte');
    expect(pathBefore(urls, 0)).toBeNull();
  });

  it('follows replaced entries and drops forward positions on a push', () => {
    const urls = new Map<number, string>();
    recordUrl(urls, 0, '/rezepte?q=suppe', false);
    recordUrl(urls, 1, '/rezepte/7', true);
    recordUrl(urls, 2, '/rezepte/7/bearbeiten', true);
    // Back to the list, a filter replaces the entry, then a new push discards the forward entries.
    recordUrl(urls, 0, '/rezepte?q=kuchen', false);
    recordUrl(urls, 1, '/rezepte/neu', true);
    expect(pathBefore(urls, 1)).toBe('/rezepte');
    expect(urls.has(2)).toBe(false);
    expect(pathBefore(urls, 3)).toBeNull();
  });

  it('keeps at most 50 positions and survives a reload through sessionStorage', () => {
    const urls = new Map<number, string>();
    for (let i = 0; i < 80; i++) recordUrl(urls, i, `/rezepte/${i + 1}`, true);
    expect(urls.size).toBe(50);
    expect(pathBefore(urls, 79)).toBe('/rezepte/79');
    const restored = parseUrls(JSON.stringify([...urls]));
    expect(restored).toEqual(urls);
    expect(pathBefore(restored, 79)).toBe('/rezepte/79');
  });

  it('ignores unreadable storage', () => {
    expect(parseUrls(null).size).toBe(0);
    expect(parseUrls('kaputt').size).toBe(0);
    expect(parseUrls('{"a":1}').size).toBe(0);
    expect([...parseUrls('[[1,"/rezepte"],[1.5,"/x"],["2","/y"],[3,4],null]')]).toEqual([[1, '/rezepte']]);
  });
});

describe('route meta', () => {
  it('shows list and detail side by side at ≥ 1024 px, the editor full width (NF-08)', () => {
    expect(routeMeta('recipes').twoPane).toBe(true);
    expect(routeMeta('recipe').twoPane).toBe(true);
    expect(routeMeta('favorites').twoPane).toBe(true);
    expect(routeMeta('recipeEdit').twoPane).toBe(false);
  });

  it('puts the FAB only on Rezepte and Favoriten (Kap. 6.2) and hides navigation on the profile choice', () => {
    const withFab = (['recipes', 'favorites', 'tags', 'more', 'recipe', 'recipeNew'] as const).filter(
      (name) => routeMeta(name).fab,
    );
    expect(withFab).toEqual(['recipes', 'favorites']);
    expect(routeMeta('profile').chrome).toBe(false);
  });

  it('titles the document per route', () => {
    expect(titleFor('recipes')).toBe('Rezepte');
    expect(titleFor('trash')).toBe('Papierkorb – Rezepte');
    expect(titleFor('notFound')).toBe('Nicht gefunden – Rezepte');
  });
});

// ---------------------------------------------------------------------------------------------------
// History handling (router.svelte.ts) on a simulated browser

interface HistoryEntry {
  state: unknown;
  url: string;
}

/** Browser-like History API: pushes drop forward entries, back() fires popstate asynchronously. */
class FakeHistory {
  entries: HistoryEntry[];
  index: number;
  scrollRestoration = 'auto';
  readonly #window: EventTarget;

  constructor(window: EventTarget, entries: HistoryEntry[]) {
    this.#window = window;
    this.entries = entries.map((e) => ({ state: structuredClone(e.state), url: e.url }));
    this.index = entries.length - 1;
  }

  get current(): HistoryEntry {
    const entry = this.entries[this.index];
    if (!entry) throw new Error('no current entry');
    return entry;
  }

  get state(): unknown {
    return structuredClone(this.current.state);
  }

  pushState(state: unknown, _title: string, url?: string): void {
    this.entries.splice(this.index + 1);
    this.entries.push({ state: structuredClone(state), url: this.#resolve(url) });
    this.index++;
  }

  replaceState(state: unknown, _title: string, url?: string): void {
    this.entries[this.index] = { state: structuredClone(state), url: this.#resolve(url) };
  }

  back(): void {
    this.go(-1);
  }

  /** Several steps at once, as the long-press history menu of the back button does. */
  go(delta: number): void {
    setTimeout(() => {
      const index = this.index + delta;
      if (index < 0 || index >= this.entries.length) return;
      this.index = index;
      this.#window.dispatchEvent(Object.assign(new Event('popstate'), { state: this.state }));
    }, 0);
  }

  #resolve(url: string | undefined): string {
    if (url === undefined) return this.current.url;
    const u = new URL(url, `http://app.test${this.current.url}`);
    return u.pathname + u.search;
  }
}

type QueryArg = Record<string, string | number | readonly number[] | null>;

interface RouterApi {
  readonly route: { name: string; path: string };
  readonly query: URLSearchParams;
  readonly url: string;
  start(options: { hasProfile: () => boolean }): void;
  navigate(to: string, options?: { replace?: boolean }): void;
  setQuery(query: QueryArg, options?: { replace?: boolean }): void;
  pushOverlay(close: () => void): () => void;
  previousPath(): string | null;
}

const LIB_DIR = fileURLToPath(new URL('../../client/src/lib/', import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-'));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** router.svelte.ts compiled with svelte/compiler (Vitest runs without the Svelte plugin). */
function compileRouter(): string {
  const source = fs.readFileSync(path.join(LIB_DIR, 'router.svelte.ts'), 'utf8');
  const { js } = compileModule(stripTypeScriptTypes(source), {
    filename: 'router.svelte.js',
    generate: 'client',
  });
  const require = createRequire(import.meta.url);
  const code = js.code.replace(
    /(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g,
    (_all, head: string, q: string, spec: string) => {
      const target = spec.startsWith('.') ? path.resolve(LIB_DIR, spec) : require.resolve(spec);
      return `${head}${q}${target.replaceAll('\\', '/')}${q}`;
    },
  );
  const file = path.join(tmpDir, 'router.svelte.js');
  fs.writeFileSync(file, code);
  return file.replaceAll('\\', '/');
}

const routerFile = compileRouter();

/** Waits until queued history steps, their popstate events and follow-up promises are done. */
async function settled(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A new browser tab showing `entries` (the last one current) and a started router in it; `hasProfile`
 * false means no profile is remembered on this device (F-02 redirects).
 */
async function openTab(
  entries: HistoryEntry[],
  hasProfile = true,
): Promise<{ router: RouterApi; history: FakeHistory }> {
  const window = Object.assign(new EventTarget(), { scrollY: 0 });
  const history = new FakeHistory(window, entries);
  const storage = new Map<string, string>();
  const at = (): URL => new URL(history.current.url, 'http://app.test');
  vi.stubGlobal('window', window);
  vi.stubGlobal('history', history);
  vi.stubGlobal('location', {
    get pathname() {
      return at().pathname;
    },
    get search() {
      return at().search;
    },
    get href() {
      return at().href;
    },
    origin: 'http://app.test',
  });
  vi.stubGlobal('document', { title: '', addEventListener: () => {}, documentElement: { scrollTop: 0 } });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0));
  vi.resetModules();
  const { router } = (await import(/* @vite-ignore */ routerFile)) as { router: RouterApi };
  router.start({ hasProfile: () => hasProfile });
  await settled();
  return { router, history };
}

const urls = (history: FakeHistory): string[] => history.entries.map((e) => e.url);

/** Opens a sheet the way Sheet.svelte does; `close` counts the closes the router asks for. */
function openSheet(router: RouterApi): { close: () => void; closes: () => number; release: () => void } {
  let count = 0;
  const close = (): void => {
    count++;
  };
  const release = router.pushOverlay(close);
  return { close, closes: () => count, release };
}

describe('setQuery on the simulated History API', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces the entry without an open sheet (filters never add history steps)', async () => {
    const { router, history } = await openTab([{ state: null, url: '/rezepte' }]);
    router.setQuery({ tags: [3] });
    expect(urls(history)).toEqual(['/rezepte?tags=3']);
    expect(router.query.get('tags')).toBe('3');
    expect(router.url).toBe('/rezepte?tags=3');
  });

  it('keeps an open sheet open and only rewrites its entry', async () => {
    const { router, history } = await openTab([{ state: null, url: '/rezepte' }]);
    const sheet = openSheet(router);
    expect(urls(history)).toEqual(['/rezepte', '/rezepte']);

    router.setQuery({ tags: [3] });
    router.setQuery({ tags: [3, 7], tagMode: 'any' });

    expect(sheet.closes()).toBe(0);
    expect(urls(history)).toEqual(['/rezepte', '/rezepte?tags=3,7&tagMode=any']);
    expect(history.index).toBe(1);
    expect(history.current.state).toMatchObject({ overlay: true });
    expect(router.query.get('tags')).toBe('3,7');
    expect(router.query.get('tagMode')).toBe('any');
    expect(router.url).toBe('/rezepte?tags=3,7&tagMode=any');
    expect(router.route.name).toBe('recipes');
  });

  it('Back closes the sheet and the page keeps the new filter (F-34 AK4)', async () => {
    const { router, history } = await openTab([{ state: null, url: '/rezepte' }]);
    const sheet = openSheet(router);
    router.setQuery({ tags: [3] });

    history.back();
    await settled();

    expect(sheet.closes()).toBe(1);
    expect(history.index).toBe(0);
    expect(urls(history)[0]).toBe('/rezepte?tags=3');
    expect(history.current.state).not.toMatchObject({ overlay: true });
    expect(router.url).toBe('/rezepte?tags=3');
    expect(router.query.get('tags')).toBe('3');
  });

  it('the close button leaves no extra history step and keeps the filter', async () => {
    const { router, history } = await openTab([{ state: null, url: '/rezepte' }]);
    const sheet = openSheet(router);
    router.setQuery({ tags: [5] });

    sheet.release(); // the sheet closed itself (close button, Escape)
    await settled();
    expect(history.index).toBe(0);
    expect(history.current.url).toBe('/rezepte?tags=5');
    expect(router.url).toBe('/rezepte?tags=5');

    // Open a recipe and come back: one Back step, the filter is still there.
    router.navigate('/rezepte/9');
    expect(urls(history)).toEqual(['/rezepte?tags=5', '/rezepte/9']);
    expect(router.previousPath()).toBe('/rezepte');
    history.back();
    await settled();
    expect(router.url).toBe('/rezepte?tags=5');
    expect(router.query.get('tags')).toBe('5');
  });

  it('a reload with the sheet open keeps the filter set in it (F-34 AK3)', async () => {
    const { router, history } = await openTab([
      { state: { key: 'k1', idx: 0 }, url: '/rezepte' },
      { state: { key: 'k1', idx: 1, overlay: true }, url: '/rezepte?tags=3,7' },
    ]);
    expect(history.index).toBe(0);
    expect(urls(history)[0]).toBe('/rezepte?tags=3,7');
    expect(history.current.state).toEqual({ key: 'k1', idx: 0 });
    expect(router.url).toBe('/rezepte?tags=3,7');
    expect(router.query.get('tags')).toBe('3,7');
  });

  it('a reload with the sheet open and no filter change keeps the page as it was', async () => {
    const { router, history } = await openTab([
      { state: { key: 'k1', idx: 0 }, url: '/rezepte?q=suppe' },
      { state: { key: 'k1', idx: 1, overlay: true }, url: '/rezepte?q=suppe' },
    ]);
    expect(history.index).toBe(0);
    expect(urls(history)).toEqual(['/rezepte?q=suppe', '/rezepte?q=suppe']);
    expect(router.url).toBe('/rezepte?q=suppe');
  });

  it('hands the URL down through stacked overlays to the page entry', async () => {
    const { router, history } = await openTab([{ state: null, url: '/rezepte' }]);
    const lower = openSheet(router);
    const upper = openSheet(router);
    router.setQuery({ sort: 'title' });
    expect(urls(history)).toEqual(['/rezepte', '/rezepte', '/rezepte?sort=title']);

    history.back(); // closes the upper sheet only
    await settled();
    expect(upper.closes()).toBe(1);
    expect(lower.closes()).toBe(0);
    expect(history.index).toBe(1);
    expect(urls(history).slice(0, 2)).toEqual(['/rezepte', '/rezepte?sort=title']);

    lower.release();
    await settled();
    expect(history.index).toBe(0);
    expect(history.current.url).toBe('/rezepte?sort=title');
    expect(router.url).toBe('/rezepte?sort=title');
  });

  it('forgets the handover when a navigation replaces the open sheet', async () => {
    const { router, history } = await openTab([{ state: null, url: '/rezepte' }]);
    const sheet = openSheet(router);
    router.setQuery({ tags: [3] });
    router.navigate('/rezepte/9');
    expect(sheet.closes()).toBe(1);
    expect(history.current.url).toBe('/rezepte/9');

    // A later sheet on the detail must not get the list URL when it closes.
    const detailSheet = openSheet(router);
    detailSheet.release();
    await settled();
    expect(history.current.url).toBe('/rezepte/9');
    expect(router.url).toBe('/rezepte/9');
    expect(router.route.name).toBe('recipe');
  });

  it('waits for a closing sheet before rewriting the entry of the next one', async () => {
    const { router, history } = await openTab([{ state: null, url: '/rezepte' }]);
    const first = openSheet(router);
    first.release(); // its entry is being removed
    const second = openSheet(router); // pushed after that step
    router.setQuery({ tags: [4] });
    await settled();

    expect(second.closes()).toBe(0);
    expect(history.index).toBe(1);
    expect(urls(history)).toEqual(['/rezepte', '/rezepte?tags=4']);
    expect(router.query.get('tags')).toBe('4');

    history.back();
    await settled();
    expect(second.closes()).toBe(1);
    expect(urls(history)[0]).toBe('/rezepte?tags=4');
  });

  it('a reload with the sheet open that redirects gives the page entry the redirected URL', async () => {
    // No profile remembered any more (deleted on another device): the list redirects to the choice.
    const { router, history } = await openTab(
      [
        { state: { key: 'k1', idx: 0 }, url: '/rezepte' },
        { state: { key: 'k1', idx: 1, overlay: true }, url: '/rezepte?tags=3' },
      ],
      false,
    );
    const choice = paths.profile({ next: '/rezepte?tags=3' });
    expect(router.route.name).toBe('profile');
    expect(history.index).toBe(0);
    expect(history.current.url).toBe(choice);
    expect(router.url).toBe(choice);
  });

  it('a jump back past the page (history menu) shows that page and leaves its entry alone', async () => {
    const { router, history } = await openTab([{ state: null, url: '/rezepte/5' }]);
    router.navigate('/rezepte');
    const sheet = openSheet(router);
    router.setQuery({ tags: [3] });

    history.go(-2);
    await settled();
    expect(sheet.closes()).toBe(1);
    expect(history.index).toBe(0);
    expect(urls(history)).toEqual(['/rezepte/5', '/rezepte', '/rezepte?tags=3']);
    expect(router.route.name).toBe('recipe');
    expect(router.url).toBe('/rezepte/5');

    // Nothing is handed over later either: a sheet on the detail closes without touching the URL.
    const detailSheet = openSheet(router);
    detailSheet.release();
    await settled();
    expect(history.current.url).toBe('/rezepte/5');
  });

  it('a jump back over two open overlays of the page (history menu) closes both', async () => {
    const { router, history } = await openTab([{ state: null, url: '/rezepte/5' }]);
    router.navigate('/rezepte');
    const lower = openSheet(router);
    const upper = openSheet(router);
    router.setQuery({ tags: [3] });

    history.go(-2); // from the upper overlay's entry straight to the list's own entry
    await settled();
    expect(upper.closes()).toBe(1);
    expect(lower.closes()).toBe(1);
    expect(history.index).toBe(1);
    expect(history.current.url).toBe('/rezepte?tags=3');
    expect(history.current.state).not.toMatchObject({ overlay: true });
    expect(router.route.name).toBe('recipes');
    expect(router.url).toBe('/rezepte?tags=3');

    // The lower sheet's own close (its component unmounts) must not step back once more: that would
    // leave the list for the detail below it while the list stays on screen.
    lower.release();
    upper.release();
    await settled();
    expect(history.index).toBe(1);
    expect(history.current.url).toBe('/rezepte?tags=3');
    expect(router.previousPath()).toBe('/rezepte/5');
  });

  it('leaves the page URL alone when a sheet closes without a filter change', async () => {
    const { router, history } = await openTab([{ state: null, url: '/rezepte?q=suppe' }]);
    const sheet = openSheet(router);
    sheet.release();
    await settled();
    expect(history.index).toBe(0);
    expect(history.current.url).toBe('/rezepte?q=suppe');
    expect(router.url).toBe('/rezepte?q=suppe');
  });
});
