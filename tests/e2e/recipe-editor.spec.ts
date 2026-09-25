// Checklist area "Rezept-Editor" (section B): b1, b2, b3, b4, b5, b6, b7, b8, b9, b10.
// What a user does in the editor and then sees in the detail and the list, on phone, tablet and PC.
// Server rules and pure logic already have tests that this spec does not repeat:
//   tests/api/recipes.test.ts (title rules, groups and order, line breaks in steps, recipe without steps),
//   tests/unit/format.test.ts (format rule "1,5" → "1 ½", "0,33"/"1/3" → "⅓"),
//   tests/unit/editor-form.test.ts (buildRequest, groups, empty rows, reordering),
//   tests/unit/screens-helpers.test.ts (sourceHref, footerText).
// Device-only parts stay manual: the real on-screen keyboard (b10, b5 Enter key of the keyboard, b3 which
// keys the iPad keyboard offers in "Menge"), real iOS Safari zoom behaviour. External sites are stubbed.
// The b4 tests "Titel noch leer" guard a fixed bug: the first tap or click on a button below the empty,
// focused title was lost in the one-column editor (below 1024 px), because the title hint appeared on blur
// and shifted the layout between pressing and releasing (phone Chromium, tablet portrait, PC 800 px wide).
import type { Locator, Page } from '@playwright/test';
import type { Profile, RecipeDetail, RecipeResponse } from '../../shared/types.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';

// ---------------------------------------------------------------- helpers

let seq = 0;

/**
 * Unique per worker server: project, worker, repeat, retry and a counter. The worker's server is shared
 * with other specs, so the "e…r…n…" form must not match their names (layout-theme.spec.ts:
 * "<worker>-<n>", tag-input.spec.ts: "t…r…n…", desktop.spec.ts: "w…r…n…").
 */
function unique(label: string): string {
  seq += 1;
  const info = test.info();
  return `${label} ${info.project.name} e${info.workerIndex}r${info.repeatEachIndex}${info.retry}n${seq}`;
}

/** From 1024 px: navigation rail, list and detail side by side, "Weitere Angaben" always open. */
function isWide(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

async function signIn(page: Page, server: AppServer): Promise<Profile> {
  const profile = await server.api.createProfile(unique('Koch'));
  await useProfile(page, profile.id);
  return profile;
}

/** Opens the list and taps „+“ (FAB below 1024 px, "Neu" in the rail from 1024 px). */
async function openNewEditor(page: Page, server: AppServer): Promise<Profile> {
  const profile = await signIn(page, server);
  await page.goto(`${server.url}/rezepte`);
  await page.getByRole('link', { name: 'Neues Rezept' }).click();
  await expect(page).toHaveURL(/\/rezepte\/neu$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Neues Rezept' })).toBeVisible();
  // The editor focuses the title one frame after it renders: start every test from that state.
  await expect(titleField(page)).toBeFocused();
  return profile;
}

function titleField(page: Page): Locator {
  return page.getByLabel('Titel', { exact: true });
}

function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Speichern', exact: true });
}

/** F-06 AK: with an empty title Speichern is disabled and the field shows its hint (icon and text). */
async function expectTitleHint(page: Page): Promise<void> {
  await expect(page.getByText('Bitte gib einen Titel ein.')).toBeVisible();
  await expect(titleField(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(saveButton(page)).toBeDisabled();
}

function ingredientRow(page: Page, n: number): Locator {
  return page.getByRole('group', { name: `Zutat ${n}`, exact: true });
}

function part(row: Locator, label: 'Menge' | 'Einheit' | 'Zutat' | 'Notiz'): Locator {
  return row.getByLabel(label, { exact: true });
}

function stepField(page: Page, n: number): Locator {
  return page.getByRole('textbox', { name: `Schritt ${n}`, exact: true });
}

function detailTitle(page: Page, title: string): Locator {
  return page.getByRole('heading', { level: 1, name: title, exact: true });
}

/** The detail: its own column from 1024 px (next to the list), else the whole main area. */
function detailArea(page: Page): Locator {
  return isWide(page) ? page.getByRole('region', { name: 'Rezept', exact: true }) : page.getByRole('main');
}

/** Saves and waits for the detail of the saved recipe; returns its id. */
async function saveAndOpenDetail(page: Page, title: string): Promise<number> {
  await saveButton(page).click();
  await expect(page).toHaveURL(/\/rezepte\/\d+$/);
  await expect(detailTitle(page, title)).toBeVisible();
  const id = Number(new URL(page.url()).pathname.split('/').at(-1));
  expect(id).toBeGreaterThan(0);
  return id;
}

async function fetchRecipe(server: AppServer, id: number): Promise<RecipeDetail> {
  const res = await server.api.request('GET', `/api/v1/recipes/${id}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as RecipeResponse).recipe;
}

/** Opens the row menu of an ingredient row or a step and returns the sheet. */
async function openRowMenu(page: Page, trigger: Locator): Promise<Locator> {
  await trigger.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Schließen' }).click();
  await expect(sheet).toBeHidden();
}

/** Goes from the detail back to the list: the back button (below 1024 px) or the list column. */
async function listAfterDetail(page: Page): Promise<Locator> {
  if (isWide(page)) return page.getByRole('region', { name: 'Rezepte', exact: true });
  await page.getByRole('button', { name: 'Zurück zu Rezepte' }).click();
  await expect(page).toHaveURL(/\/rezepte$/);
  return page.getByRole('main');
}

// ---------------------------------------------------------------- b1: „+“, focus in the title, title required

async function expectTitleFirstAndRequired(page: Page): Promise<void> {
  const title = titleField(page);
  const save = saveButton(page);
  const hint = page.getByText('Bitte gib einen Titel ein.');
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/recipes')
      posts.push(request.url());
  });
  await expect(title).toBeFocused();
  // Focus is visible as the dark 2 px border (component sheet "Eingabefelder").
  await expect(title).toHaveCSS('border-top-width', '2px');
  // The field says it is required (F-06 AK "am Feld steht ein Hinweis").
  await expect(title).toHaveAttribute('aria-required', 'true');
  await expect(page.getByText('Pflichtfeld', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();

  // Leaving the empty field shows the hint at the field, not by color alone (icon plus text).
  await page.getByLabel('Tags', { exact: true }).focus();
  await expect(hint).toBeVisible();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(save).toBeDisabled();

  // Blanks are no title; Ctrl+Enter (NF-11) does not save either.
  await title.fill('   ');
  await expect(save).toBeDisabled();
  await title.press('Control+Enter');
  await expect(page).toHaveURL(/\/rezepte\/neu$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Neues Rezept' })).toBeVisible();
  expect(posts).toEqual([]);

  await title.fill('Pfannkuchen');
  await expect(save).toBeEnabled();
  await expect(hint).toHaveCount(0);
}

test('b1: „+“ öffnet den Editor, der Titel hat den Fokus, ohne Titel kein Speichern @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  await openNewEditor(page, server);
  await expectTitleFirstAndRequired(page);
});

test('b1: „+“ im Tablet-Hochformat öffnet den Editor mit Fokus im Titel @tablet', async ({
  page,
  server,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openNewEditor(page, server);
  await expectTitleFirstAndRequired(page);
});

// ---------------------------------------------------------------- b2: title only → detail and list

test('b2: nur ein Titel, Speichern öffnet das Detail, das Rezept steht in der Liste @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const profile = await openNewEditor(page, server);
  const title = unique('Nur Titel');
  await titleField(page).fill(title);
  const id = await saveAndOpenDetail(page, title);

  // The detail names the active profile as the author (F-06 AK).
  await expect(detailArea(page).getByText(/^Angelegt von /)).toHaveText(`Angelegt von ${profile.name} heute`);
  const saved = await fetchRecipe(server, id);
  expect(saved).toMatchObject({ title, ingredients: [], steps: [], createdBy: { id: profile.id } });

  const list = await listAfterDetail(page);
  const entry = list.getByRole('link', { name: title, exact: true });
  await expect(entry).toBeVisible();
  if (isWide(page)) await expect(entry).toHaveAttribute('aria-current', 'page');
});

// ---------------------------------------------------------------- b3: amounts „1,5“, „0,33“, „1/3“

test('b3: Mengen „1,5“ und „0,33“ erscheinen im Detail als „1 ½“ und „⅓“ @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  await openNewEditor(page, server);
  const title = unique('Pfannkuchenteig');
  await titleField(page).fill(title);

  const first = ingredientRow(page, 1);
  // The amount field asks for the number pad (catalog 6.3); what that pad offers is device-specific.
  await expect(part(first, 'Menge')).toHaveAttribute('inputmode', 'decimal');
  await part(first, 'Menge').pressSequentially('1,5');
  await part(first, 'Einheit').fill('l');
  await part(first, 'Zutat').fill('Milch');
  await part(first, 'Zutat').press('Enter');

  const second = ingredientRow(page, 2);
  await expect(part(second, 'Menge')).toBeFocused();
  await part(second, 'Menge').pressSequentially('0,33');
  await part(second, 'Einheit').fill('TL');
  await part(second, 'Zutat').fill('Salz');

  const id = await saveAndOpenDetail(page, title);
  const ingredients = detailArea(page).getByRole('region', { name: 'Zutaten' });
  await expect(ingredients.getByRole('listitem')).toHaveText(['1 ½ l Milch', '⅓ TL Salz']);

  const saved = await fetchRecipe(server, id);
  expect(saved.ingredients.map((i) => i.amount)).toEqual([1.5, 0.33]);
});

test('b3: „1/3“ mit voller Tastatur (PC, iPad) erscheint im Detail als „⅓“ @tablet @desktop', async ({
  page,
  server,
}) => {
  await openNewEditor(page, server);
  const title = unique('Streuselkuchen');
  await titleField(page).fill(title);

  const first = ingredientRow(page, 1);
  await part(first, 'Menge').pressSequentially('1/3');
  await expect(part(first, 'Menge')).toHaveValue('1/3');
  await part(first, 'Einheit').fill('Tasse');
  await part(first, 'Zutat').fill('Zucker');

  const id = await saveAndOpenDetail(page, title);
  const ingredients = detailArea(page).getByRole('region', { name: 'Zutaten' });
  await expect(ingredients.getByRole('listitem')).toHaveText(['⅓ Tasse Zucker']);

  const saved = await fetchRecipe(server, id);
  expect(saved.ingredients[0]?.amount).toBeCloseTo(1 / 3, 6);
});

// ---------------------------------------------------------------- b4: group heading and row menu order

test('b4: Gruppe „Für die Soße“ und Reihenfolge per „Nach oben“/„Nach unten“ bleiben nach Speichern und Neuladen @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  await openNewEditor(page, server);
  const title = unique('Nudeln mit Soße');
  await titleField(page).fill(title);

  const first = ingredientRow(page, 1);
  await part(first, 'Menge').fill('500');
  await part(first, 'Einheit').fill('g');
  await part(first, 'Zutat').fill('Nudeln');

  // „Gruppe“ below the ingredients adds a heading plus an empty row and focuses the heading.
  await page.getByRole('button', { name: 'Gruppe hinzufügen' }).click();
  const group = page.getByLabel('Gruppenname', { exact: true });
  await expect(group).toBeFocused();
  await expect(group).toHaveAttribute('placeholder', 'Gruppe, z. B. Für den Teig');
  await group.pressSequentially('Für die Soße');

  await part(ingredientRow(page, 2), 'Zutat').fill('Tomaten');
  await part(ingredientRow(page, 2), 'Zutat').press('Enter');
  await part(ingredientRow(page, 3), 'Zutat').fill('Basilikum');
  await part(ingredientRow(page, 3), 'Zutat').press('Enter');
  await part(ingredientRow(page, 4), 'Zutat').fill('Knoblauch');

  // Rows: Nudeln · [Für die Soße] · Tomaten · Basilikum · Knoblauch. Knoblauch one up …
  const menu = 'Zeilenmenü: verschieben, entfernen';
  let sheet = await openRowMenu(page, ingredientRow(page, 4).getByRole('button', { name: menu }));
  await expect(sheet).toContainText('Knoblauch');
  await expect(sheet).toContainText('Position 5 von 5');
  await expect(sheet.getByRole('button', { name: 'Nach unten' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Nach oben' }).click();
  await expect(sheet).toContainText('Position 4 von 5');
  await closeSheet(sheet);

  // … and Tomaten one down.
  sheet = await openRowMenu(page, ingredientRow(page, 2).getByRole('button', { name: menu }));
  await expect(sheet).toContainText('Tomaten');
  await sheet.getByRole('button', { name: 'Nach unten' }).click();
  await expect(sheet).toContainText('Position 4 von 5');
  await closeSheet(sheet);

  const names = [1, 2, 3, 4].map((n) => part(ingredientRow(page, n), 'Zutat'));
  await expect(names[0] as Locator).toHaveValue('Nudeln');
  await expect(names[1] as Locator).toHaveValue('Knoblauch');
  await expect(names[2] as Locator).toHaveValue('Tomaten');
  await expect(names[3] as Locator).toHaveValue('Basilikum');

  const id = await saveAndOpenDetail(page, title);
  const expected = ['500 g Nudeln', 'Für die Soße', 'Knoblauch', 'Tomaten', 'Basilikum'];
  const ingredients = detailArea(page).getByRole('region', { name: 'Zutaten' });
  await expect(ingredients.getByRole('heading', { level: 3, name: 'Für die Soße' })).toBeVisible();
  // Headings and rows in document order: the group heading stands between Nudeln and its ingredients.
  await expect(ingredients.locator('h3, li')).toHaveText(expected);

  await page.reload();
  await expect(detailTitle(page, title)).toBeVisible();
  await expect(detailArea(page).getByRole('region', { name: 'Zutaten' }).locator('h3, li')).toHaveText(
    expected,
  );

  const saved = await fetchRecipe(server, id);
  expect(saved.ingredients.map((i) => [i.group, i.name])).toEqual([
    ['', 'Nudeln'],
    ['Für die Soße', 'Knoblauch'],
    ['Für die Soße', 'Tomaten'],
    ['Für die Soße', 'Basilikum'],
  ]);
});

// The buttons below the title a first tap can hit, and the field each one focuses.
const FIRST_TAPS = [
  {
    name: '„Gruppe“',
    button: 'Gruppe hinzufügen',
    result: 'legt die Gruppe beim ersten Tippen an',
    focused: (page: Page) => page.getByLabel('Gruppenname', { exact: true }),
  },
  {
    name: '„Zutat“',
    button: 'Zutat hinzufügen',
    result: 'legt beim ersten Tippen eine Zeile an',
    focused: (page: Page) => part(ingredientRow(page, 2), 'Menge'),
  },
  {
    name: '„Schritt“',
    button: 'Schritt hinzufügen',
    result: 'legt beim ersten Tippen einen Schritt an',
    focused: (page: Page) => stepField(page, 2),
  },
];

for (const tap of FIRST_TAPS) {
  test(`b4: ${tap.name} direkt nach dem Öffnen antippen (Titel noch leer) ${tap.result} @phone`, async ({
    page,
    server,
  }) => {
    // The tap moves the focus out of the empty title. Its hint "Bitte gib einen Titel ein." pushes
    // everything below the title down by one line; it waits until the tap's click is through
    // (onTitleBlur), otherwise Chromium delivers the click next to the button and the first tap is lost.
    await openNewEditor(page, server);
    await page.getByRole('button', { name: tap.button }).tap();
    await expect(tap.focused(page)).toBeFocused();
    // F-06 AK: the empty title still shows its hint and Speichern stays disabled.
    await expectTitleHint(page);
  });
}

test('b4: Tablet-Hochformat: „Zutat“ direkt nach dem Öffnen antippen (Titel noch leer) legt beim ersten Tippen eine Zeile an @tablet', async ({
  page,
  server,
}) => {
  // Same as above in the one-column editor of the tablet.
  await page.setViewportSize({ width: 768, height: 1024 });
  await openNewEditor(page, server);
  await page.getByRole('button', { name: 'Zutat hinzufügen' }).tap();
  await expect(part(ingredientRow(page, 2), 'Menge')).toBeFocused();
  await expectTitleHint(page);
});

test('b4: PC-Fenster 800 px breit: „Zutat“ direkt nach dem Öffnen anklicken (Titel noch leer) legt beim ersten Klick eine Zeile an @desktop', async ({
  page,
  server,
}) => {
  // Not touch-specific: the mouse button goes down on „Zutat“ and the title loses the focus; a hint shown
  // then would push the button down before the button comes up, so no click would reach it. The hint
  // waits for the release. From 1024 px the button sits in the right column and does not move.
  await page.setViewportSize({ width: 800, height: 900 });
  await openNewEditor(page, server);
  const add = page.getByRole('button', { name: 'Zutat hinzufügen' });
  await add.scrollIntoViewIfNeeded();
  const box = await add.boundingBox();
  if (!box) throw new Error('„Zutat hinzufügen“ ist nicht sichtbar');
  // A press that takes a while, like a person's: the hint must not appear while the button is down.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(titleField(page)).not.toBeFocused();
  await page.waitForTimeout(150);
  await expect(page.getByText('Bitte gib einen Titel ein.')).toHaveCount(0);
  await page.mouse.up();
  await expect(part(ingredientRow(page, 2), 'Menge')).toBeFocused();
  await expectTitleHint(page);
});

test('b4: ein Klick oder Tipp auf das deaktivierte „Speichern“ zeigt den Hinweis am leeren Titel @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  // The hint waits for the end of a press (onTitleBlur); a press on a disabled button must end it too.
  await openNewEditor(page, server);
  const save = saveButton(page);
  await expect(save).toBeDisabled();
  if (test.info().project.use.hasTouch) await save.tap({ force: true });
  else await save.click({ force: true });
  await expectTitleHint(page);
});

// ---------------------------------------------------------------- b5: Enter in the last ingredient

test('b5: Enter im Namen der letzten Zutat legt eine neue Zeile an und fokussiert deren Menge @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  await openNewEditor(page, server);
  const rows = page.getByRole('group', { name: /^Zutat \d+$/ });
  await expect(rows).toHaveCount(1);

  const name = part(ingredientRow(page, 1), 'Zutat');
  // The on-screen keyboard shows an Enter key (not "next") in the last row.
  await expect(name).toHaveAttribute('enterkeyhint', 'enter');
  await name.fill('Mehl');
  await name.press('Enter');

  await expect(rows).toHaveCount(2);
  await expect(part(ingredientRow(page, 2), 'Menge')).toBeFocused();
  await expect(name).toHaveValue('Mehl');
  await expect(name).toHaveAttribute('enterkeyhint', 'next');

  // In a row that is no longer the last one, Enter only moves on to the next field.
  await name.press('Enter');
  await expect(part(ingredientRow(page, 1), 'Notiz')).toBeFocused();
  await expect(rows).toHaveCount(2);
});

// ---------------------------------------------------------------- b6: line breaks and step order

test('b6: ein Schritt behält seinen Zeilenumbruch, Schritte lassen sich umsortieren @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  await openNewEditor(page, server);
  const title = unique('Kartoffelsalat');
  await titleField(page).fill(title);

  // Enter in a step inserts a line break (it does not jump to the next field).
  await stepField(page, 1).click();
  await page.keyboard.type('Zeile eins');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Zeile zwei');
  await expect(stepField(page, 1)).toHaveValue('Zeile eins\nZeile zwei');

  await page.getByRole('button', { name: 'Schritt hinzufügen' }).click();
  await expect(stepField(page, 2)).toBeFocused();
  await page.keyboard.type('Zweiter Schritt');
  await page.getByRole('button', { name: 'Schritt hinzufügen' }).click();
  await expect(stepField(page, 3)).toBeFocused();
  await page.keyboard.type('Dritter Schritt');

  // Step 3 to position 1 with "Nach oben" twice; the sheet stays open while moving.
  const stepRow = page.getByRole('listitem').filter({ has: stepField(page, 3) });
  const sheet = await openRowMenu(
    page,
    stepRow.getByRole('button', { name: 'Schrittmenü: verschieben, entfernen' }),
  );
  await expect(sheet).toContainText('Position 3 von 3');
  await sheet.getByRole('button', { name: 'Nach oben' }).click();
  await expect(sheet).toContainText('Position 2 von 3');
  await sheet.getByRole('button', { name: 'Nach oben' }).click();
  await expect(sheet).toContainText('Position 1 von 3');
  await expect(sheet.getByRole('button', { name: 'Nach oben' })).toBeDisabled();
  await closeSheet(sheet);

  await expect(stepField(page, 1)).toHaveValue('Dritter Schritt');
  await expect(stepField(page, 2)).toHaveValue('Zeile eins\nZeile zwei');
  await expect(stepField(page, 3)).toHaveValue('Zweiter Schritt');

  const id = await saveAndOpenDetail(page, title);

  const expectSteps = async (): Promise<void> => {
    const steps = detailArea(page).getByRole('region', { name: 'Zubereitung' });
    await expect(steps.getByRole('heading', { level: 3 })).toHaveText([
      'Schritt 1',
      'Schritt 2',
      'Schritt 3',
    ]);
    const texts = steps.getByRole('listitem').locator('p');
    await expect(texts).toHaveText(['Dritter Schritt', 'Zeile eins Zeile zwei', 'Zweiter Schritt']);
    // The rendered text keeps the break (innerText follows the CSS white-space), so it takes two lines.
    expect(await texts.nth(1).evaluate((el) => (el as HTMLElement).innerText)).toBe('Zeile eins\nZeile zwei');
    const oneLine = await texts.nth(0).boundingBox();
    const twoLines = await texts.nth(1).boundingBox();
    expect(twoLines?.height ?? 0).toBeGreaterThan((oneLine?.height ?? 0) * 1.5);
  };
  await expectSteps();
  await page.reload();
  await expect(detailTitle(page, title)).toBeVisible();
  await expectSteps();

  const saved = await fetchRecipe(server, id);
  expect(saved.steps.map((s) => s.text)).toEqual([
    'Dritter Schritt',
    'Zeile eins\nZeile zwei',
    'Zweiter Schritt',
  ]);
});

// ---------------------------------------------------------------- b7: "Weitere Angaben", source link or text

test('b7: „Weitere Angaben“ mit Portionen, Zeiten und Quelle; https-Quelle ist ein Link, „Omas Kochbuch“ reiner Text @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  await openNewEditor(page, server);
  const title = unique('Gulasch');
  await titleField(page).fill(title);

  const more = page.getByRole('region', { name: 'Weitere Angaben' });
  const toggle = page.getByRole('button', { name: /^Weitere Angaben/ });
  if (isWide(page)) {
    // Two-column editor from 1024 px: always open under its heading.
    await expect(toggle).toHaveCount(0);
  } else {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('Portionen, Zeiten, Quelle, Beschreibung');
    await expect(more.getByLabel('Portionen', { exact: true })).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  await more.getByLabel('Portionen', { exact: true }).fill('4');
  await more.getByLabel('Vorbereitung (min)').fill('15');
  await more.getByLabel('Koch-/Backzeit (min)').fill('90');
  await more.getByLabel('Quelle').fill('https://example.org/rezept');

  const id = await saveAndOpenDetail(page, title);
  const detail = detailArea(page);
  await expect(detail.getByLabel('Zeiten und Portionen').locator('div')).toHaveText([
    /^Vorbereitung\s*15 min$/,
    /^Kochen\s*90 min$/,
    /^Portionen\s*4$/,
  ]);
  const source = detail.locator('p').filter({ hasText: 'Quelle:' });
  const link = source.getByRole('link', { name: 'https://example.org/rezept' });
  await expect(link).toHaveAttribute('href', 'https://example.org/rezept');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  // Tapping it opens the source in a new tab and keeps the recipe open. The external site is stubbed,
  // so the test needs no internet.
  await page
    .context()
    .route('https://example.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Rezeptquelle</title>' }),
    );
  const [tab] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
  await expect(tab).toHaveURL('https://example.org/rezept');
  await tab.close();
  await expect(page).toHaveURL(new RegExp(`/rezepte/${id}$`));

  // A recipe has one source: change it to plain text.
  await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rezept bearbeiten' })).toBeVisible();
  const sourceField = page.getByRole('region', { name: 'Weitere Angaben' }).getByLabel('Quelle');
  await expect(sourceField).toHaveValue('https://example.org/rezept');
  await sourceField.fill('Omas Kochbuch');
  await saveButton(page).click();
  await expect(page).toHaveURL(new RegExp(`/rezepte/${id}$`));

  const plain = detailArea(page).locator('p').filter({ hasText: 'Quelle:' });
  await expect(plain).toHaveText('Quelle: Omas Kochbuch');
  await expect(plain.getByRole('link')).toHaveCount(0);

  const saved = await fetchRecipe(server, id);
  expect(saved).toMatchObject({ servings: 4, prepMinutes: 15, cookMinutes: 90, source: 'Omas Kochbuch' });
});

// ---------------------------------------------------------------- b8: empty parts hidden, hints, footer

/** Parts of the detail that stand only when their value is set (F-29 AK). */
function optionalParts(
  detail: Locator,
): Record<'Zeiten und Portionen' | 'Tags' | 'Zutaten' | 'Quelle' | 'Beschreibung', Locator> {
  return {
    'Zeiten und Portionen': detail.getByLabel('Zeiten und Portionen', { exact: true }),
    Tags: detail.getByRole('list', { name: 'Tags', exact: true }),
    Zutaten: detail.getByRole('heading', { level: 2, name: 'Zutaten', exact: true }),
    Quelle: detail.getByText('Quelle:', { exact: true }),
    Beschreibung: detail.locator('h1 + p'),
  };
}

async function bottomOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  return (box?.y ?? 0) + (box?.height ?? 0);
}

async function topOf(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.y ?? 0;
}

test('b8: ein vollständiges Rezept zeigt alle Angaben, die Fußzeile steht ganz unten und frei @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  // Counterpart of the next test: the same locators find every part once it has a value, so "hidden"
  // there really means hidden.
  const author = await signIn(page, server);
  const title = unique('Linseneintopf');
  const created = await server.api.createRecipe(author.id, {
    title,
    description: 'Deftig und schnell gemacht.',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 40,
    source: 'Omas Kochbuch S. 12',
    tags: ['Suppe'],
    ingredients: [{ amount: 250, unit: 'g', name: 'Linsen' }],
    steps: [{ text: 'Alles zusammen kochen.' }],
  });
  await page.goto(`${server.url}/rezepte/${created.id}`);
  await expect(detailTitle(page, title)).toBeVisible();
  const detail = detailArea(page);
  for (const [name, locator] of Object.entries(optionalParts(detail))) {
    await expect(locator, name).toBeVisible();
  }
  await expect(optionalParts(detail).Beschreibung).toHaveText('Deftig und schnell gemacht.');

  // „Angelegt von … heute“ is the last line: below the steps and the source.
  const footer = detail.getByText(/^Angelegt von /);
  await expect(footer).toHaveText(`Angelegt von ${author.name} heute`);
  const steps = detail.getByRole('region', { name: 'Zubereitung' });
  expect(await topOf(footer)).toBeGreaterThanOrEqual(await bottomOf(steps));
  expect(await topOf(footer)).toBeGreaterThanOrEqual(await bottomOf(optionalParts(detail).Quelle));

  if ((page.viewportSize()?.width ?? 0) < 600) {
    // Phone: scrolled to the end, the fixed „Bearbeiten“ bar does not cover the footer.
    const editBar = page.getByRole('link', { name: 'Bearbeiten', exact: true }).locator('..');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(footer).toBeInViewport();
    await expect.poll(async () => (await bottomOf(footer)) <= (await topOf(editBar))).toBe(true);
  }
});

test('b8: das Detail blendet leere Angaben aus, zeigt Hinweise ohne Schritte und Foto und die Fußzeile @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const author = await signIn(page, server);
  const title = unique('Nur ein Titel');
  const created = await server.api.createRecipe(author.id, { title });
  await page.goto(`${server.url}/rezepte/${created.id}`);
  await expect(detailTitle(page, title)).toBeVisible();
  const detail = detailArea(page);
  const footer = detail.getByText(/^Angelegt von /);
  await expect(footer).toHaveText(`Angelegt von ${author.name} heute`);

  // Hidden while empty: times and servings, tags, ingredients, source, description; never "null".
  for (const [name, locator] of Object.entries(optionalParts(detail))) {
    await expect(locator, name).toHaveCount(0);
  }
  await expect(detail).not.toContainText('null');

  // Without steps: hint and a link to the editor.
  const steps = detail.getByRole('region', { name: 'Zubereitung' });
  await expect(steps).toContainText('Noch keine Zubereitung erfasst');
  const addSteps = steps.getByRole('link', { name: 'Zubereitung ergänzen' });
  await expect(addSteps).toHaveAttribute('href', `/rezepte/${created.id}/bearbeiten`);

  // Without a photo: placeholder image with "Foto hinzufügen" (opens the editor at the photo).
  await expect(detail.getByRole('img', { name: `Noch kein Foto: ${title}` })).toBeVisible();
  await expect(detail.getByRole('link', { name: 'Foto hinzufügen' })).toHaveAttribute(
    'href',
    `/rezepte/${created.id}/bearbeiten?foto=1`,
  );

  // The footer is the last line of the content.
  expect(await topOf(footer)).toBeGreaterThanOrEqual(await bottomOf(steps));

  // "Zubereitung ergänzen" opens the editor; after a change the footer names the editor, too.
  await addSteps.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rezept bearbeiten' })).toBeVisible();
  await stepField(page, 1).fill('Wasser aufsetzen.');
  await saveButton(page).click();
  await expect(page).toHaveURL(new RegExp(`/rezepte/${created.id}$`));
  await expect(detailArea(page).getByText(/^Angelegt von /)).toHaveText(
    `Angelegt von ${author.name} heute · geändert von ${author.name} heute`,
  );
  await expect(detailArea(page).getByText('Noch keine Zubereitung erfasst')).toHaveCount(0);

  // A change by another profile names that profile.
  const other = await server.api.createProfile(unique('Anna'));
  const current = await fetchRecipe(server, created.id);
  const res = await server.api.request('PUT', `/api/v1/recipes/${created.id}`, {
    profileId: other.id,
    json: { title, steps: [{ text: 'Wasser aufsetzen.' }], version: current.version },
  });
  expect(res.status).toBe(200);
  await page.reload();
  await expect(detailArea(page).getByText(/^Angelegt von /)).toHaveText(
    `Angelegt von ${author.name} heute · geändert von ${other.name} heute`,
  );

  // „Foto hinzufügen“ on the placeholder opens the editor at the photo.
  await detailArea(page).getByRole('link', { name: 'Foto hinzufügen' }).click();
  await expect(page).toHaveURL(new RegExp(`/rezepte/${created.id}/bearbeiten\\?foto=1$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Rezept bearbeiten' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toBeFocused();
});

// ---------------------------------------------------------------- b9: edit → detail and list

/** The list card of a recipe (found by its title link). */
function listCard(list: Locator, page: Page, title: string): Locator {
  return list.getByRole('article').filter({ has: page.getByRole('link', { name: title, exact: true }) });
}

/**
 * List → detail → „Bearbeiten“; changes the title and the time, the two things the list shows besides
 * photo and tags, and checks both in the detail and in the list.
 */
async function editFromList(page: Page, server: AppServer, pencilOverPhoto = false): Promise<void> {
  const profile = await signIn(page, server);
  const oldTitle = unique('Linsensuppe');
  const created = await server.api.createRecipe(profile.id, {
    title: oldTitle,
    prepMinutes: 10,
    ingredients: [{ amount: 250, unit: 'g', name: 'Linsen' }],
  });
  await page.goto(`${server.url}/rezepte`);
  await expect(listCard(page.getByRole('main'), page, oldTitle)).toContainText('Gesamtzeit 10 min');
  await page.getByRole('link', { name: oldTitle, exact: true }).click();
  await expect(detailTitle(page, oldTitle)).toBeVisible();

  const edit = page.getByRole('link', { name: 'Bearbeiten', exact: true });
  if (pencilOverPhoto) {
    // Tablet portrait: the pencil sits on the photo (here the placeholder), not in a bar or toolbar.
    const photo = page.getByRole('img', { name: `Noch kein Foto: ${oldTitle}` }).locator('..');
    const p = await edit.boundingBox();
    const f = await photo.boundingBox();
    expect(p && f).toBeTruthy();
    if (p && f) {
      const [x, y] = [p.x + p.width / 2, p.y + p.height / 2];
      expect(x > f.x && x < f.x + f.width && y > f.y && y < f.y + f.height).toBe(true);
    }
  }
  await edit.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rezept bearbeiten' })).toBeVisible();
  const title = titleField(page);
  await expect(title).toHaveValue(oldTitle);
  const newTitle = `${oldTitle} scharf`;
  await title.fill(newTitle);
  // „Weitere Angaben“ opens by itself because the recipe has a value there.
  const prep = page.getByRole('region', { name: 'Weitere Angaben' }).getByLabel('Vorbereitung (min)');
  await expect(prep).toHaveValue('10');
  await prep.fill('25');
  await saveButton(page).click();

  await expect(page).toHaveURL(new RegExp(`/rezepte/${created.id}$`));
  await expect(detailTitle(page, newTitle)).toBeVisible();
  await expect(detailArea(page).getByLabel('Zeiten und Portionen').locator('div')).toHaveText([
    /^Vorbereitung\s*25 min$/,
  ]);
  const list = await listAfterDetail(page);
  await expect(list.getByRole('link', { name: newTitle, exact: true })).toBeVisible();
  await expect(list.getByRole('link', { name: oldTitle, exact: true })).toHaveCount(0);
  await expect(listCard(list, page, newTitle)).toContainText('Gesamtzeit 25 min');

  const saved = await fetchRecipe(server, created.id);
  expect(saved).toMatchObject({ title: newTitle, prepMinutes: 25, version: created.version + 1 });
}

test('b9: nach Bearbeiten und Speichern stehen geänderter Titel und Zeit in Detail und Liste @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  await editFromList(page, server);
});

test('b9: Tablet-Hochformat: Stift über dem Foto, geänderter Titel und Zeit stehen in Detail und Liste @tablet', async ({
  page,
  server,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await editFromList(page, server, true);
});

// ---------------------------------------------------------------- b10: on-screen keyboard (simulated parts)

test('b10: alle Eingabefelder im Editor haben mindestens 16 px Schrift (kein Zoom beim Antippen auf dem iPhone) @phone', async ({
  page,
  server,
}) => {
  await openNewEditor(page, server);
  await titleField(page).fill(unique('Schriftgröße'));
  // Show every kind of field: a group name and the fields of "Weitere Angaben".
  await page.getByRole('button', { name: 'Gruppe hinzufügen' }).click();
  await expect(page.getByLabel('Gruppenname', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: /^Weitere Angaben/ }).click();
  await expect(page.getByRole('region', { name: 'Weitere Angaben' }).getByLabel('Quelle')).toBeVisible();

  const fields = await page.locator('form input:not([type="file"]), form textarea').evaluateAll((els) =>
    els.map((el) => ({
      field: el.getAttribute('aria-label') ?? el.id,
      size: Number.parseFloat(getComputedStyle(el).fontSize),
    })),
  );
  // Titel, Tags, 2 × 4 ingredient fields, group name, step, 6 fields of "Weitere Angaben".
  expect(fields.length).toBeGreaterThanOrEqual(18);
  expect(fields.filter((f) => f.size < 16)).toEqual([]);
});

test('b10: die Leiste „Abbrechen“/„Speichern“ sitzt über der Tastatur und verdeckt das angetippte Feld nicht (Tastatur simuliert) @phone', async ({
  page,
  server,
}) => {
  await expectKeyboardKeepsFieldVisible(page, server);
});

test('b10: bei 360×640 (Prüfgröße aus NF-07) verdeckt weder Tastatur noch Leiste das angetippte Feld (Tastatur simuliert) @phone', async ({
  page,
  server,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await expectKeyboardKeepsFieldVisible(page, server);
});

async function expectKeyboardKeepsFieldVisible(page: Page, server: AppServer): Promise<void> {
  // Keyboards on iOS and Android Chrome shrink only the visual viewport. The fake below does the same
  // for the app: window.__e2eKeyboard(px) opens a keyboard of that height, 0 closes it.
  await page.addInitScript(() => {
    let keyboard = 0;
    const fake = new EventTarget();
    Object.defineProperties(fake, {
      width: { get: () => window.innerWidth },
      height: { get: () => window.innerHeight - keyboard },
      offsetTop: { value: 0 },
      offsetLeft: { value: 0 },
      pageTop: { get: () => window.scrollY },
      pageLeft: { get: () => window.scrollX },
      scale: { value: 1 },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
    Object.defineProperty(window, '__e2eKeyboard', {
      value: (px: number) => {
        keyboard = px;
        fake.dispatchEvent(new Event('resize'));
      },
    });
  });
  await openNewEditor(page, server);
  const viewport = page.viewportSize()?.height ?? 0;
  const KEYBOARD = 300;
  const bar = saveButton(page).locator('..');
  const barBottom = async (): Promise<number> => {
    const box = await bar.boundingBox();
    return Math.round((box?.y ?? 0) + (box?.height ?? 0));
  };
  /** The field lies completely between the top of the screen and the bar. */
  const clearOfBar = async (field: Locator): Promise<boolean> => {
    const f = await field.boundingBox();
    const b = await bar.boundingBox();
    return f !== null && b !== null && f.y >= 0 && f.y + f.height <= b.y;
  };
  const openKeyboard = (px: number): Promise<void> =>
    page.evaluate((h) => (window as unknown as { __e2eKeyboard: (h: number) => void }).__e2eKeyboard(h), px);

  await expect.poll(barBottom).toBe(viewport);

  // Tap the step far down, then the keyboard opens. The step sits at the lower edge of the screen, just
  // above the bar, where the keyboard will cover it unless the app moves it up.
  await stepField(page, 1).click();
  await expect(stepField(page, 1)).toBeFocused();
  await expect.poll(() => clearOfBar(stepField(page, 1))).toBe(true);
  await stepField(page, 1).evaluate((el) =>
    window.scrollBy(0, el.getBoundingClientRect().bottom - (innerHeight - 110)),
  );
  const before = await stepField(page, 1).boundingBox();
  expect((before?.y ?? 0) + (before?.height ?? 0)).toBeGreaterThan(viewport - KEYBOARD);
  await openKeyboard(KEYBOARD);
  await expect.poll(barBottom).toBe(viewport - KEYBOARD);
  await expect(saveButton(page)).toBeInViewport();
  await expect.poll(() => clearOfBar(stepField(page, 1))).toBe(true);

  // With the keyboard open, a new step gets the focus and stays visible above the bar.
  await page.getByRole('button', { name: 'Schritt hinzufügen' }).click();
  await expect(stepField(page, 2)).toBeFocused();
  await expect.poll(() => clearOfBar(stepField(page, 2))).toBe(true);

  // Keyboard closed: the bar returns to the bottom edge.
  await openKeyboard(0);
  await expect.poll(barBottom).toBe(viewport);
}
