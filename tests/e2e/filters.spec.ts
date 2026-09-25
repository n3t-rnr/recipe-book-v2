// Tag filter, filter sheet, sorting and the list state in the URL (F-20, F-24, F-26, F-29, F-34, Kap. 6.3,
// Kap. 6.4, NF-07, NF-08), end to end:
// - F-24: two chip taps, check icon, badge and name of the filter button, „Einer reicht“, one chip off,
//   „Filter zurücksetzen“; chips 44 px high and 8 px apart (NF-07). A tap in the scrolled row switches the
//   chip in place, under the finger, and a second tap there switches it back; the sheet and a reload put
//   the active chips first, with the row at its start; a recipe opened next to the list (≥ 1024 px) moves
//   no chip. „Alle Tags …“ opens the sheet with the focus on „Tags“ (NF-11).
// - Filter sheet on the phone, side panel next to the list at ≥ 1024 px, bottom sheet in tablet portrait:
//   tag search with counts, hits in the head, no „Anwenden“, no M5 controls; turning the tablet keeps
//   filters and sheet (amendment 18).
// - F-20: the start tags in the chip row of a fresh install.
// - F-26: Titel A–Z (catalog example), Relevanz with and Neueste without a search term, sort through paging
//   and a reload, keyboard in the sort radio group.
// - F-29: a tag in the detail opens the list with that tag, also a tag saved a moment ago (amendment 3).
// - F-33/NF-09: a failed filter load keeps no wrong list under the filter; the sheet's chunk failing while
//   the server is away leaves the filter button usable.
// - F-34: two filters survive a reload and a copied link; Back from recipe 30 of a filtered list; Back and
//   the close button of the sheet; detail URLs carry the filter only from 1024 px (amendment 19), and the
//   tab keeps the recipe's title when the list column filters.
// Chip-row tests use freshServer: on the shared server other tests' tags could push theirs out (amendment 14).
import type { Browser, Locator, Page } from '@playwright/test';
import { de } from '../../client/src/i18n/de.ts';
import { deEditor } from '../../client/src/i18n/de-editor.ts';
import { ds } from '../../client/src/i18n/de-screens.ts';
import { df } from '../../client/src/i18n/de-screens-filter.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';

/** F-20: the 10 start tags, all unused, in server order (count, then name). */
const START_TAGS_BY_NAME = [
  'Backen',
  'Beilage',
  'Dessert',
  'Frühstück',
  'Hauptgericht',
  'Salat',
  'Schnell',
  'Suppe',
  'Vegan',
  'Vegetarisch',
];

function chipRow(page: Page): Locator {
  return page.getByRole('group', { name: ds.list.chips });
}

function chip(page: Page, name: string): Locator {
  return chipRow(page).getByRole('button', { name, exact: true });
}

function filterButton(page: Page, active = 0): Locator {
  return page.getByRole('button', { name: ds.list.filter(active), exact: true });
}

function sheet(page: Page): Locator {
  return page.getByRole('dialog', { name: df.title });
}

function searchBox(page: Page): Locator {
  return page.getByRole('searchbox', { name: ds.list.search, exact: true });
}

function countText(page: Page): Locator {
  return page.locator('main p.count');
}

/** Titles of the recipe links in the list, in order. */
async function titles(page: Page): Promise<string[]> {
  const list = page.getByRole('main').getByRole('list').first();
  return (await list.getByRole('link').allTextContents()).map((t) => t.trim());
}

function sortButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Sortierung: / });
}

/** The recipe list of a fresh server with these recipes (title → tags), opened as a new profile. */
async function freshList(
  page: Page,
  server: AppServer,
  recipes: ReadonlyArray<readonly [string, readonly string[]]>,
): Promise<number> {
  const profile = await server.api.createProfile('Anna');
  for (const [title, tags] of recipes) await server.api.createRecipe(profile.id, { title, tags: [...tags] });
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await expect(countText(page)).toHaveText(
    `${recipes.length} ${recipes.length === 1 ? 'Rezept' : 'Rezepte'}`,
  );
  return profile.id;
}

const MENU = [
  ['Gemüsecurry', ['Vegetarisch', 'Schnell']],
  ['Linsensalat', ['Vegetarisch', 'Salat']],
  ['Schnitzel', ['Schnell']],
  ['Gulasch', ['Hauptgericht']],
] as const;

async function isWide(page: Page): Promise<boolean> {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

// --- F-24: chip row, AND/OR, reset

test('F-24: „Vegetarisch“ und „Schnell“ mit zwei Fingertipps aktiv, mit Häkchen und Zahl am Filtersymbol; „Einer reicht“ zeigt die Vereinigung; ein Chip lässt sich einzeln entfernen @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, MENU);
  const veg = await freshServer.api.tagIdByName('Vegetarisch');
  const quick = await freshServer.api.tagIdByName('Schnell');

  await chip(page, 'Vegetarisch').click();
  await chip(page, 'Schnell').click();
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${veg},${quick}$`));
  for (const name of ['Vegetarisch', 'Schnell']) {
    await expect(chip(page, name)).toHaveAttribute('aria-pressed', 'true');
    // State not by colour alone (NF-13): the check icon.
    await expect(chip(page, name).locator('svg')).toHaveCount(1);
  }
  await expect(chip(page, 'Suppe')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip(page, 'Suppe').locator('svg')).toHaveCount(0);
  // Taps in the row switch the chips in place: nothing moves under the finger (NF-07).
  await expect(chipRow(page).getByRole('button')).toHaveText(chipNamesInServerOrder());
  const filter = filterButton(page, 2);
  await expect(filter).toBeVisible();
  await expect(filter).toHaveAccessibleName('Filter, 2 aktiv');
  await expect(filter.locator('.badge')).toHaveText('2');
  await expect.poll(() => titles(page)).toEqual(['Gemüsecurry']);
  await expect(countText(page)).toHaveText('1 von 4 Rezepten');

  // „Einer reicht“ in the sheet: the union, at once (no „Anwenden“).
  await filter.click();
  await expect(sheet(page)).toBeVisible();
  const any = sheet(page).getByRole('radio', { name: df.modes.any });
  await expect(sheet(page).getByRole('radio', { name: df.modes.all })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await any.click();
  await expect(any).toHaveAttribute('aria-checked', 'true');
  await expect(page).toHaveURL(new RegExp(`tags=${veg},${quick}&tagMode=any$`));
  await expect(sheet(page).getByText('3 Treffer')).toBeVisible();
  await sheet(page).getByRole('button', { name: df.close }).click();
  await expect(sheet(page)).toBeHidden();
  await expect
    .poll(async () => (await titles(page)).sort())
    .toEqual(['Gemüsecurry', 'Linsensalat', 'Schnitzel']);
  await expect(countText(page)).toHaveText('3 von 4 Rezepten');
  // Only the mode changed in the sheet: the active tags are still the ones set in the row, so no chip
  // moves (new tags from the sheet sort the row: the F-24/NF-07 test with the scrolled row).
  await expect(chipRow(page).getByRole('button')).toHaveText(chipNamesInServerOrder());

  // One tap removes one filter only.
  await chip(page, 'Schnell').click();
  await expect(page).toHaveURL(new RegExp(`tags=${veg}&tagMode=any$`));
  await expect(chip(page, 'Vegetarisch')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Schnell')).toHaveAttribute('aria-pressed', 'false');
  await expect(filterButton(page, 1).locator('.badge')).toHaveText('1');
  await expect.poll(async () => (await titles(page)).sort()).toEqual(['Gemüsecurry', 'Linsensalat']);
});

test('F-24: „Filter zurücksetzen“ entfernt Tags, Modus und Suchbegriff mit einem Fingertipp @phone @desktop', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, MENU);
  const veg = await freshServer.api.tagIdByName('Vegetarisch');
  await page.goto(`${freshServer.url}/rezepte?q=curry&tags=${veg}&tagMode=any`);
  await expect(searchBox(page)).toHaveValue('curry');
  await expect(chip(page, 'Vegetarisch')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => titles(page)).toEqual(['Gemüsecurry']);

  await filterButton(page, 1).click();
  await sheet(page).getByRole('button', { name: df.reset }).click();
  await expect(page).toHaveURL(/\/rezepte$/);
  // The sheet stays open and shows the new count.
  await expect(sheet(page).getByText('4 Treffer')).toBeVisible();
  await expect(sheet(page).getByRole('radio', { name: df.modes.all })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await sheet(page).getByRole('button', { name: df.close }).click();
  await expect(searchBox(page)).toHaveValue('');
  await expect(chipRow(page).getByRole('button', { pressed: true })).toHaveCount(0);
  await expect(filterButton(page, 0).locator('.badge')).toHaveCount(0);
  await expect(countText(page)).toHaveText('4 Rezepte');
});

test('NF-07/NF-08: Chips sind 44 px hoch und 8 px auseinander; nur die Chip-Reihe scrollt waagerecht @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, MENU);
  const boxes = await chipRow(page)
    .getByRole('button')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
  expect(boxes.length).toBe(START_TAGS_BY_NAME.length + 1);
  for (const [i, box] of boxes.entries()) {
    expect(box.height, `Chip ${i + 1}: Höhe`).toBeGreaterThanOrEqual(44);
    const next = boxes[i + 1];
    if (next)
      expect(Math.round(next.left - box.right), `Abstand nach Chip ${i + 1}`).toBeGreaterThanOrEqual(8);
  }
  const scroll = await chipRow(page).evaluate((el) => ({
    width: el.clientWidth,
    content: el.scrollWidth,
    page: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll.page, 'die Seite scrollt nicht waagerecht').toBeLessThanOrEqual(scroll.inner);
  expect(scroll.content, 'die Chip-Reihe scrollt').toBeGreaterThan(scroll.width);
  // The last chip „Alle Tags …“ ends 20 px before the end of the scrolled row (8 px gap + 12 px).
  const end = await chipRow(page).evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    const last = el.lastElementChild?.getBoundingClientRect();
    return last ? Math.round(el.getBoundingClientRect().right - last.right) : -1;
  });
  expect(end).toBe(20);
  await expect(chip(page, ds.list.allTags)).toBeInViewport();
});

test('NF-11: mit Tab ist jeder Chip ganz sichtbar; Enter schaltet ihn an seinem Platz, der Fokus bleibt am Chip @desktop', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, MENU);
  await page.getByRole('button', { name: ds.list.filter(0), exact: true }).focus();
  const names: string[] = [];
  for (let i = 0; i <= START_TAGS_BY_NAME.length; i++) {
    await page.keyboard.press('Tab');
    const place = await page.evaluate(() => {
      const el = document.activeElement;
      const row = el?.closest('[role="group"]')?.getBoundingClientRect();
      const box = el?.getBoundingClientRect();
      return {
        name: el?.textContent?.trim() ?? '',
        inside: !!row && !!box && box.left >= row.left - 0.5 && box.right <= row.right + 0.5,
      };
    });
    names.push(place.name);
    expect(place.inside, `„${place.name}“ ganz in der Chip-Reihe sichtbar`).toBe(true);
  }
  expect(names).toEqual(chipNamesInServerOrder());

  // Back to a chip in the middle; Enter switches it where it is (a switch in the row moves no chip, F-24),
  // and it keeps the focus.
  const salat = chip(page, 'Salat');
  await salat.focus();
  await page.keyboard.press('Enter');
  await expect(salat).toHaveAttribute('aria-pressed', 'true');
  await expect(salat).toBeFocused();
  await expect(chipRow(page).getByRole('button')).toHaveText(chipNamesInServerOrder());
  expect(await salat.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  await page.keyboard.press(' ');
  await expect(salat).toHaveAttribute('aria-pressed', 'false');
  await expect(salat).toBeFocused();
});

/** The chip row of MENU on a fresh server: used tags by count, then the unused start tags, then „Alle Tags …“. */
function chipNamesInServerOrder(): string[] {
  return [
    'Schnell',
    'Vegetarisch',
    'Hauptgericht',
    'Salat',
    'Backen',
    'Beilage',
    'Dessert',
    'Frühstück',
    'Suppe',
    'Vegan',
    ds.list.allTags,
  ];
}

test('F-24/NF-07: ein Fingertipp schaltet einen hineingescrollten Chip an seinem Platz, ein zweiter an derselben Stelle schaltet ihn wieder aus; nach dem Sheet und neu geladen stehen die aktiven vorn @phone @tablet @desktop', async ({
  page,
  freshServer,
  hasTouch,
}) => {
  await freshList(page, freshServer, MENU);
  const vegan = await freshServer.api.tagIdByName('Vegan');
  const soup = await freshServer.api.tagIdByName('Suppe');
  const row = chipRow(page);
  await expect(row.getByRole('button')).toHaveText(chipNamesInServerOrder());
  // Swiped until „Vegan“ (the last tag) is in view: the row scrolls, not the page.
  const scrolled = await row.evaluate((el) => {
    const target = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Vegan');
    if (target) el.scrollLeft += target.getBoundingClientRect().left - el.getBoundingClientRect().left - 20;
    return el.scrollLeft;
  });
  expect(scrolled, 'die Chip-Reihe ist gescrollt').toBeGreaterThan(0);

  async function centerOf(name: string): Promise<{ x: number; y: number }> {
    const box = await chip(page, name).boundingBox();
    if (!box) throw new Error(`„${name}“ nicht sichtbar`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  const tap = (at: { x: number; y: number }): Promise<void> =>
    hasTouch ? page.touchscreen.tap(at.x, at.y) : page.mouse.click(at.x, at.y);
  /** Name and state of the chip at this point of the screen. */
  const chipAt = (at: { x: number; y: number }): Promise<string> =>
    page.evaluate(({ x, y }) => {
      const button = document.elementFromPoint(x, y)?.closest('button');
      return button ? `${button.textContent?.trim()} ${button.getAttribute('aria-pressed')}` : 'nichts';
    }, at);

  const spot = await centerOf('Vegan');
  expect(await chipAt(spot)).toBe('Vegan false');
  await tap(spot);
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${vegan}$`));
  await expect(countText(page)).toHaveText('0 von 4 Rezepten');
  // The chip is still under the finger, with its check mark; no chip moved and the row did not scroll.
  expect(await chipAt(spot)).toBe('Vegan true');
  await expect(chip(page, 'Vegan').locator('svg')).toHaveCount(1);
  await expect(row.getByRole('button')).toHaveText(chipNamesInServerOrder());
  expect(await row.evaluate((el) => el.scrollLeft)).toBe(scrolled);

  // A second tap on the same spot switches the same tag off again: the previous list.
  await tap(spot);
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(countText(page)).toHaveText('4 Rezepte');
  expect(await chipAt(spot)).toBe('Vegan false');
  await expect(row.getByRole('button', { pressed: true })).toHaveCount(0);

  // Two tags on, each where it is, and the row stays where it was scrolled to.
  await tap(spot);
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${vegan}$`));
  await tap(await centerOf('Suppe'));
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${vegan},${soup}$`));
  await expect(row.getByRole('button')).toHaveText(chipNamesInServerOrder());
  expect(await row.evaluate((el) => el.scrollLeft)).toBe(scrolled);

  // A third tag from the sheet (a state the row did not make): the active chips move to the front, in the
  // order they were switched on, and the row starts at its beginning again, so they are in view.
  const salat = await freshServer.api.tagIdByName('Salat');
  await filterButton(page, 2).click();
  await sheet(page).getByRole('button', { name: 'Salat 1', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${vegan},${soup},${salat}$`));
  await sheet(page).getByRole('button', { name: df.close }).click();
  await expect(sheet(page)).toBeHidden();
  const first = ['Vegan', 'Suppe', 'Salat'];
  const others = chipNamesInServerOrder().filter((name) => !first.includes(name));
  await expect(row.getByRole('button')).toHaveText([...first, ...others]);
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBe(0);
  await expect(chip(page, 'Vegan')).toBeInViewport({ ratio: 1 });

  // A reload (another state the row did not make) shows them first as well.
  await page.reload();
  await expect(chip(page, 'Vegan')).toHaveAttribute('aria-pressed', 'true');
  await expect(row.getByRole('button')).toHaveText([...first, ...others]);
  await expect(row.getByRole('button', { pressed: true })).toHaveText(first);
});

test('Filter-Sheet: Tag-Suche „sue“ findet „Süßspeise“ mit Anzahl, die Trefferzahl im Kopf folgt, kein „Anwenden“, keine M5-Filter @phone @tablet', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, [
    ['Grießbrei', ['Süßspeise']],
    ['Milchreis', ['Süßspeise', 'Schnell']],
    ['Linseneintopf', ['Suppe']],
  ]);
  const opener = filterButton(page, 0);
  await opener.click();
  const dialog = sheet(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('3 Treffer')).toBeVisible();
  await expect(dialog.getByRole('button', { name: df.close })).toBeVisible();
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const box = await dialog.boundingBox();
  if (await isWide(page)) {
    // Side panel next to the list column (artboard tabletFilter): 404 px from the left, 56 px from the top,
    // 400 px wide, no scrim.
    expect(Math.round(box?.x ?? 0)).toBe(404);
    expect(Math.round(box?.y ?? 0)).toBe(56);
    expect(Math.round(box?.width ?? 0)).toBe(400);
    const scrim = await dialog.evaluate((el) => getComputedStyle(el, '::backdrop').backgroundColor);
    expect(scrim).toBe('rgba(0, 0, 0, 0)');
    await expect(page.getByRole('region', { name: 'Rezepte', exact: true })).toBeVisible();
  } else {
    // Phone: full height, 32 px below the top.
    expect(Math.round(box?.y ?? 0)).toBe(32);
    expect(Math.round(box?.width ?? 0)).toBe(viewport.width);
  }

  const search = dialog.getByRole('searchbox', { name: df.tagSearch });
  await expect(search).not.toBeFocused();
  await search.fill('sue');
  const sweet = dialog.getByRole('button', { name: 'Süßspeise 2', exact: true });
  await expect(sweet).toBeVisible();
  // „sue“ is also „su“ (F-18, queryVariants): Suppe matches as well, other tags do not.
  const found = dialog.getByRole('group', { name: df.tags }).getByRole('button');
  await expect(found).toHaveText([/Süßspeise 2/, /Suppe 1/]);
  await search.fill('xyz');
  await expect(dialog.getByText(df.tagNone)).toBeVisible();
  await search.fill('sue');
  await sweet.click();
  await expect(sweet).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('2 Treffer')).toBeVisible();
  await expect(page).toHaveURL(/tags=\d+$/);

  // M4 has no „Anwenden“ and none of the M5 controls.
  for (const name of [
    /Anwenden/,
    /Nur Favoriten/,
    /Mindestbewertung/,
    /Beste Bewertung/,
    /Meine Bewertung/,
    /Zuletzt geändert/,
  ]) {
    await expect(dialog.getByText(name)).toHaveCount(0);
  }
  await expect(dialog.getByRole('switch')).toHaveCount(0);

  if (await isWide(page)) {
    // A click outside closes the panel (no scrim to tap).
    await page.mouse.click(viewport.width - 40, viewport.height - 40);
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(dialog).toBeHidden();
  await expect(chip(page, 'Süßspeise')).toHaveAttribute('aria-pressed', 'true');
});

test('NF-11: „Alle Tags …“ öffnet das Filter-Sheet mit dem Fokus auf „Tags“, ohne Bildschirmtastatur; Tab führt in die Tag-Suche @phone @tablet @desktop', async ({
  page,
  freshServer,
  hasTouch,
}) => {
  await freshList(page, freshServer, MENU);
  const all = chip(page, ds.list.allTags);
  const dialog = sheet(page);
  const heading = dialog.getByText(df.tags, { exact: true });
  const search = dialog.getByRole('searchbox', { name: df.tagSearch });
  if (hasTouch) await all.tap();
  else await all.click();
  await expect(dialog).toBeVisible();
  await expect(heading).toBeFocused();
  // Not the tag search (its on-screen keyboard would cover the tags), not „Filter schließen“.
  await expect(search).not.toBeFocused();
  await expect(dialog.getByRole('button', { name: df.close })).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // From the keyboard: the focus is visible on „Tags“, and Tab leads into the tag search.
  await all.focus();
  await page.keyboard.press('Enter');
  await expect(heading).toBeFocused();
  expect(await heading.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(all).toBeFocused();
});

test('Filter-Sheet am iPad hochkant: Sheet mit Inhaltshöhe; Drehen nach quer und zurück behält Filter und Sheet @tablet', async ({
  page,
  freshServer,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await freshList(page, freshServer, MENU);
  const veg = await freshServer.api.tagIdByName('Vegetarisch');
  await chip(page, 'Vegetarisch').click();
  await expect(page).toHaveURL(new RegExp(`tags=${veg}$`));
  await filterButton(page, 1).click();
  const dialog = sheet(page);
  await expect(dialog).toBeVisible();
  let box = await dialog.boundingBox();
  // Centered bottom sheet, 560 px wide, as high as its content.
  expect(Math.round(box?.width ?? 0)).toBe(560);
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(1024);
  expect(box?.y ?? 0).toBeGreaterThan(100);
  await dialog.getByRole('radio', { name: df.modes.any }).click();
  await expect(page).toHaveURL(new RegExp(`tags=${veg}&tagMode=any$`));

  // Landscape: the side panel with the same state.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => Math.round((await dialog.boundingBox())?.x ?? 0)).toBe(404);
  await expect(dialog.getByRole('radio', { name: df.modes.any })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('button', { name: 'Vegetarisch 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page).toHaveURL(new RegExp(`tags=${veg}&tagMode=any$`));
  await expect(page.getByRole('region', { name: 'Rezepte', exact: true })).toBeVisible();

  // Portrait again: the bottom sheet.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => Math.round((await dialog.boundingBox())?.width ?? 0)).toBe(560);
  box = await dialog.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(1024);
  await expect(page).toHaveURL(new RegExp(`tags=${veg}&tagMode=any$`));

  // Back still closes the sheet first, and the filters stay.
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${veg}&tagMode=any$`));
  await expect(chip(page, 'Vegetarisch')).toHaveAttribute('aria-pressed', 'true');
});

// --- F-20: start tags

test('F-20: nach der Neuinstallation bietet die Chip-Reihe die 10 Start-Tags und „Alle Tags …“ über „Noch keine Rezepte“ @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const profile = await freshServer.api.createProfile('Neu');
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte`);
  const empty = page.getByRole('heading', { name: ds.list.emptyTitle });
  await expect(empty).toBeVisible();
  await expect(chipRow(page).getByRole('button')).toHaveCount(START_TAGS_BY_NAME.length + 1);
  const names = (await chipRow(page).getByRole('button').allTextContents()).map((t) => t.trim());
  expect(names).toEqual([...START_TAGS_BY_NAME, ds.list.allTags]);
  const rowBox = await chipRow(page).boundingBox();
  const emptyBox = await empty.boundingBox();
  expect((rowBox?.y ?? 0) + (rowBox?.height ?? 0)).toBeLessThanOrEqual(emptyBox?.y ?? 0);
  await expect(searchBox(page)).toBeVisible();

  // „Alle Tags …“ opens the sheet with all of them and their counts.
  await chip(page, ds.list.allTags).click();
  await expect(sheet(page).getByRole('button', { name: 'Vegetarisch 0', exact: true })).toBeVisible();
  await expect(sheet(page).getByRole('group', { name: df.tags }).getByRole('button')).toHaveCount(10);
});

// --- F-26: sorting

test('F-26: Titel A–Z sortiert Zucchini, Öl, Birne, Äpfel, Apfelkuchen, Ananas zu Ananas, Äpfel, Apfelkuchen, Birne, Öl, Zucchini @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const fruit = ['Zucchini', 'Öl', 'Birne', 'Äpfel', 'Apfelkuchen', 'Ananas'].map(
    (title) => [title, ['Sortiertest']] as const,
  );
  await freshList(page, freshServer, [...fruit, ['Anderes', ['Sonstiges']] as const]);
  const tag = await freshServer.api.tagIdByName('Sortiertest');
  await page.goto(`${freshServer.url}/rezepte?tags=${tag}`);
  await expect(countText(page)).toHaveText('6 von 7 Rezepten');
  // Newest first by default (F-26 AK2).
  await expect(sortButton(page)).toHaveAccessibleName('Sortierung: Neueste');
  await expect
    .poll(() => titles(page))
    .toEqual(['Ananas', 'Apfelkuchen', 'Äpfel', 'Birne', 'Öl', 'Zucchini']);

  await sortButton(page).click();
  const options = sheet(page).getByRole('radiogroup', { name: df.sort });
  await expect(options.getByRole('radio')).toHaveText(['Neueste', 'Titel A–Z']);
  await options.getByRole('radio', { name: 'Titel A–Z' }).click();
  await expect(page).toHaveURL(new RegExp(`tags=${tag}&sort=title$`));
  await sheet(page).getByRole('button', { name: df.close }).click();
  await expect(sortButton(page)).toHaveAccessibleName('Sortierung: Titel A–Z');
  await expect
    .poll(() => titles(page))
    .toEqual(['Ananas', 'Äpfel', 'Apfelkuchen', 'Birne', 'Öl', 'Zucchini']);
});

test('F-26: mit Suchbegriff ist „Relevanz“ vorausgewählt, ohne „Neueste“; die Radiogruppe geht mit Pfeiltasten und Escape @desktop', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, MENU);
  await sortButton(page).click();
  let options = sheet(page).getByRole('radiogroup', { name: df.sort });
  // Opened from the sort button: the checked option has the focus.
  const newest = options.getByRole('radio', { name: 'Neueste' });
  await expect(newest).toHaveAttribute('aria-checked', 'true');
  await expect(newest).toBeFocused();
  await expect(options.getByRole('radio', { name: 'Relevanz' })).toHaveCount(0);

  await page.keyboard.press('ArrowRight');
  const title = options.getByRole('radio', { name: 'Titel A–Z' });
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute('aria-checked', 'true');
  await expect(newest).toHaveAttribute('tabindex', '-1');
  await expect(page).toHaveURL(/\?sort=title$/);
  await page.keyboard.press('ArrowRight');
  await expect(newest).toBeFocused();
  await expect(newest).toHaveAttribute('aria-checked', 'true');
  await expect(page).toHaveURL(/\/rezepte$/);
  await page.keyboard.press('End');
  await expect(title).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(newest).toHaveAttribute('aria-checked', 'true');

  // Escape closes the sheet; the focus goes back to the sort button (NF-11).
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await expect(sortButton(page)).toBeFocused();

  // With a search term „Relevanz“ is the default, and a choice.
  await searchBox(page).fill('curry');
  await expect(sortButton(page)).toHaveAccessibleName('Sortierung: Relevanz');
  await sortButton(page).click();
  options = sheet(page).getByRole('radiogroup', { name: df.sort });
  await expect(options.getByRole('radio')).toHaveText(['Relevanz', 'Neueste', 'Titel A–Z']);
  await expect(options.getByRole('radio', { name: 'Relevanz' })).toHaveAttribute('aria-checked', 'true');
  await expect(options.getByRole('radio', { name: 'Relevanz' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page).toHaveURL(/\?q=curry&sort=newest$/);

  // „Filter zurücksetzen“ in the open sheet takes „Relevanz“ away with the search term; the arrow keys still
  // move the focus together with the check (NF-11).
  await sheet(page).getByRole('button', { name: df.reset }).click();
  await expect(options.getByRole('radio')).toHaveText(['Neueste', 'Titel A–Z']);
  await options.getByRole('radio', { name: 'Neueste' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(options.getByRole('radio', { name: 'Titel A–Z' })).toHaveAttribute('aria-checked', 'true');
  await expect(options.getByRole('radio', { name: 'Titel A–Z' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(options.getByRole('radio', { name: 'Neueste' })).toHaveAttribute('aria-checked', 'true');
  await expect(options.getByRole('radio', { name: 'Neueste' })).toBeFocused();
});

test('F-26/F-34: Titel A–Z bleibt beim Nachladen (45 Rezepte) und nach dem Neuladen @desktop', async ({
  page,
  freshServer,
}) => {
  const profile = await freshServer.api.createProfile('Sortierer');
  // Created in an order that differs from A–Z and from newest first.
  const numbers = Array.from({ length: 45 }, (_, i) => ((i * 17) % 45) + 1);
  for (const n of numbers) {
    await freshServer.api.createRecipe(profile.id, {
      title: `Sortrezept ${String(n).padStart(2, '0')}`,
      tags: ['Seiten'],
    });
  }
  const tag = await freshServer.api.tagIdByName('Seiten');
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte?tags=${tag}&sort=title`);
  const expected = Array.from({ length: 45 }, (_, i) => `Sortrezept ${String(i + 1).padStart(2, '0')}`);
  await expect.poll(() => titles(page)).toEqual(expected.slice(0, 40));
  await page.getByRole('link', { name: 'Sortrezept 40', exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(() => titles(page)).toEqual(expected);

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`tags=${tag}&sort=title$`));
  await expect(sortButton(page)).toHaveAccessibleName('Sortierung: Titel A–Z');
  // The router puts the list back where it stood, so the second page may load again.
  await expect.poll(async () => (await titles(page)).length).toBeGreaterThanOrEqual(40);
  const shown = await titles(page);
  expect(shown).toEqual(expected.slice(0, shown.length));
});

// --- F-29: tags in the detail

test('F-29: ein Tag im Rezept öffnet die Liste mit diesem Tag als Filter @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, [
    ['Grillgemüse', ['Grillen']],
    ['Steak', ['Grillen']],
    ['Porridge', ['Frühstück']],
  ]);
  const grill = await freshServer.api.tagIdByName('Grillen');
  await page.getByRole('main').getByRole('link', { name: 'Steak', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Steak' })).toBeVisible();
  await page.getByRole('list', { name: 'Tags' }).getByRole('link', { name: 'Grillen' }).click();

  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${grill}$`));
  await expect(chip(page, 'Grillen')).toHaveAttribute('aria-pressed', 'true');
  await expect(countText(page)).toHaveText('2 von 3 Rezepten');
  await expect.poll(async () => (await titles(page)).sort()).toEqual(['Grillgemüse', 'Steak']);
  if (await isWide(page)) {
    // The list column is filtered; the detail column waits for a choice.
    await expect(page.getByRole('heading', { name: de.detailPane.title })).toBeVisible();
  }
});

test('F-29: ein gerade im Editor gespeicherter neuer Tag filtert die Liste beim Antippen im Rezept @phone @desktop', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, [
    ['Ofenkartoffeln', ['Beilage']],
    ['Bratkartoffeln', ['Beilage']],
  ]);
  await page.getByRole('main').getByRole('link', { name: 'Ofenkartoffeln', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ofenkartoffeln' })).toBeVisible();
  await page.getByRole('link', { name: de.common.edit }).filter({ visible: true }).first().click();
  const field = page.getByRole('combobox', { name: deEditor.tags.label });
  await field.fill('Blechgericht');
  await field.press('Enter');
  await page.getByRole('button', { name: deEditor.save }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ofenkartoffeln' })).toBeVisible();
  const tagLink = page.getByRole('list', { name: 'Tags' }).getByRole('link', { name: 'Blechgericht' });
  await expect(tagLink).toBeVisible();
  await tagLink.click();

  const id = await freshServer.api.tagIdByName('Blechgericht');
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${id}$`));
  await expect(chip(page, 'Blechgericht')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => titles(page)).toEqual(['Ofenkartoffeln']);
  // The tag list catches up; the filter stays (it is not dropped as unknown).
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${id}$`));
  await expect(countText(page)).toHaveText('1 von 2 Rezepten');
});

test('F-34: ein Link mit einem gelöschten Tag filtert nach den übrigen @desktop', async ({
  page,
  freshServer,
}) => {
  const profileId = await freshList(page, freshServer, MENU);
  const veg = await freshServer.api.tagIdByName('Vegetarisch');
  const gone = await freshServer.api.createTag(profileId, 'Verworfen');
  await freshServer.api.deleteTag(profileId, gone.id);
  await page.goto(`${freshServer.url}/rezepte?tags=${gone.id},${veg}`);
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${veg}$`));
  await expect(chip(page, 'Vegetarisch')).toHaveAttribute('aria-pressed', 'true');
  await expect(countText(page)).toHaveText('2 von 4 Rezepten');
});

// --- F-33, NF-09: failures while the filter changes

test('F-33: scheitert das Laden eines neuen Filters, landet die alte Liste nicht unter diesem Filter, auch nach dem Nachladen @desktop', async ({
  page,
  freshServer,
}) => {
  const profile = await freshServer.api.createProfile('Fehler');
  for (let n = 1; n <= 45; n++) {
    await freshServer.api.createRecipe(profile.id, {
      title: `Fehlerrezept ${String(n).padStart(2, '0')}`,
      tags: n <= 5 ? ['Tee'] : [],
    });
  }
  const tea = await freshServer.api.tagIdByName('Tee');
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte`);
  await expect(countText(page)).toHaveText('45 Rezepte');

  // The filter's request fails; the unfiltered list stays and pages on (second page of 40 + 5).
  await page.route(
    (url) => url.pathname === '/api/v1/recipes' && url.searchParams.get('tags') === String(tea),
    (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Filter gerade kaputt' } }),
      }),
  );
  const failed = page.waitForResponse((res) => new URL(res.url()).searchParams.get('tags') === String(tea));
  await chip(page, 'Tee').click();
  await failed;
  // The error toast; the list stays (F-33).
  await expect(page.getByText('Filter gerade kaputt', { exact: true })).toBeVisible();
  await expect(countText(page)).toHaveText('45 Rezepte');
  await page.locator('.list-pane').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.getByRole('main').getByRole('list').first().getByRole('listitem')).toHaveCount(45);
  await page.unrouteAll();

  // Off and on again: the filter loads for real instead of showing the unfiltered pages kept under it.
  await chip(page, 'Tee').click();
  await expect(countText(page)).toHaveText('45 Rezepte');
  await chip(page, 'Tee').click();
  await expect(countText(page)).toHaveText('5 von 45 Rezepten');
  await expect.poll(async () => (await titles(page)).length).toBe(5);
});

test('NF-09: ist der Server beim Öffnen des Filter-Sheets weg, bleibt der Filter bedienbar; nach der Wiederverbindung öffnet er sich @phone @desktop', async ({
  page,
  freshServer,
  browserName,
}) => {
  await freshList(page, freshServer, MENU);
  await freshServer.stop();
  const button = filterButton(page, 0);
  await button.click();
  const banner = page.getByRole('alert').filter({ hasText: de.connection.offline });
  await expect(banner).toBeVisible();
  // Nothing half open, and no uncaught error (fixtures.ts): the button claims no sheet.
  await expect(sheet(page)).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  await freshServer.restart();
  // Chromium keeps the failed chunk for the page, so the reconnection reloads the list (lib/chunk-retry.ts).
  const reloaded = page.waitForEvent('load');
  await banner.getByRole('button', { name: de.common.retry }).click();
  await reloaded;
  await expect(countText(page)).toHaveText('4 Rezepte');
  await expect(banner).toHaveCount(0);
  if (browserName === 'webkit') {
    // Playwright's WebKit loads a chunk that failed once not even after a reload (route chunks too);
    // reported to C1. The part above (no stuck button, no error) holds there as well.
    test.info().annotations.push({ type: 'WebKit', description: 'Öffnen nach dem Neuladen nicht geprüft' });
    return;
  }
  await button.click();
  await expect(sheet(page)).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
});

test('F-34: kommt das Filter-Sheet erst nach dem Wechsel zu einem Rezept an, bleibt es zu, auch nach Zurück @phone', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, MENU);
  // A slow WLAN: the sheet's chunk arrives only after the next tap.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/FilterSheet-[\w-]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await filterButton(page, 0).click();
  await page.getByRole('main').getByRole('link', { name: 'Gulasch', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Gulasch' })).toBeVisible();
  const loaded = page.waitForResponse((res) => /\/assets\/FilterSheet-/.test(res.url()));
  release();
  await loaded;
  await page.waitForTimeout(300);
  await expect(sheet(page)).toHaveCount(0);

  await page.goBack();
  await expect(countText(page)).toHaveText('4 Rezepte');
  await page.waitForTimeout(300);
  await expect(sheet(page)).toHaveCount(0);
  await expect(filterButton(page, 0)).toHaveAttribute('aria-expanded', 'false');
  // The next tap opens it at once.
  await filterButton(page, 0).click();
  await expect(sheet(page)).toBeVisible();
});

// --- F-34: the list state in the URL

/** A second device: its own browser context with the same viewport. */
async function otherDevice(browser: Browser, page: Page, profileId: number): Promise<Page> {
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  const other = await context.newPage();
  await useProfile(other, profileId);
  return other;
}

test('F-34: zwei Filter setzen und neu laden → beide aktiv; ein kopierter Link zeigt auf einem anderen Gerät dieselbe Liste @phone @tablet @desktop', async ({
  page,
  freshServer,
  browser,
}) => {
  const profileId = await freshList(page, freshServer, [
    ['Gemüsecurry', ['Vegetarisch', 'Schnell']],
    ['Kichererbsencurry', ['Vegetarisch']],
    ['Hähnchencurry', ['Schnell']],
    ['Linsensalat', ['Vegetarisch']],
  ]);
  await chip(page, 'Vegetarisch').click();
  await searchBox(page).fill('curry');
  await expect(page).toHaveURL(/\?q=curry&tags=\d+$/);
  await expect.poll(async () => (await titles(page)).sort()).toEqual(['Gemüsecurry', 'Kichererbsencurry']);
  const link = page.url();

  await page.reload();
  await expect(searchBox(page)).toHaveValue('curry');
  await expect(chip(page, 'Vegetarisch')).toHaveAttribute('aria-pressed', 'true');
  await expect(filterButton(page, 1)).toBeVisible();
  await expect.poll(async () => (await titles(page)).sort()).toEqual(['Gemüsecurry', 'Kichererbsencurry']);

  const other = await otherDevice(browser, page, profileId);
  await other.goto(link);
  await expect(other.getByRole('searchbox', { name: ds.list.search })).toHaveValue('curry');
  await expect(
    other
      .getByRole('group', { name: ds.list.chips })
      .getByRole('button', { name: 'Vegetarisch', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await titles(other)).sort()).toEqual(['Gemüsecurry', 'Kichererbsencurry']);
  await expect(other.locator('main p.count')).toHaveText('2 von 4 Rezepten');
  await other.context().close();
});

/** How far the list is scrolled: the page below 1024 px, the list column from 1024 px. */
function listScrolled(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(window.scrollY, document.querySelector('.list-pane')?.scrollTop ?? 0));
}

async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('nicht sichtbar');
  return box.y;
}

/** Bottom edge of the sticky search row. */
async function searchRowBottom(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('.search-row')?.getBoundingClientRect().bottom ?? -1);
}

async function scrollToThirtyAndBack(page: Page, server: AppServer): Promise<void> {
  const profile = await server.api.createProfile('Scroll');
  for (let n = 1; n <= 45; n++) {
    await server.api.createRecipe(profile.id, {
      title: `Filterrezept ${String(n).padStart(2, '0')}`,
      tags: ['Blättern'],
    });
  }
  for (let n = 1; n <= 5; n++) await server.api.createRecipe(profile.id, { title: `Anderes ${n}` });
  const tag = await server.api.tagIdByName('Blättern');
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await expect(countText(page)).toHaveText('50 Rezepte');
  await chip(page, 'Blättern').click();
  await expect(countText(page)).toHaveText('45 von 50 Rezepten');
  const listUrl = page.url();
  expect(new URL(listUrl).search).toBe(`?tags=${tag}`);

  const target = page.getByRole('main').getByRole('link', { name: 'Filterrezept 30', exact: true });
  const card = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: 'Filterrezept 30', exact: true }) });
  // Scrolled to the middle of the screen, as a person would look at it.
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(target).toBeInViewport();
  expect(await topOf(card)).toBeGreaterThanOrEqual(await searchRowBottom(page));
  const y = await topOf(target);
  const scrolled = await listScrolled(page);
  expect(scrolled, 'die Liste ist gescrollt').toBeGreaterThan((await isWide(page)) ? 500 : 1_500);
  await target.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Filterrezept 30' })).toBeVisible();
  // Amendment 19: only the two panes put the list filter into the detail URL.
  if (await isWide(page)) expect(new URL(page.url()).search).toBe(`?tags=${tag}`);
  else expect(new URL(page.url()).search).toBe('');

  await page.goBack();
  await expect(page).toHaveURL(listUrl);
  await expect(chip(page, 'Blättern')).toHaveAttribute('aria-pressed', 'true');
  await expect(countText(page)).toHaveText('45 von 50 Rezepten');
  await expect(target).toBeInViewport();
  await expect.poll(async () => Math.abs((await topOf(target)) - y)).toBeLessThanOrEqual(2);
  // In view means below the sticky search row, not behind it.
  expect(await topOf(card)).toBeGreaterThanOrEqual(await searchRowBottom(page));
}

test('F-34: gefiltert bis Rezept 30 scrollen, öffnen, Zurück → Rezept 30 ist wieder im Sichtbereich, die Filter sind unverändert @phone @tablet', async ({
  page,
  freshServer,
}) => {
  await scrollToThirtyAndBack(page, freshServer);
});

test('F-34: iPad hochkant: gefiltert bis Rezept 30, öffnen (Adresse ohne Filter), Zurück → Position und Filter bleiben @tablet', async ({
  page,
  freshServer,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await scrollToThirtyAndBack(page, freshServer);
});

test('F-34: Zurück schließt zuerst das Filter-Sheet, die Tags bleiben in der Adresse; „Filter schließen“ hinterlässt keinen Zurück-Schritt @phone @tablet', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, MENU);
  const veg = await freshServer.api.tagIdByName('Vegetarisch');
  const quick = await freshServer.api.tagIdByName('Schnell');
  // A page before the list, so a wrong extra history step would show.
  await page.goto(`${freshServer.url}/mehr`);
  await page
    .getByRole('navigation', { name: de.nav.main })
    .getByRole('link', { name: de.nav.recipes, exact: true })
    .click();
  await expect(page).toHaveURL(/\/rezepte$/);

  await filterButton(page, 0).click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Vegetarisch 2', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${veg}$`));
  await page.goBack();
  await expect(sheet(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/rezepte\\?tags=${veg}$`));
  await expect(chip(page, 'Vegetarisch')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(chip(page, 'Vegetarisch')).toHaveAttribute('aria-pressed', 'true');
  await expect(countText(page)).toHaveText('2 von 4 Rezepten');

  await filterButton(page, 1).click();
  await sheet(page).getByRole('button', { name: 'Schnell 2', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`tags=${veg},${quick}$`));
  await sheet(page).getByRole('button', { name: df.close }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`tags=${veg},${quick}$`));
  await expect(filterButton(page, 2)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/mehr$/);
});

test('F-34: ab 1024 px behält die Auswahl eines Rezepts den Listenfilter, auch nach dem Neuladen der Rezeptadresse @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  await freshList(page, freshServer, MENU);
  const veg = await freshServer.api.tagIdByName('Vegetarisch');
  await chip(page, 'Vegetarisch').click();
  await expect(countText(page)).toHaveText('2 von 4 Rezepten');
  const list = page.getByRole('region', { name: 'Rezepte', exact: true });
  await list.getByRole('link', { name: 'Linsensalat', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/rezepte/\\d+\\?tags=${veg}$`));
  const detail = page.getByRole('region', { name: 'Rezept', exact: true });
  await expect(detail.getByRole('heading', { level: 1, name: 'Linsensalat' })).toBeVisible();
  await expect(chip(page, 'Vegetarisch')).toHaveAttribute('aria-pressed', 'true');
  await expect(countText(page)).toHaveText('2 von 4 Rezepten');
  await expect(list.getByRole('link', { name: 'Linsensalat', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // The same filter next to a recipe: the chip tapped a moment ago stays where it was (F-24, NF-07).
  await expect(chipRow(page).getByRole('button')).toHaveText(chipNamesInServerOrder());

  await page.reload();
  await expect(detail.getByRole('heading', { level: 1, name: 'Linsensalat' })).toBeVisible();
  await expect(chip(page, 'Vegetarisch')).toHaveAttribute('aria-pressed', 'true');
  await expect(countText(page)).toHaveText('2 von 4 Rezepten');
  await expect.poll(async () => (await titles(page)).sort()).toEqual(['Gemüsecurry', 'Linsensalat']);

  // A chip tap in the list column filters next to the open recipe; the tab keeps the recipe's title.
  await expect(page).toHaveTitle(`Linsensalat – ${de.appName}`);
  await chip(page, 'Salat').click();
  await expect(page).toHaveURL(new RegExp(`/rezepte/\\d+\\?tags=${veg},\\d+$`));
  await expect(detail.getByRole('heading', { level: 1, name: 'Linsensalat' })).toBeVisible();
  await expect.poll(() => titles(page)).toEqual(['Linsensalat']);
  await expect(page).toHaveTitle(`Linsensalat – ${de.appName}`);
});
