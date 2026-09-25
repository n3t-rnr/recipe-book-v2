// The recipe list follows X-Data-Revision (F-36 light, client/src/lib/recipes.ts ListRevision): a write
// answered while a reload runs, e.g. "Rückgängig" right after deleting, must make the list load again,
// otherwise the restored recipe is missing and the count is one too low.
// The list snapshots are kept per filter (F-34 AK2: „Bis Rezept 30 scrollen, öffnen, Zurück → Rezept 30
// ist wieder im Sichtbereich, die Filter sind unverändert“), and GET /recipes carries the filter.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeCard } from '../../shared/types.ts';

// lib/recipes.ts calls the API through lib/api.ts, whose connection store needs the Svelte compiler.
const get = vi.hoisted(() => vi.fn<(path: string, options?: unknown) => Promise<unknown>>());
vi.mock('../../client/src/lib/api.ts', () => ({ get }));

const { ListRevision, cachedCard, fetchRecipePage, readListSnapshot, writeListSnapshot } = await import(
  '../../client/src/lib/recipes.ts'
);
type ListSnapshot = NonNullable<ReturnType<typeof readListSnapshot>>;

function card(id: number, title: string): RecipeCard {
  return {
    id,
    title,
    image: null,
    tags: [],
    moreTags: 0,
    ratingAvg: null,
    ratingCount: 0,
    myRating: null,
    isFavorite: null,
    totalMinutes: null,
    updatedAt: '2026-09-01T10:00:00.000Z',
  };
}

function snapshot(total: number, extra: Partial<ListSnapshot> = {}): ListSnapshot {
  return { items: [card(total, `Rezept ${total}`)], nextCursor: null, total, revision: '1', ...extra };
}

describe('list snapshots per filter (F-34)', () => {
  it('reads null for another filter and the own snapshot for the same one', () => {
    const vegetarian = snapshot(14, { totalAll: 38 });
    writeListSnapshot(vegetarian, 'tags=3&sort=newest');
    expect(readListSnapshot('tags=3&sort=newest')).toBe(vegetarian);
    expect(readListSnapshot('tags=7&sort=newest')).toBeNull();
    expect(readListSnapshot('q=suppe&sort=relevance')).toBeNull();
  });

  it('keeps the unfiltered list under the default key', () => {
    const all = snapshot(38);
    writeListSnapshot(all);
    expect(readListSnapshot()).toBe(all);
    expect(readListSnapshot('')).toBe(all);
    const filtered = snapshot(2, { totalAll: 38, didYouMean: null });
    writeListSnapshot(filtered, 'q=kuchen&sort=relevance');
    expect(readListSnapshot()).toBe(all);
    expect(readListSnapshot('q=kuchen&sort=relevance')?.totalAll).toBe(38);
  });

  it('replaces the snapshot of the same filter', () => {
    writeListSnapshot(snapshot(1), 'sort=title');
    const newer = snapshot(2);
    writeListSnapshot(newer, 'sort=title');
    expect(readListSnapshot('sort=title')).toBe(newer);
  });

  it('keeps 4 filters: a 5th drops the least recently used one', () => {
    for (const key of ['a', 'b', 'c', 'd']) writeListSnapshot(snapshot(1), key);
    writeListSnapshot(snapshot(1), 'e');
    expect(readListSnapshot('a')).toBeNull();
    for (const key of ['b', 'c', 'd', 'e']) expect(readListSnapshot(key), key).not.toBeNull();
  });

  it('counts showing a list again as use, so Back to it keeps its snapshot', () => {
    for (const key of ['a', 'b', 'c', 'd']) writeListSnapshot(snapshot(1), key);
    // Back to list "a" shows its snapshot, then two new filters are tried.
    expect(readListSnapshot('a')).not.toBeNull();
    writeListSnapshot(snapshot(1), 'e');
    writeListSnapshot(snapshot(1), 'f');
    expect(readListSnapshot('a')).not.toBeNull();
    expect(readListSnapshot('b')).toBeNull();
    expect(readListSnapshot('c')).toBeNull();
  });

  it('feeds the card cache of the detail from every snapshot (F-29)', () => {
    writeListSnapshot({ ...snapshot(1), items: [card(501, 'Käsespätzle')] }, 'q=kase&sort=relevance');
    expect(cachedCard(501)?.title).toBe('Käsespätzle');
  });
});

describe('fetchRecipePage (GET /recipes)', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ items: [], nextCursor: null, total: 0, totalAll: 0 });
  });

  it('sends the list filter with cursor and limit', async () => {
    const signal = new AbortController().signal;
    await fetchRecipePage('abc', 40, signal, { q: 'kase', tags: [3, 7], tagMode: 'any', sort: 'relevance' });
    expect(get).toHaveBeenCalledWith('/recipes', {
      query: { q: 'kase', tags: [3, 7], tagMode: 'any', sort: 'relevance', cursor: 'abc', limit: 40 },
      signal,
    });
  });

  it('works without a filter and clamps the page size', async () => {
    await fetchRecipePage(null, 500);
    expect(get).toHaveBeenCalledWith('/recipes', { query: { cursor: null, limit: 100 } });
    await fetchRecipePage(null, 0);
    expect(get).toHaveBeenLastCalledWith('/recipes', { query: { cursor: null, limit: 1 } });
  });

  it('never lets the filter override cursor or limit', async () => {
    await fetchRecipePage('next', 10, undefined, { cursor: 'x', limit: 99 });
    expect(get).toHaveBeenCalledWith('/recipes', { query: { cursor: 'next', limit: 10 } });
  });
});

describe('ListRevision (F-36 light)', () => {
  it('reloads once more when "Rückgängig" is answered while the reload runs', () => {
    // The list shows revision 4; deleting answered with 5, so the list reloads.
    const list = new ListRevision('4');
    expect(list.seen('5')).toBe(true);
    list.start('5');
    // The restore answers with 6 before the list page arrives.
    expect(list.seen('6')).toBe(false);
    // The page was answered before the restore: it belongs to 5, not to 6.
    expect(list.done('6')).toBe(true);
    expect(list.shown).toBe('5');
    // The second reload brings the restored recipe.
    list.start('6');
    expect(list.done('6')).toBe(false);
    expect(list.shown).toBe('6');
  });

  it('reloads once more even when the older page answer comes last and hides the newer revision', () => {
    const list = new ListRevision('5');
    list.start('5');
    list.seen('6'); // restore answered
    list.seen('5'); // the list page, handled before the restore, answered afterwards
    expect(list.done('5')).toBe(true);
  });

  it('needs no second reload when nothing was written meanwhile', () => {
    const list = new ListRevision('7');
    expect(list.seen('7')).toBe(false);
    list.start('7');
    expect(list.seen('7')).toBe(false);
    expect(list.done('7')).toBe(false);
    expect(list.shown).toBe('7');
  });

  it('takes the revision of the answer when none was known before the first load', () => {
    const list = new ListRevision(null);
    list.start(null);
    expect(list.seen('3')).toBe(false);
    expect(list.done('3')).toBe(false);
    expect(list.shown).toBe('3');
  });

  it('asks for a reload only for a different known revision while none runs', () => {
    expect(new ListRevision(null).seen('2')).toBe(false);
    expect(new ListRevision('2').seen(null)).toBe(false);
    expect(new ListRevision('2').seen('2')).toBe(false);
    expect(new ListRevision('2').seen('3')).toBe(true);
  });

  it('forgets a failed reload, so the next revision triggers one again', () => {
    const list = new ListRevision('2');
    list.start('3');
    list.stop();
    expect(list.shown).toBe('2');
    expect(list.seen('3')).toBe(true);
  });

  it('starts every reload without the notes of the one before', () => {
    const list = new ListRevision('1');
    list.start('1');
    list.seen('2');
    // A newer reload replaces the running one; it already asks for revision 2.
    list.start('2');
    expect(list.done('2')).toBe(false);
  });
});
