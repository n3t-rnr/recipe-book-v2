// The recipe list follows X-Data-Revision (F-36 light, client/src/lib/recipes.ts ListRevision): a write
// answered while a reload runs, e.g. "Rückgängig" right after deleting, must make the list load again,
// otherwise the restored recipe is missing and the count is one too low.
import { describe, expect, it, vi } from 'vitest';

// lib/recipes.ts calls the API through lib/api.ts, whose connection store needs the Svelte compiler.
vi.mock('../../client/src/lib/api.ts', () => ({ get: vi.fn() }));

const { ListRevision } = await import('../../client/src/lib/recipes.ts');

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
