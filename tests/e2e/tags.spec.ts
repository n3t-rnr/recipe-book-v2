// Tag page /tags (Kap. 6.3 „Tags“, F-19, F-20; M4), automated in the browser against the production build.
// Covered: F-20 AK1/AK2 (start tags with count 0 on the tag page, a deleted start tag stays deleted after a
// restart), F-19 AK1 (rename into an existing tag asks „‚Nachtisch‘ in ‚Dessert‘ zusammenführen? 7 Rezepte
// betroffen“, afterwards no recipe has „Nachtisch“ and none has „Dessert“ twice), F-19 AK3 („Von 4 Rezepten
// entfernen?“, the recipes stay), merging through „Zusammenführen mit …“, „Neuer Tag“, the keyboard flow of
// the inline rename with focus return (NF-11), slow WLAN (a form or dialog closes only with the new list,
// so the page never shows the old state next to the message, NF-09), „Aktualisieren“ without an answer
// (after 10 s „Das dauert zu lange“ with „Erneut versuchen“, the list stays, NF-09), the loading, error and empty states,
// and per state in light and dark: text contrast (NF-13), tap targets (NF-07) and no horizontal scrolling
// at 360, 390, 768, 1024 and 1440 px (NF-08). F-19 AK2 (search under the new name) and AK4 (version) are API tests
// (tests/api/tags-search.test.ts, tests/api/tags.test.ts).
// The tag page is a main navigation destination without a back button (F-34 AK, decision of 25.09.2026).
import type { Locator, Page, Route } from '@playwright/test';
import { de, ERROR_TEXTS } from '../../client/src/i18n/de.ts';
import { dt } from '../../client/src/i18n/de-screens-tags.ts';
import type { Profile, RecipeDetail, RecipeResponse } from '../../shared/types.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';
import {
  COLORS,
  clippedPlaceholders,
  horizontalOverflow,
  lightSurfaces,
  lowContrastTexts,
  parseRgb,
  type Surface,
  sameColor,
  settle,
  shotPath,
  tapTargets,
} from './helpers-layout-theme.ts';

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

/** F-20, in the order of the catalog. */
const START_TAGS = [
  'Vegetarisch',
  'Vegan',
  'Schnell',
  'Hauptgericht',
  'Beilage',
  'Suppe',
  'Salat',
  'Dessert',
  'Backen',
  'Frühstück',
] as const;

/** A German compound of exactly 40 characters (F-17 maximum) without a break opportunity. */
const LONG_TAG = 'Rindfleischetikettierungsüberwachungsauf';

function isWebkit(): boolean {
  return test.info().project.use.defaultBrowserType === 'webkit';
}

/**
 * Taps on touch devices, clicks on the PC; links in WebKit are clicked (see profiles.spec.ts: Playwright's
 * WebKit on Windows sometimes turns a tap on a link into a Shift+click, which a real iPhone never does).
 */
async function press(target: Locator): Promise<void> {
  const { hasTouch } = test.info().project.use;
  const tap = hasTouch && !(isWebkit() && (await target.evaluate((el) => el.closest('a') !== null)));
  if (tap) await target.tap();
  else await target.click();
}

function tagList(page: Page): Locator {
  return page.getByRole('list', { name: dt.list, exact: true });
}

function menuButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name: dt.menu(name), exact: true });
}

function sheet(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: title, exact: true });
}

function alert(page: Page, title: string): Locator {
  return page.getByRole('alertdialog', { name: title, exact: true });
}

function nameField(page: Page): Locator {
  return page.getByRole('textbox', { name: dt.name, exact: true });
}

function searchField(page: Page): Locator {
  return page.getByRole('searchbox', { name: dt.search, exact: true });
}

function toast(page: Page, message: string): Locator {
  return page.locator('[aria-live="polite"]').getByText(message, { exact: true });
}

interface Row {
  name: string;
  count: number;
  href: string;
}

/** The rows as shown: chip label, count and link target. */
async function rows(page: Page): Promise<Row[]> {
  return tagList(page)
    .getByRole('link')
    .evaluateAll((links) =>
      links.map((a) => ({
        name: [...a.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join('')
          .trim(),
        count: Number(a.querySelector('.count')?.textContent ?? 'NaN'),
        href: a.getAttribute('href') ?? '',
      })),
    );
}

async function openTags(page: Page, server: AppServer, profile: Profile): Promise<void> {
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/tags`);
  await expect(page.getByRole('heading', { level: 1, name: de.titles.tags })).toBeVisible();
}

async function recipe(server: AppServer, id: number): Promise<RecipeDetail> {
  const res = await server.api.request('GET', `/api/v1/recipes/${id}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as RecipeResponse).recipe;
}

/** Opens the row menu of `name` and picks one of its three actions. */
async function menuAction(page: Page, name: string, action: string): Promise<void> {
  await press(menuButton(page, name));
  const menu = sheet(page, name);
  await expect(menu).toBeVisible();
  await press(menu.getByRole('button', { name: action, exact: true }));
  await expect(menu).toBeHidden();
}

/** The active element: tag, aria-label or text, so a failure shows where the focus went. */
function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'body';
    return `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''}`;
  });
}

// ---------------------------------------------------------------------------------------------------------
// F-20: start tags
// ---------------------------------------------------------------------------------------------------------

test('F-20: nach einer Neuinstallation zeigt die Tag-Seite die 10 Start-Tags mit Anzahl 0 @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await openTags(page, freshServer, anna);

  await expect.poll(async () => (await rows(page)).length).toBe(10);
  const shown = await rows(page);
  const api = await freshServer.api.tags();
  // Server order (all unused: by name key); every start tag once.
  expect(shown.map((r) => r.name)).toEqual(api.map((t) => t.name));
  expect(shown.map((r) => r.name).sort()).toEqual([...START_TAGS].sort());
  for (const row of shown) {
    expect(row.count, row.name).toBe(0);
    // The count chip opens the list filtered by the tag (like the detail's tag chips).
    const id = api.find((t) => t.name === row.name)?.id;
    expect(row.href, row.name).toBe(`/rezepte?tags=${id}`);
  }
  // A main destination: header with „Aktualisieren“, no back button (F-34 AK, decision of 25.09.2026).
  await expect(page.getByRole('button', { name: de.common.refresh, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: de.common.back })).toHaveCount(0);
  await expect(page.getByRole('button', { name: de.common.back })).toHaveCount(0);
});

test('F-20: ein gelöschter Start-Tag bleibt nach einem Neustart gelöscht @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await openTags(page, freshServer, anna);
  await expect(menuButton(page, 'Vegan')).toBeVisible();

  await menuAction(page, 'Vegan', dt.delete);
  const dialog = alert(page, dt.deleteTitle('Vegan'));
  await expect(dialog).toContainText(dt.deleteText(0));
  await dialog.getByRole('button', { name: dt.delete, exact: true }).click();
  await expect(toast(page, dt.deleted('Vegan'))).toBeVisible();
  await expect(menuButton(page, 'Vegan')).toHaveCount(0);

  await freshServer.stop();
  await freshServer.restart();
  await page.reload();
  await expect.poll(async () => (await rows(page)).length).toBe(9);
  expect((await rows(page)).map((r) => r.name)).not.toContain('Vegan');
  expect((await freshServer.api.tags()).map((t) => t.name)).not.toContain('Vegan');
});

// ---------------------------------------------------------------------------------------------------------
// List, counts, search
// ---------------------------------------------------------------------------------------------------------

test('Anzahl je Tag, ungenutzte Tags am Ende, „sue“ findet „Süßspeise“, der Chip öffnet die gefilterte Liste @phone @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  for (const title of ['Rote Grütze', 'Panna cotta', 'Kaiserschmarrn']) {
    await freshServer.api.createRecipe(anna.id, { title, tags: ['Süßspeise'] });
  }
  await freshServer.api.createRecipe(anna.id, { title: 'Linsensuppe', tags: ['Suppe', 'Vegetarisch'] });
  await freshServer.api.createRecipe(anna.id, { title: 'Gemüsecurry', tags: ['Vegetarisch'] });
  await openTags(page, freshServer, anna);

  await expect.poll(async () => (await rows(page)).length).toBe(11);
  const shown = await rows(page);
  const api = await freshServer.api.tags();
  expect(shown.map((r) => [r.name, r.count])).toEqual(api.map((t) => [t.name, t.count]));
  expect(shown.slice(0, 3).map((r) => [r.name, r.count])).toEqual([
    ['Süßspeise', 3],
    ['Vegetarisch', 2],
    ['Suppe', 1],
  ]);
  // Unused tags come last (Kap. 6.3, 6.6).
  const firstUnused = shown.findIndex((r) => r.count === 0);
  expect(firstUnused).toBe(3);
  expect(shown.slice(firstUnused).every((r) => r.count === 0)).toBe(true);

  // Same prefix rule as the editor (F-18: queryVariants), so „sue“ finds „Süßspeise“.
  await searchField(page).fill('sue');
  await expect(menuButton(page, 'Süßspeise')).toBeVisible();
  await expect(menuButton(page, 'Vegan')).toHaveCount(0);
  await expect(menuButton(page, 'Vegetarisch')).toHaveCount(0);
  await searchField(page).fill('SÜSS');
  await expect.poll(async () => (await rows(page)).map((r) => r.name)).toEqual(['Süßspeise']);

  const id = await freshServer.api.tagIdByName('Süßspeise');
  await press(tagList(page).getByRole('link').first());
  await expect(page).toHaveURL(`${freshServer.url}/rezepte?tags=${id}`);
});

// ---------------------------------------------------------------------------------------------------------
// F-19: rename, merge, delete
// ---------------------------------------------------------------------------------------------------------

test('F-19 AK1: Umbenennen von „Nachtisch“ in das vorhandene „Dessert“ fragt „‚Nachtisch‘ in ‚Dessert‘ zusammenführen? 7 Rezepte betroffen“ @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  const ids: number[] = [];
  for (let i = 1; i <= 7; i++) {
    // Two of them carry „Dessert“ already: afterwards none may have it twice.
    const tags = i <= 2 ? ['Nachtisch', 'Dessert'] : ['Nachtisch'];
    ids.push((await freshServer.api.createRecipe(anna.id, { title: `Süßes Nummer ${i}`, tags })).id);
  }
  await openTags(page, freshServer, anna);

  await menuAction(page, 'Nachtisch', dt.rename);
  await expect(nameField(page)).toBeFocused();
  await expect(nameField(page)).toHaveValue('Nachtisch');
  await nameField(page).fill('Dessert');
  await press(page.getByRole('button', { name: de.common.save, exact: true }));

  const title = '‚Nachtisch‘ in ‚Dessert‘ zusammenführen?';
  const dialog = alert(page, title);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText(title);
  await expect(dialog.getByText('7 Rezepte betroffen', { exact: true })).toBeVisible();
  const asked = await dialog.evaluate(
    (el) => `${el.querySelector('h2')?.textContent ?? ''} ${el.querySelector('p')?.textContent ?? ''}`,
  );
  expect(asked).toBe('‚Nachtisch‘ in ‚Dessert‘ zusammenführen? 7 Rezepte betroffen');
  // A final action: the focus starts on „Abbrechen“ (NF-11).
  await expect(dialog.getByRole('button', { name: de.common.cancel, exact: true })).toBeFocused();

  await press(dialog.getByRole('button', { name: dt.mergeConfirm, exact: true }));
  await expect(dialog).toBeHidden();
  await expect(toast(page, dt.merged('Nachtisch', 'Dessert'))).toBeVisible();
  await expect(menuButton(page, 'Nachtisch')).toHaveCount(0);
  await expect.poll(async () => (await rows(page))[0]).toMatchObject({ name: 'Dessert', count: 7 });

  for (const id of ids) {
    const names = (await recipe(freshServer, id)).tags.map((t) => t.name);
    expect(names, `Rezept ${id}`).not.toContain('Nachtisch');
    expect(
      names.filter((n) => n === 'Dessert'),
      `Rezept ${id}`,
    ).toHaveLength(1);
  }
  expect((await freshServer.api.tags()).map((t) => t.name)).not.toContain('Nachtisch');
});

test('F-19: „Abbrechen“ im Zusammenführen-Dialog führt zurück ins Formular mit dem getippten Namen @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await freshServer.api.createRecipe(anna.id, { title: 'Grütze', tags: ['Nachtisch'] });
  await openTags(page, freshServer, anna);

  await menuAction(page, 'Nachtisch', dt.rename);
  await nameField(page).fill('dessert');
  await nameField(page).press('Enter');
  const dialog = alert(page, dt.mergeQuestion('Nachtisch', 'Dessert'));
  await expect(dialog).toContainText(dt.affected(1));
  await dialog.getByRole('button', { name: de.common.cancel, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(nameField(page)).toHaveValue('dessert');
  await expect(nameField(page)).toBeFocused();
  expect((await freshServer.api.tags()).map((t) => t.name)).toContain('Nachtisch');
});

test('F-19: Zusammenführen über „Zusammenführen mit …“ mit Tag-Suche @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  const ids: number[] = [];
  for (const title of ['Grütze', 'Strudel', 'Creme']) {
    ids.push((await freshServer.api.createRecipe(anna.id, { title, tags: ['Nachtisch'] })).id);
  }
  await openTags(page, freshServer, anna);

  await menuAction(page, 'Nachtisch', dt.merge);
  const picker = sheet(page, dt.mergeTitle('Nachtisch'));
  await expect(picker).toBeVisible();
  // Every other tag is offered with its count, the source itself is not.
  await expect(picker.getByRole('button', { name: /^Nachtisch/ })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: /^Vegan/ })).toBeVisible();
  await picker.getByRole('searchbox', { name: dt.search }).fill('des');
  await expect(picker.getByRole('button', { name: /^Vegan/ })).toHaveCount(0);
  await picker.getByRole('button', { name: /^Dessert/ }).click();
  await expect(picker).toBeHidden();

  const dialog = alert(page, dt.mergeQuestion('Nachtisch', 'Dessert'));
  await expect(dialog.getByText(dt.affected(3), { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: dt.mergeConfirm, exact: true }).click();
  await expect(toast(page, dt.merged('Nachtisch', 'Dessert'))).toBeVisible();
  await expect.poll(async () => (await rows(page))[0]).toMatchObject({ name: 'Dessert', count: 3 });
  // The focus lands on the target's menu button, not on <body> (NF-11).
  await expect(menuButton(page, 'Dessert')).toBeFocused();
  for (const id of ids) {
    expect((await recipe(freshServer, id)).tags.map((t) => t.name)).toEqual(['Dessert']);
  }

  // With a single tag left there is nothing to merge into.
  for (const tag of await freshServer.api.tags()) {
    if (tag.name !== 'Dessert') await freshServer.api.deleteTag(anna.id, tag.id);
  }
  await page.reload();
  await menuButton(page, 'Dessert').click();
  await expect(sheet(page, 'Dessert').getByRole('button', { name: dt.merge, exact: true })).toBeDisabled();
});

test('F-19 AK3: Löschen fragt „Von 4 Rezepten entfernen?“ und die 4 Rezepte bleiben in der Liste @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  const titles = ['Kartoffelsuppe', 'Bratkartoffeln', 'Kartoffelsalat', 'Rösti'];
  const ids: number[] = [];
  for (const title of titles) {
    ids.push((await freshServer.api.createRecipe(anna.id, { title, tags: ['Kartofel', 'Beilage'] })).id);
  }
  await openTags(page, freshServer, anna);

  await menuAction(page, 'Kartofel', dt.delete);
  const dialog = alert(page, dt.deleteTitle('Kartofel'));
  await expect(dialog).toBeVisible();
  const text = dialog.getByText(dt.deleteText(4), { exact: true });
  await expect(text).toBeVisible();
  expect((await text.textContent())?.startsWith('Von 4 Rezepten entfernen?')).toBe(true);
  await expect(dialog.getByRole('button', { name: de.common.cancel, exact: true })).toBeFocused();

  await press(dialog.getByRole('button', { name: dt.delete, exact: true }));
  await expect(dialog).toBeHidden();
  await expect(toast(page, dt.deleted('Kartofel'))).toBeVisible();
  await expect(menuButton(page, 'Kartofel')).toHaveCount(0);
  // The focus goes to the next row's menu button, never to <body> (NF-11).
  await expect.poll(() => focused(page)).toMatch(/^button Aktionen für/);

  const list = await freshServer.api.list('');
  expect(list.total).toBe(4);
  for (const id of ids) {
    expect((await recipe(freshServer, id)).tags.map((t) => t.name)).toEqual(['Beilage']);
  }
  await page.goto(`${freshServer.url}/rezepte`);
  for (const title of titles) await expect(page.getByRole('link', { name: title }).first()).toBeVisible();
});

test('F-34: die Zurück-Taste schließt Menü, „Zusammenführen mit …“ und den Löschen-Dialog, die Tag-Seite bleibt; danach führt ein Zurück zur Liste @phone', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await freshServer.api.createRecipe(anna.id, { title: 'Grütze', tags: ['Nachtisch'] });
  await useProfile(page, anna.id);
  await page.goto(`${freshServer.url}/rezepte`);
  await press(page.getByRole('navigation', { name: de.nav.main }).getByRole('link', { name: de.nav.tags }));
  await expect(page).toHaveURL(`${freshServer.url}/tags`);
  await expect(menuButton(page, 'Nachtisch')).toBeVisible();
  // The Android back button: one history step, once the open sheet's own entry is on top.
  const back = async (): Promise<void> => {
    await expect
      .poll(() => page.evaluate(() => (history.state as { overlay?: unknown } | null)?.overlay === true))
      .toBe(true);
    await page.goBack();
  };

  await press(menuButton(page, 'Nachtisch'));
  await expect(sheet(page, 'Nachtisch')).toBeVisible();
  await back();
  await expect(sheet(page, 'Nachtisch')).toBeHidden();
  await expect(page).toHaveURL(`${freshServer.url}/tags`);

  // The menu hands over to the next sheet; Back closes that one and the page stays.
  await menuAction(page, 'Nachtisch', dt.merge);
  const picker = sheet(page, dt.mergeTitle('Nachtisch'));
  await expect(picker).toBeVisible();
  await back();
  await expect(picker).toBeHidden();
  await expect(page).toHaveURL(`${freshServer.url}/tags`);

  await menuAction(page, 'Nachtisch', dt.delete);
  const ask = alert(page, dt.deleteTitle('Nachtisch'));
  await expect(ask).toBeVisible();
  await back();
  await expect(ask).toBeHidden();
  await expect(page).toHaveURL(`${freshServer.url}/tags`);
  await expect(menuButton(page, 'Nachtisch')).toBeVisible();

  // No entry of a closed sheet is left behind: the next Back leads to the list, nothing was deleted.
  await page.goBack();
  await expect(page).toHaveURL(`${freshServer.url}/rezepte`);
  await expect(page.getByRole('link', { name: 'Grütze' }).first()).toBeVisible();
  expect((await freshServer.api.tags()).map((t) => t.name)).toContain('Nachtisch');
});

test('Umbenennen mit der Tastatur: Enter speichert, Escape bricht ab, der Fokus kehrt zum Menü der Zeile zurück @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await freshServer.api.createRecipe(anna.id, { title: 'Grütze', tags: ['Nachtisch'] });
  await openTags(page, freshServer, anna);
  const patches: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patches.push(r.url());
  });

  // Menu by keyboard: Enter on ⋮, then Enter on „Umbenennen“.
  await menuButton(page, 'Nachtisch').focus();
  await page.keyboard.press('Enter');
  const menu = sheet(page, 'Nachtisch');
  await expect(menu).toBeVisible();
  await expect(menu.getByText(dt.recipes(1), { exact: true })).toBeVisible();
  await menu.getByRole('button', { name: dt.rename, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();

  // The whole name is selected, so typing replaces it.
  await expect(nameField(page)).toBeFocused();
  const selection = await nameField(page).evaluate((el) => {
    const input = el as HTMLInputElement;
    return [input.selectionStart, input.selectionEnd];
  });
  expect(selection).toEqual([0, 'Nachtisch'.length]);
  await page.keyboard.type('Nachspeise');
  await page.keyboard.press('Enter');
  await expect(toast(page, dt.renamed('Nachtisch', 'Nachspeise'))).toBeVisible();
  await expect(menuButton(page, 'Nachspeise')).toBeFocused();
  expect(patches).toHaveLength(1);

  // Escape cancels without a request; the focus goes back to the row's ⋮ button.
  await page.keyboard.press('Enter');
  await expect(sheet(page, 'Nachspeise')).toBeVisible();
  await sheet(page, 'Nachspeise').getByRole('button', { name: dt.rename, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.type('Etwas anderes');
  await page.keyboard.press('Escape');
  await expect(nameField(page)).toHaveCount(0);
  await expect(menuButton(page, 'Nachspeise')).toBeFocused();

  // Escape works from the form's buttons too, not only from the field.
  await menuAction(page, 'Nachspeise', dt.rename);
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: de.common.save, exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nameField(page)).toHaveCount(0);
  await expect(menuButton(page, 'Nachspeise')).toBeFocused();

  // An unchanged name closes the form without a request.
  await menuAction(page, 'Nachspeise', dt.rename);
  await page.keyboard.press('Enter');
  await expect(nameField(page)).toHaveCount(0);
  await expect(menuButton(page, 'Nachspeise')).toBeFocused();
  expect(patches).toHaveLength(1);

  // Client check first, then the server's message inline (400 VALIDATION), the field keeps the focus.
  await menuAction(page, 'Nachspeise', dt.rename);
  await nameField(page).fill('   ');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: dt.nameMissing })).toBeVisible();
  await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true');
  expect(patches).toHaveLength(1);
  await nameField(page).fill('Glocke\u0007');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'Name enthält unerlaubte Zeichen' })).toBeVisible();
  await expect(nameField(page)).toBeFocused();
  expect(patches).toHaveLength(2);
  expect((await freshServer.api.tags()).map((t) => t.name)).toContain('Nachspeise');
});

test('„Neuer Tag“ legt einen Tag an; ein vorhandener Name antwortet „‚Dessert‘ gibt es schon“ @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await openTags(page, freshServer, anna);
  await expect.poll(async () => (await rows(page)).length).toBe(10);

  await page.getByRole('button', { name: dt.newTag, exact: true }).click();
  await expect(nameField(page)).toBeFocused();
  // The empty field is labelled visibly too, like the compact fields of the component sheet (NF-11).
  await expect(nameField(page)).toHaveAttribute('placeholder', dt.name);
  await page.keyboard.type('Grillen');
  await page.keyboard.press('Enter');
  await expect(toast(page, dt.created('Grillen'))).toBeVisible();
  await expect(menuButton(page, 'Grillen')).toBeFocused();
  expect(await rows(page)).toContainEqual(expect.objectContaining({ name: 'Grillen', count: 0 }));

  // An existing key (any spelling, F-17) creates nothing and says so.
  await page.getByRole('button', { name: dt.newTag, exact: true }).click();
  await page.keyboard.type('dessert');
  await page.keyboard.press('Enter');
  await expect(toast(page, dt.exists('Dessert'))).toBeVisible();
  await expect(menuButton(page, 'Dessert')).toBeFocused();
  expect(await rows(page)).toHaveLength(11);

  // Search without a match offers the typed name; the form starts with it.
  await searchField(page).fill('Picknick');
  await expect(page.getByText(dt.noMatch('Picknick'), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: dt.createNamed('Picknick'), exact: true }).click();
  await expect(nameField(page)).toHaveValue('Picknick');
  await page.keyboard.press('Enter');
  await expect(toast(page, dt.created('Picknick'))).toBeVisible();
  await expect(searchField(page)).toHaveValue('');
  await expect(menuButton(page, 'Picknick')).toBeFocused();

  // „Abbrechen“ closes the empty form and gives the focus back to „Neuer Tag“.
  await page.getByRole('button', { name: dt.newTag, exact: true }).click();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: dt.nameMissing })).toBeVisible();
  await page.getByRole('button', { name: de.common.cancel, exact: true }).click();
  await expect(nameField(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: dt.newTag, exact: true })).toBeFocused();
  expect((await freshServer.api.tags()).map((t) => t.name).sort()).toEqual(
    [...START_TAGS, 'Grillen', 'Picknick'].sort(),
  );
});

test('Laden, Fehler mit „Erneut versuchen“, leere Liste und „Aktualisieren“ @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await useProfile(page, anna.id);

  // Loading: skeleton bars with a status text, no list yet.
  const release = await holdTags(page);
  await page.goto(`${freshServer.url}/tags`);
  await expect(page.getByRole('status').filter({ hasText: dt.loading })).toBeAttached();
  await expect(page.locator('[aria-busy="true"]')).toBeVisible();
  await expect(tagList(page)).toHaveCount(0);
  release();
  await expect.poll(async () => (await rows(page)).length).toBe(10);

  // Failed load without a list: the message and „Erneut versuchen“.
  await page.route('**/api/v1/tags', (route) => route.abort('connectionrefused'));
  await page.reload();
  const failed = page.getByRole('heading', { name: ERROR_TEXTS.NETWORK, exact: true });
  await expect(failed).toBeVisible();
  await page.unroute('**/api/v1/tags');
  await page.getByRole('button', { name: de.common.retry, exact: true }).first().click();
  await expect.poll(async () => (await rows(page)).length).toBe(10);

  // Another device adds a recipe: „Aktualisieren“ shows the new count.
  await freshServer.api.createRecipe(anna.id, { title: 'Gemüsesuppe', tags: ['Vegan'] });
  await page.getByRole('button', { name: de.common.refresh, exact: true }).click();
  await expect.poll(async () => (await rows(page))[0]).toMatchObject({ name: 'Vegan', count: 1 });

  // No tags at all: „Noch keine Tags“ with „Neuer Tag“.
  for (const tag of await freshServer.api.tags()) await freshServer.api.deleteTag(anna.id, tag.id);
  await page.getByRole('button', { name: de.common.refresh, exact: true }).click();
  await expect(page.getByRole('heading', { name: dt.emptyTitle, exact: true })).toBeVisible();
  await expect(page.getByText(dt.emptyText, { exact: true })).toBeVisible();

  // A failed „Aktualisieren“ on the empty page says so too (NF-09): the empty state has no retry of its
  // own, and „Noch keine Tags“ alone would hide that the load failed. A server error offers no retry.
  await page.route('**/api/v1/tags', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ status: 500, body: '' }) : route.fallback(),
  );
  await page.getByRole('button', { name: de.common.refresh, exact: true }).click();
  await expect(toast(page, ERROR_TEXTS.INTERNAL)).toBeVisible();
  await expect(
    page.locator('[aria-live="polite"]').getByRole('button', { name: de.common.retry, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: dt.emptyTitle, exact: true })).toBeVisible();
  await page.unroute('**/api/v1/tags');

  await page.getByRole('button', { name: dt.newTag, exact: true }).last().click();
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.type('Grillen');
  await page.keyboard.press('Enter');
  await expect(toast(page, dt.created('Grillen'))).toBeVisible();
  await expect.poll(async () => (await rows(page)).map((r) => r.name)).toEqual(['Grillen']);

  // Deleting the only row: the focus goes to the search field, not to <body> (NF-11).
  await menuAction(page, 'Grillen', dt.delete);
  await alert(page, dt.deleteTitle('Grillen')).getByRole('button', { name: dt.delete, exact: true }).click();
  await expect(toast(page, dt.deleted('Grillen'))).toBeVisible();
  await expect(page.getByRole('heading', { name: dt.emptyTitle, exact: true })).toBeVisible();
  await expect(searchField(page)).toBeFocused();
});

test('Anderes Gerät und Netzfehler: Umbenennen eines gelöschten Tags meldet es, Löschen ohne Netz bietet „Erneut versuchen“ @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await freshServer.api.createRecipe(anna.id, { title: 'Grütze', tags: ['Nachtisch'] });
  await openTags(page, freshServer, anna);

  // Deleted on another device while the form is open: 404, the row goes, the focus to the search field.
  await menuAction(page, 'Nachtisch', dt.rename);
  await freshServer.api.deleteTag(anna.id, await freshServer.api.tagIdByName('Nachtisch'));
  await nameField(page).fill('Dessertchen');
  await nameField(page).press('Enter');
  await expect(toast(page, dt.gone)).toBeVisible();
  await expect(nameField(page)).toHaveCount(0);
  await expect(menuButton(page, 'Nachtisch')).toHaveCount(0);
  await expect(searchField(page)).toBeFocused();

  // No connection while deleting: the toast offers „Erneut versuchen“, which repeats the delete (NF-09).
  const vegan = await freshServer.api.tagIdByName('Vegan');
  await page.route(`**/api/v1/tags/${vegan}`, (route) => route.abort('connectionrefused'));
  await menuAction(page, 'Vegan', dt.delete);
  await alert(page, dt.deleteTitle('Vegan')).getByRole('button', { name: dt.delete, exact: true }).click();
  await expect(toast(page, ERROR_TEXTS.NETWORK)).toBeVisible();
  await expect(menuButton(page, 'Vegan')).toBeVisible();
  await page.unroute(`**/api/v1/tags/${vegan}`);
  await page
    .locator('[aria-live="polite"]')
    .getByRole('button', { name: de.common.retry, exact: true })
    .click();
  await expect(toast(page, dt.deleted('Vegan'))).toBeVisible();
  await expect(menuButton(page, 'Vegan')).toHaveCount(0);
  expect((await freshServer.api.tags()).map((t) => t.name)).not.toContain('Vegan');
});

test('Langsames WLAN: nach Umbenennen, „Neuer Tag“ und Löschen zeigt die Seite nie den alten Stand neben der Meldung, der Fokus fällt nie auf <body> @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await freshServer.api.createRecipe(anna.id, { title: 'Grütze', tags: ['Nachtisch'] });
  await openTags(page, freshServer, anna);
  await expect(menuButton(page, 'Nachtisch')).toBeVisible();
  // From here the list reload after each write takes 1.5 s (NF-09); the writes answer at once.
  await slowTags(page, 1500);
  const answered = (method: string): Promise<unknown> =>
    page.waitForResponse(
      (res) => res.request().method() === method && new URL(res.url()).pathname.startsWith('/api/v1/tags'),
    );

  // Rename: the form stays (busy) with the focus in the field until the list has the new name.
  await menuAction(page, 'Nachtisch', dt.rename);
  await nameField(page).fill('Nachspeise');
  const patched = answered('PATCH');
  await nameField(page).press('Enter');
  await patched;
  await page.waitForTimeout(300);
  expect(await focused(page)).toBe(`input ${dt.name}`);
  await expect(toast(page, dt.renamed('Nachtisch', 'Nachspeise'))).toBeVisible();
  // The message comes with the new list: no row shows the old name next to it.
  expect(await menuButton(page, 'Nachtisch').count()).toBe(0);
  await expect(menuButton(page, 'Nachspeise')).toBeFocused();

  // „Neuer Tag“: the same; the new row is there when the message is.
  await page.getByRole('button', { name: dt.newTag, exact: true }).click();
  await nameField(page).fill('Grillen');
  const posted = answered('POST');
  await nameField(page).press('Enter');
  await posted;
  await page.waitForTimeout(300);
  expect(await focused(page)).toBe(`input ${dt.name}`);
  await expect(toast(page, dt.created('Grillen'))).toBeVisible();
  expect(await menuButton(page, 'Grillen').count()).toBe(1);
  await expect(menuButton(page, 'Grillen')).toBeFocused();

  // Delete: the dialog stays (busy) until the row is gone, then the focus goes to a neighbour.
  await menuAction(page, 'Grillen', dt.delete);
  const dialog = alert(page, dt.deleteTitle('Grillen'));
  const deleted = answered('DELETE');
  await dialog.getByRole('button', { name: dt.delete, exact: true }).click();
  await deleted;
  await page.waitForTimeout(300);
  expect(await dialog.isVisible()).toBe(true);
  await expect(dialog.getByRole('button', { name: dt.delete, exact: true })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  await expect(toast(page, dt.deleted('Grillen'))).toBeVisible();
  expect(await menuButton(page, 'Grillen').count()).toBe(0);
  await expect(dialog).toBeHidden();
  await expect.poll(() => focused(page)).toMatch(/^button Aktionen für/);
});

test('Langsames WLAN: kommt nach dem Umbenennen die Liste nicht, meldet die Seite das Umbenennen nach 10 s und der Fokus wartet nicht auf einen zweiten Versuch @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await freshServer.api.createRecipe(anna.id, { title: 'Grütze', tags: ['Nachtisch'] });
  await page.clock.install();
  await openTags(page, freshServer, anna);
  await expect(menuButton(page, 'Nachtisch')).toBeVisible();

  // The write gets through, the list reload after it gets no answer.
  const release = await swallowTags(page);
  await menuAction(page, 'Nachtisch', dt.rename);
  await nameField(page).fill('Nachspeise');
  const patched = page.waitForResponse((res) => res.request().method() === 'PATCH');
  const reload = page.waitForRequest(
    (req) => req.method() === 'GET' && new URL(req.url()).pathname === '/api/v1/tags',
  );
  await nameField(page).press('Enter');
  expect((await patched).status()).toBe(200);
  await reload;
  await page.clock.fastForward(10_000);

  // The rename is reported; the form goes and the focus lands on a row's ⋮ at once (NF-11), not on
  // <body> while a second load waits another 10 s.
  await expect(toast(page, dt.renamed('Nachtisch', 'Nachspeise'))).toBeVisible();
  await expect(nameField(page)).toHaveCount(0);
  await expect.poll(() => focused(page), { timeout: 3_000 }).toMatch(/^button Aktionen für/);
  expect((await freshServer.api.tags()).map((t) => t.name)).toContain('Nachspeise');

  // Once the connection is back, „Aktualisieren“ shows the new name.
  await release();
  await press(page.getByRole('button', { name: de.common.refresh, exact: true }));
  await expect(menuButton(page, 'Nachspeise')).toBeVisible();
  await expect(menuButton(page, 'Nachtisch')).toHaveCount(0);
});

test('„Aktualisieren“ ohne Antwort: nach 10 s „Das dauert zu lange“ mit „Erneut versuchen“, die Liste bleibt, der zweite Versuch zeigt die neuen Zahlen @phone @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await page.clock.install();
  await openTags(page, freshServer, anna);
  await expect.poll(async () => (await rows(page)).length).toBe(10);
  // Changed meanwhile on another device: only a load that gets through shows it.
  await freshServer.api.createRecipe(anna.id, { title: 'Gemüsesuppe', tags: ['Vegan'] });

  const release = await swallowTags(page);
  const sent = page.waitForRequest(
    (req) => req.method() === 'GET' && new URL(req.url()).pathname === '/api/v1/tags',
  );
  await press(page.getByRole('button', { name: de.common.refresh, exact: true }));
  await sent;
  const timedOut = page
    .locator('[aria-live="polite"]')
    .filter({ has: page.getByText(ERROR_TEXTS.TIMEOUT, { exact: true }) });
  await page.clock.fastForward(8_000);
  await expect(timedOut, 'vor Ablauf der 10 s noch kein Toast').toHaveCount(0);
  await page.clock.fastForward(2_000);
  await expect(timedOut).toBeVisible();
  // Slow, not offline: no banner, and the last list stays visible (F-33).
  await expect(page.getByRole('alert').filter({ hasText: ERROR_TEXTS.NETWORK })).toHaveCount(0);
  const kept = await rows(page);
  expect(kept).toHaveLength(10);
  expect(kept.find((r) => r.name === 'Vegan')?.count).toBe(0);

  // „Erneut versuchen“ loads the list again (NF-09); the toast goes.
  await release();
  await press(timedOut.getByRole('button', { name: de.common.retry, exact: true }));
  await expect.poll(async () => (await rows(page))[0]).toMatchObject({ name: 'Vegan', count: 1 });
  await expect(timedOut).toHaveCount(0);

  // A load that times out after the page was left does not report on the next screen.
  const releaseAgain = await swallowTags(page);
  const again = page.waitForRequest(
    (req) => req.method() === 'GET' && new URL(req.url()).pathname === '/api/v1/tags',
  );
  await press(page.getByRole('button', { name: de.common.refresh, exact: true }));
  await again;
  await press(page.getByRole('navigation', { name: de.nav.main }).getByRole('link', { name: de.nav.more }));
  await expect(page).toHaveURL(`${freshServer.url}/mehr`);
  const aborted = page.waitForEvent(
    'requestfailed',
    (req) => req.method() === 'GET' && new URL(req.url()).pathname === '/api/v1/tags',
  );
  await page.clock.fastForward(10_000);
  await aborted;
  await page.waitForTimeout(500);
  await expect(timedOut).toHaveCount(0);
  await releaseAgain();
});

/** Swallows every GET /tags without an answer (the app gives up after its 10 s) until release(). */
async function swallowTags(page: Page): Promise<() => Promise<void>> {
  const matches = (url: URL): boolean => url.pathname === '/api/v1/tags';
  const handler = (route: Route): Promise<void> | undefined =>
    route.request().method() === 'GET' ? undefined : route.fallback();
  await page.route(matches, handler);
  return () => page.unroute(matches, handler);
}

/** Holds GET /tags until the returned function is called; POST /tags (same URL) passes. */
async function holdTags(page: Page): Promise<() => void> {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/tags', async (route: Route) => {
    if (route.request().method() === 'GET') await held;
    await route.continue();
  });
  return () => release();
}

/** Delays every GET /tags (slow WLAN, NF-09); writes pass at once. */
async function slowTags(page: Page, ms: number): Promise<void> {
  await page.route('**/api/v1/tags', async (route: Route) => {
    if (route.request().method() === 'GET') await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

// ---------------------------------------------------------------------------------------------------------
// NF-07, NF-08, NF-13 for every state of the page, light and dark
// ---------------------------------------------------------------------------------------------------------

/** Approved light surfaces in dark mode: Moonstone and Vanilla with Raisin Black text (Kap. 6.7), avatars. */
function approvedLight(surface: Surface): boolean {
  const color = parseRgb(surface.color);
  const accent = sameColor(color, COLORS.moonstone) || sameColor(color, COLORS.vanilla);
  if (accent) return sameColor(parseRgb(surface.text), COLORS.raisin);
  return surface.what.startsWith('span.avatar');
}

interface Findings {
  problems: string[];
}

/** Runs the layout and theme checks on the current state and collects every problem. */
async function check(page: Page, state: string, dark: boolean, found: Findings): Promise<void> {
  await settle(page);
  const where = `${state} (${page.viewportSize()?.width} px, ${dark ? 'dunkel' : 'hell'})`;
  for (const t of await lowContrastTexts(page, { wholePage: true })) {
    found.problems.push(`${where}: Kontrast ${t.what} ${t.ratio} < ${t.required}`);
  }
  for (const t of await tapTargets(page)) {
    if (t.width < 44 || t.height < 44)
      found.problems.push(`${where}: Tippfläche ${t.what} ${t.width}×${t.height}`);
  }
  const overflow = await horizontalOverflow(page);
  if (overflow.scrollWidth > overflow.innerWidth) {
    found.problems.push(`${where}: scrollt waagerecht (${overflow.culprits.join(', ')})`);
  }
  for (const p of await clippedPlaceholders(page)) {
    found.problems.push(`${where}: Platzhalter abgeschnitten ${p.what} „${p.text}“`);
  }
  if (dark) {
    for (const s of await lightSurfaces(page, { wholePage: true })) {
      if (!approvedLight(s)) found.problems.push(`${where}: helle Fläche ${s.what} ${s.color}`);
    }
  }
  if (!isWebkit()) {
    await page.screenshot({ path: shotPath(test.info(), `tags-${state}-${dark ? 'dunkel' : 'hell'}`) });
  }
}

const WIDTHS = [
  { width: 360, height: 800, tag: '@phone' },
  { width: 390, height: 844, tag: '@phone' },
  { width: 768, height: 1024, tag: '@tablet @desktop' },
  { width: 1024, height: 768, tag: '@tablet @desktop' },
  { width: 1440, height: 900, tag: '@desktop' },
] as const;

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'hell' : 'dunkel', () => {
    test.use({ colorScheme: scheme });

    for (const size of WIDTHS) {
      test(`NF-07, NF-08, NF-13: jeder Zustand der Tag-Seite bei ${size.width} px, ${scheme === 'light' ? 'hell' : 'dunkel'} – Kontrast, Tippflächen ≥ 44 px, kein waagerechtes Scrollen ${size.tag}`, async ({
        page,
        freshServer,
      }) => {
        test.setTimeout(90_000);
        const dark = scheme === 'dark';
        const found: Findings = { problems: [] };
        const anna = await freshServer.api.createProfile('Anna');
        await freshServer.api.createRecipe(anna.id, { title: 'Grütze', tags: ['Nachtisch', LONG_TAG] });
        await freshServer.api.createRecipe(anna.id, { title: 'Strudel', tags: ['Nachtisch', 'Für Gäste'] });
        await useProfile(page, anna.id);
        await page.setViewportSize({ width: size.width, height: size.height });

        const release = await holdTags(page);
        await page.goto(`${freshServer.url}/tags`);
        await expect(page.locator('[aria-busy="true"]')).toBeVisible();
        await check(page, 'laden', dark, found);
        release();
        await expect.poll(async () => (await rows(page)).length).toBe(13);
        await check(page, 'liste', dark, found);

        await searchField(page).fill('Zwetschgenröster');
        await expect(page.getByText(dt.noMatch('Zwetschgenröster'), { exact: true })).toBeVisible();
        await check(page, 'kein-treffer', dark, found);
        await searchField(page).fill('');

        await press(page.getByRole('button', { name: dt.newTag, exact: true }));
        await nameField(page).fill('');
        await nameField(page).press('Enter');
        await expect(page.getByRole('alert').filter({ hasText: dt.nameMissing })).toBeVisible();
        await check(page, 'formular-fehler', dark, found);
        await nameField(page).press('Escape');
        await expect(nameField(page)).toHaveCount(0);

        await menuAction(page, LONG_TAG, dt.rename);
        await nameField(page).fill('Tab\u0007');
        await nameField(page).press('Enter');
        await expect(
          page.getByRole('alert').filter({ hasText: 'Name enthält unerlaubte Zeichen' }),
        ).toBeVisible();
        await check(page, 'umbenennen-fehler', dark, found);
        await nameField(page).press('Escape');

        await press(menuButton(page, LONG_TAG));
        await expect(sheet(page, LONG_TAG)).toBeVisible();
        await check(page, 'menue', dark, found);
        await press(sheet(page, LONG_TAG).getByRole('button', { name: dt.merge, exact: true }));
        const picker = sheet(page, dt.mergeTitle(LONG_TAG));
        await expect(picker).toBeVisible();
        await check(page, 'zusammenfuehren-sheet', dark, found);
        await press(picker.getByRole('button', { name: /^Nachtisch/ }));
        const merge = alert(page, dt.mergeQuestion(LONG_TAG, 'Nachtisch'));
        await expect(merge).toBeVisible();
        await check(page, 'dialog-zusammenfuehren', dark, found);
        await press(merge.getByRole('button', { name: de.common.cancel, exact: true }));
        await expect(merge).toBeHidden();

        await menuAction(page, LONG_TAG, dt.delete);
        const remove = alert(page, dt.deleteTitle(LONG_TAG));
        await expect(remove).toBeVisible();
        await check(page, 'dialog-loeschen', dark, found);
        await press(remove.getByRole('button', { name: de.common.cancel, exact: true }));
        await expect(remove).toBeHidden();

        await page.route('**/api/v1/tags', (route) => route.abort('connectionrefused'));
        await page.reload();
        await expect(page.getByRole('heading', { name: ERROR_TEXTS.NETWORK, exact: true })).toBeVisible();
        await check(page, 'fehler', dark, found);
        await page.unroute('**/api/v1/tags');

        for (const tag of await freshServer.api.tags()) await freshServer.api.deleteTag(anna.id, tag.id);
        await page.reload();
        await expect(page.getByRole('heading', { name: dt.emptyTitle, exact: true })).toBeVisible();
        await check(page, 'leer', dark, found);

        expect(found.problems).toEqual([]);
      });
    }
  });
}
