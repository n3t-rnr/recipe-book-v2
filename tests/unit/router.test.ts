// Pure parts of the client router (Kap. 6.2, F-02, F-34): matching, params, query building, redirects,
// the recorded URL per history position (previousPath).
import { describe, expect, it } from 'vitest';
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
