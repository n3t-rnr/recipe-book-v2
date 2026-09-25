// Pure helpers and texts of the tag page /tags (client/src/lib/tag-page.ts, client/src/i18n/de-screens-tags.ts):
// the client check of a tag name (F-17: 1–40 characters), the guard for 409 TAG_EXISTS details, the field
// message of a 400, the focus target after a row disappears (NF-11) and the exact F-19 AK texts.
import { describe, expect, it } from 'vitest';
import { dt } from '../../client/src/i18n/de-screens-tags.ts';
import { checkTagName, fieldMessage, neighbourId, readTagExists } from '../../client/src/lib/tag-page.ts';
import { LIMITS } from '../../shared/constants.ts';
import { INVALID_TAG_NAMES, VALID_TAG_NAMES } from '../fixtures/tag-names.ts';

describe('checkTagName', () => {
  it('collapses whitespace and trims like the editor', () => {
    expect(checkTagName('  Low  Carb ')).toEqual({ name: 'Low Carb' });
    expect(checkTagName('Schnell  &\teinfach')).toEqual({ name: 'Schnell & einfach' });
  });

  it('refuses an empty or blank name with „Bitte gib einen Namen ein.“', () => {
    expect(checkTagName('')).toEqual({ error: 'Bitte gib einen Namen ein.' });
    expect(checkTagName('   ')).toEqual({ error: dt.nameMissing });
    expect(checkTagName('\n\t')).toEqual({ error: dt.nameMissing });
  });

  it('refuses more than 40 characters (F-17) and accepts exactly 40', () => {
    expect(LIMITS.tagName).toBe(40);
    expect(checkTagName('x'.repeat(41))).toEqual({ error: 'Ein Tag darf höchstens 40 Zeichen lang sein.' });
    expect(checkTagName('x'.repeat(40))).toEqual({ name: 'x'.repeat(40) });
    // Counted after trimming, so surrounding spaces do not count.
    expect(checkTagName(`  ${'y'.repeat(40)}  `)).toEqual({ name: 'y'.repeat(40) });
    expect(checkTagName('abcdef', 5)).toEqual({ error: dt.nameTooLong(5) });
  });

  it('lets every valid tag name of the shared fixture through unchanged (F-17 AK1)', () => {
    for (const name of VALID_TAG_NAMES) expect(checkTagName(name), name).toEqual({ name });
  });

  it('refuses the blank and too long invalid names; the server refuses the others', () => {
    const refused = INVALID_TAG_NAMES.filter((name) => 'error' in checkTagName(name));
    expect(refused).toEqual(['', '   ', 'x'.repeat(41)]);
  });
});

describe('readTagExists', () => {
  const valid = { targetId: 7, targetName: 'Dessert', affectedRecipes: 7 };

  it('returns the details of 409 TAG_EXISTS', () => {
    expect(readTagExists(valid)).toEqual(valid);
    expect(readTagExists({ ...valid, affectedRecipes: 0 })).toEqual({ ...valid, affectedRecipes: 0 });
    // Extra fields are dropped.
    expect(readTagExists({ ...valid, extra: true })).toEqual(valid);
  });

  it('returns null for missing or wrongly typed fields', () => {
    const broken: unknown[] = [
      undefined,
      null,
      'Dessert',
      [valid],
      {},
      { targetName: 'Dessert', affectedRecipes: 7 },
      { targetId: 7, affectedRecipes: 7 },
      { targetId: 7, targetName: 'Dessert' },
      { ...valid, targetId: '7' },
      { ...valid, targetId: 0 },
      { ...valid, targetId: 1.5 },
      { ...valid, targetId: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, targetName: '' },
      { ...valid, targetName: '   ' },
      { ...valid, targetName: 42 },
      { ...valid, affectedRecipes: -1 },
      { ...valid, affectedRecipes: 2.5 },
      { ...valid, affectedRecipes: null },
    ];
    for (const details of broken) expect(readTagExists(details), JSON.stringify(details)).toBeNull();
  });
});

describe('fieldMessage', () => {
  it('takes the message of the first validation detail', () => {
    const details = [
      { field: 'name', message: 'Name enthält unerlaubte Zeichen' },
      { field: 'name', message: 'zweite' },
    ];
    expect(fieldMessage(details, 'Eingaben prüfen')).toBe('Name enthält unerlaubte Zeichen');
  });

  it('falls back to the error message without a usable detail', () => {
    for (const details of [undefined, null, [], {}, [{}], [{ message: '' }], [{ message: 3 }], ['x']]) {
      expect(fieldMessage(details, 'Eingaben prüfen'), JSON.stringify(details)).toBe('Eingaben prüfen');
    }
  });
});

describe('neighbourId', () => {
  const rows = [{ id: 4 }, { id: 9 }, { id: 2 }];

  it('picks the next row, else the previous one', () => {
    expect(neighbourId(rows, 4)).toBe(9);
    expect(neighbourId(rows, 9)).toBe(2);
    expect(neighbourId(rows, 2)).toBe(9);
  });

  it('gives null for the only row or an unknown id (the search field takes the focus)', () => {
    expect(neighbourId([{ id: 4 }], 4)).toBeNull();
    expect(neighbourId(rows, 5)).toBeNull();
    expect(neighbourId([], 5)).toBeNull();
  });
});

describe('tag page texts (F-19, F-20, NF-10)', () => {
  it('asks exactly as F-19 AK1 says when a rename hits an existing tag', () => {
    expect(`${dt.mergeQuestion('Nachtisch', 'Dessert')} ${dt.affected(7)}`).toBe(
      '‚Nachtisch‘ in ‚Dessert‘ zusammenführen? 7 Rezepte betroffen',
    );
  });

  it('asks „Von 4 Rezepten entfernen?“ before deleting (F-19 AK3), singular and zero too', () => {
    expect(dt.deleteText(4).startsWith('Von 4 Rezepten entfernen?')).toBe(true);
    expect(dt.deleteText(1).startsWith('Von 1 Rezept entfernen?')).toBe(true);
    expect(dt.deleteText(4)).toBe('Von 4 Rezepten entfernen? Die Rezepte bleiben erhalten.');
    expect(dt.deleteText(0)).toBe('Kein Rezept verwendet diesen Tag.');
    expect(dt.deleteTitle('Tippfehler')).toBe('‚Tippfehler‘ löschen?');
  });

  it('counts affected recipes in singular, plural and zero', () => {
    expect(dt.affected(1)).toBe('1 Rezept betroffen');
    expect(dt.affected(2)).toBe('2 Rezepte betroffen');
    expect(dt.affected(0)).toBe('Kein Rezept betroffen');
  });

  it('shows the recipe count of a tag in the row menu', () => {
    expect(dt.recipes(0)).toBe('Kein Rezept');
    expect(dt.recipes(1)).toBe('1 Rezept');
    expect(dt.recipes(2)).toBe('2 Rezepte');
  });

  it('names the tag in toasts, menus and the search states', () => {
    expect(dt.menu('Vegan')).toBe('Aktionen für ‚Vegan‘');
    expect(dt.renamed('Nachtisch', 'Dessert')).toBe('‚Nachtisch‘ heißt jetzt ‚Dessert‘');
    expect(dt.merged('Nachtisch', 'Dessert')).toBe('‚Nachtisch‘ mit ‚Dessert‘ zusammengeführt');
    expect(dt.mergeTitle('Nachtisch')).toBe('‚Nachtisch‘ zusammenführen mit …');
    expect(dt.deleted('Vegan')).toBe('Tag ‚Vegan‘ gelöscht');
    expect(dt.created('Grillen')).toBe('Tag ‚Grillen‘ angelegt');
    expect(dt.exists('Dessert')).toBe('‚Dessert‘ gibt es schon');
    expect(dt.noMatch('zz')).toBe('Kein Tag gefunden für ‚zz‘');
    expect(dt.createNamed('Grillen')).toBe('Tag ‚Grillen‘ anlegen');
  });
});
