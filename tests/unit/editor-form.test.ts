// Editor form model (F-06, F-07, F-10, F-11, NF-09): form ↔ API input, validation, dirty tracking,
// conflict diff, tags and reordering. Pure functions from client/src/lib/editor.ts.
import { describe, expect, it } from 'vitest';
import {
  addTags,
  amountRangeText,
  amountText,
  applyField,
  buildRequest,
  cloneForm,
  createOutcome,
  diffFields,
  dragShift,
  dropIndex,
  type EditorForm,
  emptyGroup,
  emptyIngredient,
  emptyStep,
  errorKey,
  fieldPreview,
  formFromDetail,
  formKey,
  type IngredientItem,
  mapDetails,
  moveItem,
  newCreateKey,
  newForm,
  validationDetails,
} from '../../client/src/lib/editor.ts';
import { RecipeCreateInput } from '../../shared/schemas.ts';
import type { RecipeDetail } from '../../shared/types.ts';

function ing(amount: string, unit: string, name: string, note = ''): IngredientItem {
  return { ...emptyIngredient(), amount, unit, name, note };
}

function detail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    id: 7,
    title: 'Käsespätzle',
    description: 'Schwäbischer Klassiker',
    servings: 4,
    servingsUnit: 'Portionen',
    prepMinutes: 20,
    cookMinutes: 25,
    totalMinutes: 45,
    source: '',
    ingredients: [
      { id: 1, group: 'Für den Teig', amount: 400, amountMax: null, unit: 'g', name: 'Mehl', note: '' },
      { id: 2, group: 'Für den Teig', amount: 4, amountMax: null, unit: '', name: 'Eier', note: '' },
      { id: 3, group: 'Außerdem', amount: 2, amountMax: 3, unit: 'EL', name: 'Butter', note: 'kalt' },
      { id: 4, group: 'Außerdem', amount: null, amountMax: null, unit: '', name: 'Salz', note: '' },
    ],
    steps: [
      { id: 1, text: 'Teig schlagen.' },
      { id: 2, text: 'Spätzle schaben.\nMit Käse schichten.' },
    ],
    tags: [
      { id: 1, name: 'Vegetarisch' },
      { id: 2, name: 'Schwäbisch' },
    ],
    image: { id: 17, urls: { s: '/s', m: '/m', l: '/l' }, width: 1200, height: 800 },
    rating: { avg: null, count: 0, mine: null, byProfile: [] },
    isFavorite: null,
    createdBy: { id: 1, name: 'Sebastian' },
    updatedBy: { id: 2, name: 'Anna' },
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    version: 3,
    ...overrides,
  };
}

const CREATE = { kind: 'create', createKey: 'abcdef12-3456' } as const;

describe('amount text for editing (F-10)', () => {
  it('shows exact fractions as glyphs and never rounds other values', () => {
    expect(amountText(1.5)).toBe('1 ½');
    expect(amountText(0.5)).toBe('½');
    expect(amountText(1 / 3)).toBe('⅓');
    expect(amountText(1.25)).toBe('1 ¼');
    expect(amountText(0.1)).toBe('0,1');
    expect(amountText(2.4)).toBe('2,4');
    // The display rule would show "1 ¼" (±0,01); the editor keeps the exact value.
    expect(amountText(1.26)).toBe('1,26');
    expect(amountText(200)).toBe('200');
  });

  it('writes ranges with an en dash and empty text without an amount', () => {
    expect(amountRangeText(2, 3)).toBe('2–3');
    expect(amountRangeText(0.5, 1)).toBe('½–1');
    expect(amountRangeText(null, null)).toBe('');
  });
});

describe('buildRequest: form → RecipeInput (F-06, F-10, F-11)', () => {
  it('accepts a recipe with only a title', () => {
    const result = buildRequest(newForm('Nur Titel'), CREATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      title: 'Nur Titel',
      ingredients: [],
      steps: [],
      tags: [],
      servings: null,
      servingsUnit: 'Portionen',
      createKey: 'abcdef12-3456',
    });
  });

  it('parses amounts, units, notes and ranges as in the F-10 AK', () => {
    const form = newForm('Test');
    form.items = [
      ing('200', 'g', 'Mehl', 'gesiebt'),
      ing('1,5', 'l', 'Milch'),
      ing('1/2', 'TL', 'Salz'),
      ing('½', '', 'Zitrone'),
      ing('1/3', '', 'Gurke'),
      ing('2–3', 'EL', 'Öl'),
      ing('2-3', '', 'Eier'),
      ing('', '', 'Pfeffer'),
    ];
    const result = buildRequest(form, CREATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.ingredients).toEqual([
      { group: '', amount: 200, amountMax: null, unit: 'g', name: 'Mehl', note: 'gesiebt' },
      { group: '', amount: 1.5, amountMax: null, unit: 'l', name: 'Milch', note: '' },
      { group: '', amount: 0.5, amountMax: null, unit: 'TL', name: 'Salz', note: '' },
      { group: '', amount: 0.5, amountMax: null, unit: '', name: 'Zitrone', note: '' },
      { group: '', amount: 1 / 3, amountMax: null, unit: '', name: 'Gurke', note: '' },
      { group: '', amount: 2, amountMax: 3, unit: 'EL', name: 'Öl', note: '' },
      { group: '', amount: 2, amountMax: 3, unit: '', name: 'Eier', note: '' },
      { group: '', amount: null, amountMax: null, unit: '', name: 'Pfeffer', note: '' },
    ]);
  });

  it('turns group headings into the group of the following ingredients', () => {
    const form = newForm('Kuchen');
    form.items = [
      ing('1', '', 'Vorab'),
      emptyGroup('Für den Teig'),
      ing('250', 'g', 'Mehl'),
      emptyGroup('Für den Belag'),
      ing('500', 'g', 'Äpfel'),
      emptyGroup('Leer'),
    ];
    const result = buildRequest(form, CREATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.ingredients.map((i) => [i.group, i.name])).toEqual([
      ['', 'Vorab'],
      ['Für den Teig', 'Mehl'],
      ['Für den Belag', 'Äpfel'],
    ]);
  });

  it('drops empty ingredient rows and empty steps, keeps line breaks (F-11)', () => {
    const form = newForm('Test');
    form.items = [emptyIngredient(), ing('', '', 'Salz'), emptyIngredient()];
    form.steps = [emptyStep('  '), emptyStep('Erst dies.\nDann das.'), emptyStep(''), emptyStep('Fertig.')];
    const result = buildRequest(form, CREATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.ingredients).toHaveLength(1);
    expect(result.body.steps).toEqual([{ text: 'Erst dies.\nDann das.' }, { text: 'Fertig.' }]);
    expect(result.map.stepKeys).toEqual([form.steps[1]?.key, form.steps[3]?.key]);
  });

  it('parses servings and minutes of "Weitere Angaben"', () => {
    const form = newForm('Test');
    Object.assign(form, { servings: '2,5', servingsUnit: 'Stück', prepMinutes: '20', cookMinutes: ' 90 ' });
    const result = buildRequest(form, CREATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      servings: 2.5,
      servingsUnit: 'Stück',
      prepMinutes: 20,
      cookMinutes: 90,
    });
  });

  it('falls back to "Portionen" for an empty servings unit', () => {
    const form = newForm('Test');
    form.servingsUnit = '  ';
    const result = buildRequest(form, CREATE);
    expect(result.ok && result.body.servingsUnit).toBe('Portionen');
  });

  it('reports a missing title with the inline text of the component sheet', () => {
    const result = buildRequest(newForm(''), CREATE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.title).toBe('Bitte gib einen Titel ein.');
  });

  it('reports unreadable amounts, missing names and bad numbers per field', () => {
    const form = newForm('Test');
    const bad = ing('etwas', 'g', 'Mehl');
    const nameless = ing('2', 'EL', '');
    const reversed = ing('3–2', '', 'Eier');
    form.items = [bad, nameless, reversed];
    Object.assign(form, { servings: '2–3', prepMinutes: '1,5', cookMinutes: '0' });
    const result = buildRequest(form, CREATE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[errorKey.item(bad.key, 'amount')]).toMatch(/Menge nicht lesbar/);
    expect(result.errors[errorKey.item(nameless.key, 'name')]).toBe('Bitte gib die Zutat ein.');
    expect(result.errors[errorKey.item(reversed.key, 'amount')]).toMatch(/Menge nicht lesbar/);
    expect(result.errors.servings).toBe('Bitte gib eine Zahl wie 4 oder 1,5 ein.');
    expect(result.errors.prepMinutes).toBe('Bitte gib ganze Minuten ein.');
    expect(result.errors.cookMinutes).toBe('Koch- oder Backzeit muss mindestens 1 sein');
  });

  it('maps schema errors of rows and groups back to their fields', () => {
    const form = newForm();
    form.title = 'x'.repeat(121);
    const group = emptyGroup('G'.repeat(61));
    const longName = ing('1', '', 'N'.repeat(121));
    const longStep = emptyStep('S'.repeat(4001));
    form.items = [group, longName];
    form.steps = [emptyStep('ok'), longStep];
    const result = buildRequest(form, CREATE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.title).toBe('Titel darf höchstens 120 Zeichen lang sein');
    expect(result.errors[errorKey.item(group.key, 'group')]).toBe(
      'Gruppe darf höchstens 60 Zeichen lang sein',
    );
    expect(result.errors[errorKey.item(longName.key, 'name')]).toBe(
      'Name darf höchstens 120 Zeichen lang sein',
    );
    expect(result.errors[errorKey.step(longStep.key)]).toBe('Schritt darf höchstens 4000 Zeichen lang sein');
  });

  it('produces a body the server schema accepts unchanged', () => {
    const result = buildRequest(formFromDetail(detail()), CREATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(RecipeCreateInput.safeParse(result.body).success).toBe(true);
    expect(result.body.imageId).toBe(17);
  });

  it('sends the loaded version on update and no createKey', () => {
    const result = buildRequest(formFromDetail(detail()), { kind: 'update', version: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({ version: 3 });
    expect('createKey' in result.body).toBe(false);
  });
});

describe('server errors (400 VALIDATION details)', () => {
  it('map to the rows that were sent', () => {
    const form = newForm('Test');
    const first = ing('1', '', 'A');
    const second = ing('2', '', 'B');
    form.items = [emptyIngredient(), first, emptyGroup('G'), second];
    const built = buildRequest(form, CREATE);
    const errors = mapDetails(
      [
        { field: 'ingredients.1.name', message: 'Name kaputt' },
        { field: 'ingredients.1.amountMax', message: 'Obergrenze' },
        { field: 'ingredients.1.group', message: 'Gruppe kaputt' },
        { field: 'title', message: 'Titel kaputt' },
        { field: 'imageId', message: 'Bild nicht gefunden' },
        { field: 'steps', message: 'Zu viele' },
      ],
      built.map,
    );
    expect(errors).toEqual({
      [errorKey.item(second.key, 'name')]: 'Name kaputt',
      [errorKey.item(second.key, 'amount')]: 'Obergrenze',
      [errorKey.item(form.items[2]?.key ?? '', 'group')]: 'Gruppe kaputt',
      title: 'Titel kaputt',
      form: 'Bild nicht gefunden',
      steps: 'Zu viele',
    });
  });

  it('reads only well-formed details', () => {
    expect(validationDetails([{ field: 'title', message: 'x' }, { field: 1 }, null, 'x'])).toEqual([
      { field: 'title', message: 'x' },
    ]);
    expect(validationDetails({ current: {} })).toEqual([]);
  });
});

describe('formFromDetail (edit mode)', () => {
  it('rebuilds group headings, amounts and texts', () => {
    const form = formFromDetail(detail());
    expect(form.title).toBe('Käsespätzle');
    expect(form.tags).toEqual(['Vegetarisch', 'Schwäbisch']);
    expect(
      form.items.map((i) =>
        i.kind === 'group' ? `# ${i.name}` : `${i.amount}|${i.unit}|${i.name}|${i.note}`,
      ),
    ).toEqual(['# Für den Teig', '400|g|Mehl|', '4||Eier|', '# Außerdem', '2–3|EL|Butter|kalt', '||Salz|']);
    expect(form.steps.map((s) => s.text)).toEqual([
      'Teig schlagen.',
      'Spätzle schaben.\nMit Käse schichten.',
    ]);
    expect(form).toMatchObject({ servings: '4', prepMinutes: '20', cookMinutes: '25', imageId: 17 });
  });

  it('round-trips through buildRequest without changes', () => {
    const d = detail({
      servings: 1.5,
      ingredients: [
        { id: 1, group: '', amount: 1.26, amountMax: null, unit: 'kg', name: 'Mehl', note: '' },
        { id: 2, group: '', amount: 1 / 3, amountMax: 0.5, unit: '', name: 'Zitrone', note: '' },
      ],
    });
    const result = buildRequest(formFromDetail(d), { kind: 'update', version: d.version });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.servings).toBe(1.5);
    expect(result.body.ingredients.map((i) => [i.amount, i.amountMax])).toEqual([
      [1.26, null],
      [1 / 3, 0.5],
    ]);
  });

  it('offers one empty row and step for a recipe without any', () => {
    const form = formFromDetail(detail({ ingredients: [], steps: [], servings: null, image: null }));
    expect(form.items).toHaveLength(1);
    expect(form.steps).toHaveLength(1);
    expect(form).toMatchObject({ servings: '', imageId: null });
  });
});

describe('dirty tracking and conflict diff (F-07, F-09)', () => {
  it('ignores empty rows, whitespace and equivalent amount spellings', () => {
    const base = formFromDetail(detail());
    const same = cloneForm(base);
    same.items.push(emptyIngredient());
    same.steps.push(emptyStep(' '));
    same.title = ' Käsespätzle ';
    const butter = same.items[4];
    if (butter?.kind === 'ingredient') butter.amount = '2 - 3';
    expect(formKey(same)).toBe(formKey(base));
    expect(diffFields(base, same)).toEqual([]);
  });

  it('names exactly the changed fields', () => {
    const base = formFromDetail(detail());
    const mine = cloneForm(base);
    mine.title = 'Kässpätzle';
    mine.tags.push('Schnell');
    const lastStep = mine.steps[1];
    if (lastStep) lastStep.text = 'Anders.';
    mine.cookMinutes = '30';
    expect(diffFields(base, mine)).toEqual(['title', 'tags', 'steps', 'cookMinutes']);
  });

  it('compares tags as a set by normalize(), the way the server keeps them (F-17)', () => {
    const base = formFromDetail(detail());
    const same = cloneForm(base);
    // The server answers in its own order and with the display name of an existing tag.
    same.tags = ['schwäbisch', ' VEGETARISCH', 'Vegetarisch'];
    expect(formKey(same)).toBe(formKey(base));
    expect(diffFields(base, same)).toEqual([]);
    same.tags.push('Schnell');
    expect(diffFields(base, same)).toEqual(['tags']);
  });

  it('recognizes an update whose answer got lost although tags were added (retry, no conflict)', () => {
    // First PUT went through, its answer timed out; the retry gets 409 with the saved recipe as current.
    const mine = formFromDetail(detail());
    mine.tags = ['Vegetarisch', 'Schwäbisch', 'schnell', 'Käse'];
    mine.prepMinutes = '020';
    const saved = detail({
      version: 4,
      updatedBy: { id: 1, name: 'Sebastian' },
      prepMinutes: 20,
      tags: [
        { id: 9, name: 'Käse' },
        { id: 3, name: 'Schnell' },
        { id: 2, name: 'Schwäbisch' },
        { id: 1, name: 'Vegetarisch' },
      ],
    });
    expect(formKey(formFromDetail(saved))).toBe(formKey(mine));
  });

  it('treats a renamed group as an ingredient change', () => {
    const base = formFromDetail(detail());
    const mine = cloneForm(base);
    const group = mine.items[0];
    if (group?.kind === 'group') group.name = 'Teig';
    expect(diffFields(base, mine)).toEqual(['ingredients']);
  });

  it('takes over one field from my version (Meine Änderung übernehmen)', () => {
    const server = formFromDetail(detail({ title: 'Käsespätzle (Anna)' }));
    const mine = formFromDetail(detail());
    mine.title = 'Meine Spätzle';
    mine.items = [ing('1', 'kg', 'Mehl')];
    const target = cloneForm(server);
    applyField(target, 'title', mine);
    expect(target.title).toBe('Meine Spätzle');
    applyField(target, 'ingredients', mine);
    expect(target.items.map((i) => i.kind === 'ingredient' && i.name)).toEqual(['Mehl']);
    // Fresh keys: the taken-over rows never share keys with rows still on screen.
    expect(target.items[0]?.key).not.toBe(mine.items[0]?.key);
    expect(target.description).toBe(server.description);
  });

  it('describes field values for the conflict marks', () => {
    const form = formFromDetail(detail());
    expect(fieldPreview(form, 'ingredients')).toBe('4 Zutaten');
    expect(fieldPreview(form, 'steps')).toBe('2 Schritte');
    expect(fieldPreview(form, 'tags')).toBe('Vegetarisch, Schwäbisch');
    expect(fieldPreview(form, 'cookMinutes')).toBe('25 min');
    expect(fieldPreview(form, 'source')).toBe('(leer)');
  });
});

describe('tags in the chip input (F-17)', () => {
  it('adds comma-separated names and collapses duplicates by normalize()', () => {
    const result = addTags(['Süßspeise'], 'Vegetarisch,  schnell ,Süssspeise, SÜSSSPEISE,,vegetarisch');
    expect(result).toEqual({ tags: ['Süßspeise', 'Vegetarisch', 'schnell'], rejected: [], error: null });
  });

  it('stops at 20 tags and rejects names over 40 characters', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `Tag ${i + 1}`);
    expect(addTags(twenty, 'Noch einer')).toEqual({
      tags: twenty,
      rejected: ['Noch einer'],
      error: 'Höchstens 20 Tags pro Rezept',
    });
    const long = 'x'.repeat(41);
    expect(addTags([], `${long}, Kurz`)).toEqual({
      tags: ['Kurz'],
      rejected: [long],
      error: 'Ein Tag darf höchstens 40 Zeichen lang sein.',
    });
  });
});

describe('reordering (NF-07, F-11)', () => {
  it('moves step 3 to position 1 with two "Nach oben" steps', () => {
    const steps = ['a', 'b', 'c'];
    expect(moveItem(steps, 2, 1)).toBe(true);
    expect(moveItem(steps, 1, 0)).toBe(true);
    expect(steps).toEqual(['c', 'a', 'b']);
    expect(moveItem(steps, 0, -1)).toBe(false);
    expect(moveItem(steps, 2, 3)).toBe(false);
  });

  it('computes the drop position from row centers while dragging', () => {
    const rects = [0, 60, 120, 180].map((top) => ({ top, height: 52 }));
    expect(dropIndex(rects, 0, 26)).toBe(0);
    expect(dropIndex(rects, 0, 90)).toBe(1);
    expect(dropIndex(rects, 0, 210)).toBe(3);
    expect(dropIndex(rects, 3, 100)).toBe(2);
    expect(dropIndex(rects, 3, -10)).toBe(0);
    expect([0, 1, 2, 3].map((i) => dragShift(i, 0, 2, 60))).toEqual([0, -60, -60, 0]);
    expect([0, 1, 2, 3].map((i) => dragShift(i, 3, 1, 60))).toEqual([0, 60, 60, 0]);
  });
});

describe('createKey (NF-09)', () => {
  const PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

  it('uses randomUUID where available', () => {
    expect(newCreateKey({ randomUUID: () => '5f0c7e1a-1111-4222-8333-944455556666' })).toBe(
      '5f0c7e1a-1111-4222-8333-944455556666',
    );
  });

  it('falls back to getRandomValues on plain HTTP (no secure context)', () => {
    const key = newCreateKey({
      getRandomValues: (a: Uint8Array) => {
        a.fill(171);
        return a;
      },
    });
    expect(key).toBe('ab'.repeat(16));
    expect(newCreateKey(undefined)).toMatch(PATTERN);
  });

  it('produces keys the schema accepts, and a retry reuses the session key', () => {
    const key = newCreateKey();
    expect(key).toMatch(PATTERN);
    expect(key).not.toBe(newCreateKey());
    const form = newForm('Doppelt');
    const first = buildRequest(form, { kind: 'create', createKey: key });
    const retry = buildRequest(form, { kind: 'create', createKey: key });
    expect(first.ok && retry.ok).toBe(true);
    if (!first.ok || !retry.ok) return;
    expect((first.body as { createKey: string }).createKey).toBe(key);
    expect((retry.body as { createKey: string }).createKey).toBe(key);
  });
});

describe('createOutcome: POST answered with an existing recipe (NF-09, F-09 AK)', () => {
  /** The recipe the server stores for `form`, as POST or a createKey replay returns it. */
  function stored(form: EditorForm, overrides: Partial<RecipeDetail> = {}): RecipeDetail {
    const built = buildRequest(form, CREATE);
    if (!built.ok) throw new Error('form must be valid');
    let n = 0;
    return detail({
      title: built.body.title,
      description: built.body.description,
      servings: built.body.servings,
      servingsUnit: built.body.servingsUnit,
      prepMinutes: built.body.prepMinutes,
      cookMinutes: built.body.cookMinutes,
      source: built.body.source,
      ingredients: built.body.ingredients.map((i) => ({ id: ++n, ...i })),
      steps: built.body.steps.map((s) => ({ id: ++n, text: s.text })),
      // Server order and display names of existing tags differ from the input.
      tags: [...built.body.tags].reverse().map((name) => ({ id: ++n, name: name.toUpperCase() })),
      image: null,
      version: 1,
      ...overrides,
    });
  }

  function firstAttempt(): EditorForm {
    const form = newForm('Linsensuppe');
    form.tags = ['Suppe', 'vegan'];
    form.items = [ing('1.000', 'ml', 'Brühe'), ing('200', 'g', 'Linsen', 'rot')];
    form.steps = [emptyStep('Alles kochen.')];
    form.prepMinutes = '10';
    return form;
  }

  it('is done when the recipe holds what was sent', () => {
    const sent = firstAttempt();
    expect(createOutcome(sent, stored(sent))).toBe('saved');
  });

  it('updates when the createKey returned the first attempt and the user edited on after the timeout', () => {
    const first = firstAttempt();
    const later = cloneForm(first);
    later.steps.push(emptyStep('Mit Zitrone abschmecken.'));
    later.tags.push('Schnell');
    // Retry with the same createKey: the server answers 200 with the recipe of the first attempt.
    expect(createOutcome(later, stored(first))).toBe('update');
  });

  it('asks via the conflict dialog when that recipe was changed since it was created', () => {
    const first = firstAttempt();
    const later = cloneForm(first);
    later.title = 'Rote Linsensuppe';
    expect(createOutcome(later, stored(first, { version: 2, updatedBy: { id: 2, name: 'Anna' } }))).toBe(
      'conflict',
    );
  });

  it('covers a restored draft that carried the createKey of an already created recipe', () => {
    const first = firstAttempt();
    const draft = cloneForm(first, true);
    draft.description = 'Nach dem Wiederherstellen ergänzt';
    expect(createOutcome(draft, stored(first))).toBe('update');
    expect(createOutcome(cloneForm(first, true), stored(first))).toBe('saved');
  });
});

describe('form snapshots', () => {
  it('clone deeply and optionally with new keys', () => {
    const form: EditorForm = formFromDetail(detail());
    const copy = cloneForm(form);
    copy.tags.push('X');
    copy.items.pop();
    expect(form.tags).toHaveLength(2);
    expect(form.items).toHaveLength(6);
    const rekeyed = cloneForm(form, true);
    expect(rekeyed.items.map((i) => i.key)).not.toEqual(form.items.map((i) => i.key));
    expect(formKey(rekeyed)).toBe(formKey(form));
  });
});
