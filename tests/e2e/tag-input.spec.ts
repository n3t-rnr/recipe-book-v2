// Tag input of the editor (F-06 tags part, F-17, F-18, F-20): chips, autocomplete over the local tag list,
// „Häufig verwendet“ and the layout rules at every test width in light and dark (NF-07, NF-08, NF-13, NF-14).
// The key rules and the add logic have unit tests (tests/unit/editor-fields.test.ts, editor-form.test.ts,
// editor-markup.test.ts), the matching rule tests/unit/tag-match.test.ts, the server side of F-17
// tests/api/recipes.test.ts; this spec checks what a user sees and does in the browsers.
import type { Locator, Page } from '@playwright/test';
import { deEditor } from '../../client/src/i18n/de-editor.ts';
import { dl } from '../../client/src/i18n/de-screens-lazy.ts';
import type { RecipeDetail, RecipeResponse } from '../../shared/types.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';
import { horizontalOverflow, lowContrastTexts, tapTargets } from './helpers-layout-theme.ts';

// ---------------------------------------------------------------- helpers

let seq = 0;

/**
 * Unique per worker server: project, worker, repeat, retry and a counter. The worker's server is shared
 * with other specs, so the "t…r…n…" form must not match their names: layout-theme.spec.ts also creates
 * "Layout <project> <worker>-<n>", which "<repeat><retry>-<n>" hit with --repeat-each (worker 10, repeat 1).
 */
function unique(label: string): string {
  seq += 1;
  const info = test.info();
  return `${label} ${info.project.name} t${info.workerIndex}r${info.repeatEachIndex}${info.retry}n${seq}`;
}

function titleField(page: Page): Locator {
  return page.getByRole('textbox', { name: deEditor.title.label, exact: true });
}

function tagField(page: Page): Locator {
  return page.getByRole('combobox', { name: deEditor.tags.label, exact: true });
}

function suggestions(page: Page): Locator {
  return page.getByRole('listbox', { name: deEditor.tags.suggestions, exact: true });
}

function frequent(page: Page): Locator {
  return page.getByRole('group', { name: deEditor.tags.frequent, exact: true });
}

/** The × of a tag chip in the field; its name is the chip's tag. */
function chip(page: Page, tag: string): Locator {
  return page.getByRole('button', { name: deEditor.tags.remove(tag), exact: true });
}

/** Accessible names of the shown suggestions, in order. */
function optionNames(page: Page): Promise<string[]> {
  return suggestions(page)
    .getByRole('option')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
}

/** Waits for the GET /tags answer that the editor asks for when it opens. */
function tagsLoaded(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (res) => new URL(res.url()).pathname === '/api/v1/tags' && res.request().method() === 'GET',
  );
}

/** Opens a new recipe with the tag list loaded; the title has the focus. */
async function openEditor(page: Page, server: AppServer, profileId: number): Promise<void> {
  await useProfile(page, profileId);
  const loaded = tagsLoaded(page);
  await page.goto(`${server.url}/rezepte/neu`);
  await expect(page.getByRole('heading', { level: 1, name: deEditor.titleNew })).toBeVisible();
  await expect(titleField(page)).toBeFocused();
  await loaded;
}

/** Creates `count` recipes with this one tag, so GET /tags counts them. */
async function recipesWithTag(
  server: AppServer,
  profileId: number,
  tag: string,
  count: number,
): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      server.api.createRecipe(profileId, { title: `${tag} ${i + 1}`, tags: [tag] }),
    ),
  );
}

function isWide(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

/** The detail: its own column from 1024 px (next to the list), else the whole main area. */
function detailArea(page: Page): Locator {
  return isWide(page) ? page.getByRole('region', { name: 'Rezept', exact: true }) : page.getByRole('main');
}

async function fetchRecipe(server: AppServer, id: number): Promise<RecipeDetail> {
  const res = await server.api.request('GET', `/api/v1/recipes/${id}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as RecipeResponse).recipe;
}

/** Marks the suggestion with this accessible name by ArrowDown (nothing is marked before). */
async function markWithArrowDown(page: Page, name: string): Promise<void> {
  const target = suggestions(page).getByRole('option', { name, exact: true });
  const id = await target.getAttribute('id');
  expect(id).toBeTruthy();
  await expect(tagField(page)).not.toHaveAttribute('aria-activedescendant', /./);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowDown');
    if ((await tagField(page).getAttribute('aria-activedescendant')) === id) break;
  }
  await expect(tagField(page)).toHaveAttribute('aria-activedescendant', id ?? '');
  await expect(target).toHaveAttribute('aria-selected', 'true');
}

/** No text field has the focus, so a phone shows no on-screen keyboard. */
function textFieldFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement;
    return (
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement && el.type !== 'button') ||
      (el instanceof HTMLElement && el.isContentEditable)
    );
  });
}

// ---------------------------------------------------------------- F-06: Käsespätzle through the chip input

test('F-06: „Käsespätzle“ mit 3 Zutaten, 2 Schritten und 2 Tags (einer per Vorschlag) – das Detail zeigt alles unverändert inkl. Umlauten @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const server = freshServer;
  const profile = await server.api.createProfile('Sebastian');
  await openEditor(page, server, profile.id);
  await titleField(page).fill('Käsespätzle');

  // Tag 1: typed and added with Enter.
  const field = tagField(page);
  await field.click();
  await page.keyboard.type('Schwäbisch');
  await page.keyboard.press('Enter');
  await expect(chip(page, 'Schwäbisch')).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();

  // Tag 2: "veg" suggests the start tags Vegan and Vegetarisch (both unused, so by name); picked from the
  // list by touch on phone and tablet, with ArrowDown and Enter on the PC.
  await page.keyboard.type('veg');
  await expect(suggestions(page)).toBeVisible();
  await expect
    .poll(() => optionNames(page))
    .toEqual([deEditor.tags.option('Vegan', 0), deEditor.tags.option('Vegetarisch', 0)]);
  const vegetarisch = deEditor.tags.option('Vegetarisch', 0);
  if (test.info().project.use.hasTouch) {
    await suggestions(page).getByRole('option', { name: vegetarisch, exact: true }).tap();
  } else {
    await markWithArrowDown(page, vegetarisch);
    await page.keyboard.press('Enter');
  }
  await expect(chip(page, 'Vegetarisch')).toBeVisible();
  // The typed fragment was replaced, not added as a tag of its own; the field keeps the focus.
  await expect(chip(page, 'veg')).toHaveCount(0);
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await expect(suggestions(page)).toBeHidden();

  // Three ingredients, the last one with a note.
  const rows = [
    { amount: '500', unit: 'g', name: 'Weizenmehl', note: '' },
    { amount: '5', unit: '', name: 'Eier', note: '' },
    { amount: '200', unit: 'g', name: 'Bergkäse', note: 'gerieben' },
  ];
  for (const [i, row] of rows.entries()) {
    if (i > 0) await page.getByRole('button', { name: deEditor.ingredients.addIngredientLabel }).click();
    const group = page.getByRole('group', { name: deEditor.ingredients.row(i + 1), exact: true });
    await group.getByLabel(deEditor.ingredients.amount, { exact: true }).fill(row.amount);
    if (row.unit) await group.getByLabel(deEditor.ingredients.unit, { exact: true }).fill(row.unit);
    await group.getByLabel(deEditor.ingredients.name, { exact: true }).fill(row.name);
    if (row.note) await group.getByLabel(deEditor.ingredients.note, { exact: true }).fill(row.note);
  }

  // Two steps.
  const steps = [
    'Mehl, Eier und etwas Wasser zu einem zähen Teig schlagen.',
    'Spätzle ins kochende Salzwasser schaben und mit dem Käse schichten.',
  ];
  await page.getByRole('textbox', { name: deEditor.steps.step(1), exact: true }).fill(steps[0] ?? '');
  await page.getByRole('button', { name: deEditor.steps.addLabel }).click();
  await page.getByRole('textbox', { name: deEditor.steps.step(2), exact: true }).fill(steps[1] ?? '');

  await page.getByRole('button', { name: deEditor.save, exact: true }).click();
  await expect(page).toHaveURL(/\/rezepte\/\d+$/);
  const detail = detailArea(page);
  await expect(detail.getByRole('heading', { level: 1, name: 'Käsespätzle', exact: true })).toBeVisible();
  await expect(
    detail.getByRole('list', { name: dl.detail.tags, exact: true }).getByRole('listitem'),
  ).toHaveText(['Schwäbisch', 'Vegetarisch']);
  await expect(detail.getByRole('region', { name: dl.detail.ingredients }).getByRole('listitem')).toHaveText([
    '500 g Weizenmehl',
    '5 Eier',
    '200 g Bergkäse, gerieben',
  ]);
  await expect(
    detail.getByRole('region', { name: dl.detail.steps }).getByRole('listitem').locator('p'),
  ).toHaveText(steps);

  const id = Number(new URL(page.url()).pathname.split('/').at(-1));
  const saved = await fetchRecipe(server, id);
  expect(saved.title).toBe('Käsespätzle');
  expect(saved.tags.map((t) => t.name)).toEqual(['Schwäbisch', 'Vegetarisch']);
  expect(saved.ingredients.map((i) => [i.amount, i.unit, i.name, i.note])).toEqual([
    [500, 'g', 'Weizenmehl', ''],
    [5, '', 'Eier', ''],
    [200, 'g', 'Bergkäse', 'gerieben'],
  ]);
  expect(saved.steps.map((s) => s.text)).toEqual(steps);
  // Vegetarisch is the start tag (no second one); Schwäbisch came into existence with the save.
  const tags = await server.api.tags();
  expect(tags.filter((t) => t.name === 'Vegetarisch')).toEqual([expect.objectContaining({ count: 1 })]);
  expect(tags.filter((t) => t.name === 'Schwäbisch')).toEqual([expect.objectContaining({ count: 1 })]);
});

// ---------------------------------------------------------------- F-17: at most 20 tags

test('F-17: ein 21. Tag wird im Editor mit „Höchstens 20 Tags pro Rezept“ abgelehnt @phone', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(unique('Zwanzig'));
  await server.api.createTag(profile.id, 'Vegetarisch');
  await openEditor(page, server, profile.id);
  const field = tagField(page);
  const twenty = Array.from({ length: 20 }, (_, i) => `Etikett ${i + 1}`);
  // A comma adds everything before it (as typing "…, " would).
  await field.fill(`${twenty.join(', ')},`);
  const chips = page.getByRole('button', { name: /^Etikett \d+ entfernen$/ });
  await expect(chips).toHaveCount(20);
  await expect(field).toHaveValue('');
  // Full: no „Häufig verwendet“ and no suggestions, even for a known tag.
  await expect(frequent(page)).toBeHidden();
  await field.pressSequentially('Veg');
  await expect(suggestions(page)).toBeHidden();
  await expect(field).toHaveAttribute('aria-expanded', 'false');

  await field.press('Enter');
  const error = page.getByRole('alert').filter({ hasText: deEditor.tags.limit(20) });
  await expect(error).toBeVisible();
  await expect(error).toHaveText(deEditor.tags.limit(20));
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(chips).toHaveCount(20);
  // The refused text stays in the field.
  await expect(field).toHaveValue('Veg');
});

// ---------------------------------------------------------------- F-18: suggestions with counts

test('F-18: „veg“ schlägt „Vegetarisch (12)“ und „Vegan (3)“ vor, nach Anzahl sortiert @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const server = freshServer;
  const profile = await server.api.createProfile('Anna');
  await recipesWithTag(server, profile.id, 'Vegan', 3);
  await recipesWithTag(server, profile.id, 'Vegetarisch', 12);
  await openEditor(page, server, profile.id);

  await tagField(page).click();
  await page.keyboard.type('veg');
  await expect(suggestions(page)).toBeVisible();
  await expect(tagField(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(deEditor.tags.suggestions, { exact: true })).toBeVisible();
  await expect
    .poll(() => optionNames(page))
    .toEqual([deEditor.tags.option('Vegetarisch', 12), deEditor.tags.option('Vegan', 3)]);
  // The chips show name and count („Vegetarisch 12“); nothing is marked yet.
  const options = suggestions(page).getByRole('option');
  await expect(options).toHaveText(['Vegetarisch 12', 'Vegan 3']);
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'false');

  // A tap (phone, tablet) or a click (PC) takes the suggestion; the field keeps the focus, so blur does
  // not add the typed "veg" as a tag of its own.
  if (test.info().project.use.hasTouch) await options.nth(1).tap();
  else await options.nth(1).click();
  await expect(chip(page, 'Vegan')).toBeVisible();
  await expect(chip(page, 'veg')).toHaveCount(0);
  await expect(tagField(page)).toHaveValue('');
  await expect(tagField(page)).toBeFocused();
});

test('F-18: „su“ und „sue“ schlagen „Süßspeise“ vor; „SÜSSSPEISE“ wird zum vorhandenen „Süßspeise“ @phone', async ({
  page,
  freshServer,
}) => {
  const server = freshServer;
  const profile = await server.api.createProfile('Anna');
  await recipesWithTag(server, profile.id, 'Süßspeise', 1);
  await openEditor(page, server, profile.id);
  const field = tagField(page);

  for (const typed of ['su', 'sue']) {
    await field.fill('');
    await field.pressSequentially(typed);
    await expect(suggestions(page), typed).toBeVisible();
    // Süßspeise (1 recipe) before the unused start tag Suppe; 'sue' also means 'su' (queryVariants).
    await expect
      .poll(() => optionNames(page), { message: typed })
      .toEqual([deEditor.tags.option('Süßspeise', 1), deEditor.tags.option('Suppe', 0)]);
  }

  // F-17 AK2 in the editor: another spelling of the same key shows the stored name at once.
  await field.fill('');
  await field.pressSequentially('SÜSSSPEISE');
  await field.press('Enter');
  await expect(chip(page, 'Süßspeise')).toBeVisible();
  await expect(chip(page, 'SÜSSSPEISE')).toHaveCount(0);
  // Chosen tags are no longer suggested.
  await field.pressSequentially('su');
  await expect.poll(() => optionNames(page)).toEqual([deEditor.tags.option('Suppe', 0)]);
});

test('F-18: Vorschläge ohne Request je Taste in ≤ 100 ms; Enter oder Komma übernimmt den markierten Vorschlag, sonst den Text @desktop', async ({
  page,
  freshServer,
}) => {
  const server = freshServer;
  const profile = await server.api.createProfile('Sebastian');
  await recipesWithTag(server, profile.id, 'Vegetarisch', 2);
  await recipesWithTag(server, profile.id, 'Vegan', 1);
  await openEditor(page, server, profile.id);
  const field = tagField(page);
  await field.focus();

  // From the first key on, no request reaches the API (the list is local).
  const requests: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/')) requests.push(`${req.method()} ${req.url()}`);
  });

  // Time from the keydown to the painted list, measured in the page (Chromium).
  await page.evaluate(() => {
    const w = window as unknown as { __e2eListMs?: number };
    const input = document.activeElement;
    let start = 0;
    input?.addEventListener('keydown', () => (start = performance.now()), { capture: true, once: true });
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[role="listbox"]')) return;
      observer.disconnect();
      requestAnimationFrame(() => (w.__e2eListMs = performance.now() - start));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await page.keyboard.type('v');
  const ms = await page.waitForFunction(() => (window as unknown as { __e2eListMs?: number }).__e2eListMs);
  expect(await ms.jsonValue(), 'ms vom Tastendruck bis zur gezeichneten Liste').toBeLessThanOrEqual(100);

  // Typing on drops a mark: the suggestion marked before is not what Enter takes afterwards.
  await page.keyboard.press('ArrowDown');
  await expect(field).toHaveAttribute('aria-activedescendant', /./);
  await page.keyboard.type('eg');
  await expect
    .poll(() => optionNames(page))
    .toEqual([deEditor.tags.option('Vegetarisch', 2), deEditor.tags.option('Vegan', 1)]);
  await expect(field).not.toHaveAttribute('aria-activedescendant', /./);
  await expect(suggestions(page).getByRole('option', { selected: true })).toHaveCount(0);

  // Nothing marked: Enter adds the typed text as a new tag.
  await page.keyboard.press('Enter');
  await expect(chip(page, 'veg')).toBeVisible();
  await expect(field).toHaveValue('');

  // ArrowDown marks the first suggestion (aria-activedescendant); Enter takes it, not "veg".
  await page.keyboard.type('veg');
  await markWithArrowDown(page, deEditor.tags.option('Vegetarisch', 2));
  await page.keyboard.press('Enter');
  await expect(chip(page, 'Vegetarisch')).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await expect(page.getByText(deEditor.tags.added('Vegetarisch'), { exact: true })).toBeAttached();

  // A comma takes the marked suggestion as well; ArrowUp from the field marks the last one.
  await page.keyboard.type('veg');
  await expect.poll(() => optionNames(page)).toEqual([deEditor.tags.option('Vegan', 1)]);
  await page.keyboard.press('ArrowUp');
  await expect(suggestions(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press(',');
  await expect(chip(page, 'Vegan')).toBeVisible();
  await expect(field).toHaveValue('');

  // Escape closes the list and keeps the text; typing opens it again.
  await page.keyboard.type('sch');
  await expect(suggestions(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(suggestions(page)).toBeHidden();
  await expect(field).toHaveAttribute('aria-expanded', 'false');
  await expect(field).toHaveValue('sch');
  await page.keyboard.press('ArrowDown');
  await expect(field).not.toHaveAttribute('aria-activedescendant', /./);
  await page.keyboard.type('n');
  await expect.poll(() => optionNames(page)).toEqual([deEditor.tags.option('Schnell', 0)]);

  expect(requests, 'API-Requests beim Tippen').toEqual([]);
});

test('F-18: Strg+Enter mit markiertem Vorschlag speichert den Vorschlag, nicht den getippten Text @desktop', async ({
  page,
  freshServer,
}) => {
  const server = freshServer;
  const profile = await server.api.createProfile('Sebastian');
  await recipesWithTag(server, profile.id, 'Vegetarisch', 2);
  await openEditor(page, server, profile.id);
  await titleField(page).fill('Gemüsecurry');
  await tagField(page).click();
  await page.keyboard.type('veg');
  await markWithArrowDown(page, deEditor.tags.option('Vegetarisch', 2));
  // Saved straight from the field: what is marked is what the recipe gets (no stray tag "veg").
  await page.keyboard.press('Control+Enter');
  await expect(page).toHaveURL(/\/rezepte\/\d+$/);
  const id = Number(new URL(page.url()).pathname.split('/').at(-1));
  expect((await fetchRecipe(server, id)).tags.map((t) => t.name)).toEqual(['Vegetarisch']);
  const tags = await server.api.tags();
  expect(tags.map((t) => t.name)).not.toContain('veg');
  expect(tags.filter((t) => t.name === 'Vegetarisch')).toEqual([expect.objectContaining({ count: 3 })]);
});

test('F-18: neue Tags entstehen erst beim Speichern; Abbrechen hinterlässt keinen Tag @desktop', async ({
  page,
  freshServer,
}) => {
  const server = freshServer;
  const profile = await server.api.createProfile('Sebastian');
  await openEditor(page, server, profile.id);
  const writes: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET' && new URL(req.url()).pathname.startsWith('/api/')) writes.push(req.url());
  });

  await tagField(page).click();
  await page.keyboard.type('Grillabend');
  await page.keyboard.press('Enter');
  await expect(chip(page, 'Grillabend')).toBeVisible();
  await page.getByRole('button', { name: deEditor.cancel, exact: true }).click();
  const discard = page.getByRole('alertdialog', { name: deEditor.discard.title });
  await discard.getByRole('button', { name: deEditor.discard.confirm, exact: true }).click();
  await expect(page).not.toHaveURL(/\/rezepte\/neu$/);
  expect(writes, 'kein Schreib-Request').toEqual([]);
  expect((await server.api.tags()).map((t) => t.name)).not.toContain('Grillabend');

  // Typed again and saved: the tag exists now, with this one recipe.
  const loaded = tagsLoaded(page);
  await page.goto(`${server.url}/rezepte/neu`);
  await expect(titleField(page)).toBeFocused();
  await loaded;
  await titleField(page).fill('Grillteller');
  await tagField(page).click();
  await page.keyboard.type('Grillabend');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: deEditor.save, exact: true }).click();
  await expect(page).toHaveURL(/\/rezepte\/\d+$/);
  expect((await server.api.tags()).filter((t) => t.name === 'Grillabend')).toEqual([
    expect.objectContaining({ count: 1 }),
  ]);
});

/**
 * Fills the title, then makes the window just tall enough for the tag field: it ends 20 px above the
 * Speichern bar, so the suggestion list opens below the fold. With a title, leaving it shows no hint that
 * would push the tag field down after the list opened (the hint waits for the pointer to be up,
 * RecipeEdit onTitleBlur). Returns where the list, the field and the bar are.
 */
async function squeezeAboveSaveBar(page: Page): Promise<() => Promise<Record<string, boolean>>> {
  await titleField(page).fill('Käsespätzle');
  const saveBar = page.getByRole('button', { name: deEditor.save, exact: true }).locator('..');
  const barHeight = await saveBar.evaluate((el) => el.getBoundingClientRect().height);
  const boxBottom = await tagField(page).evaluate(
    (el) => (el.parentElement?.getBoundingClientRect().bottom ?? 0) + window.scrollY,
  );
  await page.setViewportSize({
    width: page.viewportSize()?.width ?? 390,
    height: Math.ceil(boxBottom + 20 + barHeight),
  });
  return async () => {
    const list = await suggestions(page).boundingBox();
    const field = await tagField(page).boundingBox();
    const bar = await saveBar.boundingBox();
    return {
      listAboveBar: list !== null && bar !== null && list.y + list.height <= bar.y,
      fieldInView: field !== null && field.y >= 0,
    };
  };
}

test('Vorschläge öffnen sich über der Speichern-Leiste, auch wenn das Tag-Feld knapp darüber steht (NF-07) @phone', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(unique('Leiste'));
  await openEditor(page, server, profile.id);
  const edges = await squeezeAboveSaveBar(page);
  await tagField(page).click();
  await page.keyboard.type('veg');
  await expect(suggestions(page)).toBeVisible();

  // The page scrolls the whole list above the bar (scroll-padding-bottom); the field stays in view.
  await expect.poll(edges).toEqual({ listAboveBar: true, fieldInView: true });
});

test('Wächst die Vorschlagsliste nach einem gelöschten Buchstaben, bleibt sie über der Speichern-Leiste (NF-07) @phone', async ({
  page,
  freshServer,
}) => {
  const server = freshServer;
  const profile = await server.api.createProfile('Anna');
  // Six tags that each take a row of their own at phone width.
  const names = Array.from({ length: 6 }, (_, i) => `Grillabend im Garten ${i + 1}`);
  for (const name of names) await server.api.createTag(profile.id, name);
  await openEditor(page, server, profile.id);
  const edges = await squeezeAboveSaveBar(page);
  // The whole text at once, as an on-screen keyboard's word suggestion inserts it: the list opens with
  // one suggestion (typed letter by letter, "g" would already open it with all six).
  await tagField(page).click();
  await tagField(page).fill('grillabend im garten 1');
  await expect.poll(() => optionNames(page)).toEqual([deEditor.tags.option(names[0] ?? '', 0)]);
  await expect.poll(edges).toEqual({ listAboveBar: true, fieldInView: true });

  // One letter less: six suggestions, five rows more below the field. They scroll above the bar too, so
  // none of them hides behind it (and none is out of reach of a thumb).
  await page.keyboard.press('Backspace');
  await expect.poll(() => optionNames(page)).toEqual(names.map((name) => deEditor.tags.option(name, 0)));
  const rows = await suggestions(page)
    .getByRole('option')
    .evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
  expect(rows, 'Zeilen der Vorschlagsliste').toBeGreaterThan(1);
  await expect.poll(edges).toEqual({ listAboveBar: true, fieldInView: true });
});

test('Wenig Höhe (Handy quer): Feld und Vorschläge passen nicht zusammen über die Leiste – das Tag-Feld bleibt bei jedem Tastendruck sichtbar (NF-07) @phone', async ({
  page,
  freshServer,
}) => {
  const server = freshServer;
  const profile = await server.api.createProfile('Anna');
  const names = Array.from({ length: 6 }, (_, i) => `Grillabend im Garten ${i + 1}`);
  for (const name of names) await server.api.createTag(profile.id, name);
  await openEditor(page, server, profile.id);
  await titleField(page).fill('Käsespätzle');
  await page.setViewportSize({ width: page.viewportSize()?.width ?? 390, height: 420 });
  const saveBar = page.getByRole('button', { name: deEditor.save, exact: true }).locator('..');
  const field = tagField(page);
  await field.click();

  // Six rows of suggestions are taller than the room between the field and the bar. The field keeps its
  // place in view (not scrolled away above the top), the list starts below it and the first suggestion
  // can be seen and tapped.
  const place = async () => {
    // The whole box around the field, border included (the focus ring is on it).
    const f = await field.locator('..').boundingBox();
    const list = await suggestions(page).boundingBox();
    const first = await suggestions(page).getByRole('option').first().boundingBox();
    const bar = await saveBar.boundingBox();
    if (!f || !list || !first || !bar) return 'fehlt';
    // 1 px for scroll positions that snap to device pixels.
    if (f.y < -1 || f.y + f.height > bar.y + 1) {
      return `Feld ${f.y.toFixed(1)}–${(f.y + f.height).toFixed(1)}, Leiste ab ${bar.y.toFixed(1)}`;
    }
    if (first.y + first.height > bar.y) return `erster Vorschlag unter der Leiste (${Math.round(first.y)})`;
    return list.y > f.y ? 'ok' : 'Liste über dem Feld';
  };
  for (const [i, key] of ['g', 'r', 'i'].entries()) {
    await page.keyboard.type(key);
    await expect.poll(async () => (await optionNames(page)).length, key).toBe(6);
    if (i === 0) {
      const tall = await suggestions(page).evaluate((el) => el.getBoundingClientRect().height);
      const room = await saveBar.evaluate((el) => el.getBoundingClientRect().top);
      expect(tall, 'die Liste allein braucht mehr als die halbe Höhe über der Leiste').toBeGreaterThan(
        room / 2,
      );
    }
    await expect.poll(place, key).toBe('ok');
  }
  await expect(field).toHaveValue('gri');
});

// ---------------------------------------------------------------- F-17: punctuation in a picked tag

test('F-17: ein Tag mit Komma im Namen bleibt beim Übernehmen aus Vorschlag und „Häufig verwendet“ ein Tag @phone @desktop', async ({
  page,
  freshServer,
}) => {
  const server = freshServer;
  const profile = await server.api.createProfile('Sebastian');
  // F-17 allows punctuation, so the tag page (or another device) can create a name with a comma. Used by
  // one recipe, it leads „Häufig verwendet“.
  const name = 'Schnell, günstig';
  await server.api.createRecipe(profile.id, { title: 'Nudeln mit Pesto', tags: [name] });
  await openEditor(page, server, profile.id);
  await titleField(page).fill('Ofenkartoffeln');
  const touch = test.info().project.use.hasTouch === true;
  const field = tagField(page);

  // From the suggestions: „günst“ matches the second word.
  await field.click();
  await page.keyboard.type('günst');
  const option = deEditor.tags.option(name, 1);
  await expect.poll(() => optionNames(page)).toEqual([option]);
  if (touch) await suggestions(page).getByRole('option', { name: option, exact: true }).tap();
  else {
    await markWithArrowDown(page, option);
    await page.keyboard.press('Enter');
  }
  await expect(chip(page, name)).toBeVisible();
  await expect(chip(page, 'Schnell')).toHaveCount(0);
  await expect(chip(page, 'günstig')).toHaveCount(0);
  await expect(field).toHaveValue('');

  // From „Häufig verwendet“ after removing it again.
  await chip(page, name).click();
  await expect(chip(page, name)).toHaveCount(0);
  const add = frequent(page).getByRole('button', { name: deEditor.tags.add(name), exact: true });
  if (touch) await add.tap();
  else await add.click();
  await expect(chip(page, name)).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Schnell|günstig) entfernen$/ })).toHaveCount(0);

  await page.getByRole('button', { name: deEditor.save, exact: true }).click();
  await expect(page).toHaveURL(/\/rezepte\/\d+$/);
  const id = Number(new URL(page.url()).pathname.split('/').at(-1));
  expect((await fetchRecipe(server, id)).tags.map((t) => t.name)).toEqual([name]);
  const tags = await server.api.tags();
  expect(tags.filter((t) => t.name === name)).toEqual([expect.objectContaining({ count: 2 })]);
  // No tag „günstig“ came into existence, and the start tag „Schnell“ is still unused.
  expect(tags.map((t) => t.name)).not.toContain('günstig');
  expect(tags.filter((t) => t.name === 'Schnell')).toEqual([expect.objectContaining({ count: 0 })]);
});

// ---------------------------------------------------------------- „Häufig verwendet“ (artboard tagEditor())

test('„Häufig verwendet“: Antippen fügt den Tag hinzu, ohne die Bildschirmtastatur zu öffnen @phone', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(unique('Tippen'));
  await openEditor(page, server, profile.id);
  const group = frequent(page);
  await expect(group).toBeVisible();
  const buttons = group.getByRole('button');
  // At most 6 tags, as chips with a plus (on a new install the unused start tags).
  expect(await buttons.count()).toBeGreaterThan(0);
  expect(await buttons.count()).toBeLessThanOrEqual(6);
  const label = (await buttons.first().getAttribute('aria-label')) ?? '';
  const name = label.replace(/ hinzufügen$/, '');
  expect(label).toBe(deEditor.tags.add(name));

  await buttons.first().tap();
  await expect(chip(page, name)).toBeVisible();
  await expect(group.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  await expect(page.getByText(deEditor.tags.added(name), { exact: true })).toBeAttached();
  // No text field took the focus, so no on-screen keyboard opens.
  expect(await textFieldFocused(page), 'Textfeld fokussiert').toBe(false);
  await expect(tagField(page)).not.toBeFocused();
});

test('„Häufig verwendet“ per Tastatur: Enter auf dem Chip fügt den Tag hinzu, der Fokus geht zurück ins Tag-Feld @desktop', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(unique('Tastatur'));
  await openEditor(page, server, profile.id);
  const buttons = frequent(page).getByRole('button');
  const label = (await buttons.first().getAttribute('aria-label')) ?? '';
  const name = label.replace(/ hinzufügen$/, '');
  await tagField(page).focus();
  await page.keyboard.press('Tab');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(chip(page, name)).toBeVisible();
  // NF-11: the focus never falls back to the page when the chip leaves the row.
  await expect(tagField(page)).toBeFocused();
});

// ---------------------------------------------------------------- layout, light and dark (NF-07, NF-08, NF-13, NF-14)

const SIZES = [
  { width: 360, height: 800, tag: '@phone' },
  { width: 390, height: 844, tag: '@phone' },
  { width: 768, height: 1024, tag: '@tablet @desktop' },
  { width: 1024, height: 768, tag: '@tablet @desktop' },
  { width: 1440, height: 900, tag: '@desktop' },
] as const;

/** Readable texts, tap targets ≥ 44 × 44 px and no horizontal scrolling in the current state. */
async function expectClean(page: Page, what: string): Promise<void> {
  expect(await lowContrastTexts(page, { wholePage: true }), `${what}: Text unter dem WCAG-Kontrast`).toEqual(
    [],
  );
  const small = (await tapTargets(page)).filter((t) => t.width < 44 || t.height < 44);
  expect(small, `${what}: Tippflächen unter 44 × 44 px`).toEqual([]);
  const overflow = await horizontalOverflow(page);
  // A mobile browser zooms out to fit wider content: then the window is wider than the device.
  expect(overflow.innerWidth, `${what}: Fensterbreite (ragt heraus: ${overflow.culprits.join(', ')})`).toBe(
    page.viewportSize()?.width,
  );
  expect(
    overflow.scrollWidth,
    `${what}: scrollWidth ≤ innerWidth (ragt heraus: ${overflow.culprits.join(', ')})`,
  ).toBeLessThanOrEqual(overflow.innerWidth);
}

for (const size of SIZES) {
  test(`NF-07/08/13/14: Editor mit „Häufig verwendet“ und Vorschlägen bei ${size.width} px, hell und dunkel ${size.tag}`, async ({
    page,
    server,
  }) => {
    test.setTimeout(60_000);
    const profile = await server.api.createProfile(unique('Layout'));
    // Tags with 40 characters (F-17, capitals: the widest case) must not widen the page: their chips end
    // with "…". One is typed into the field, the other one is a known tag for the suggestions.
    const typed = 'WILDSCHWEIN-GULASCH MIT WACHOLDER & WEIN';
    const known = 'OMAS MOHNKUCHEN MIT MARZIPAN & WALNÜSSEN';
    expect([typed.length, known.length]).toEqual([40, 40]);
    await server.api.createTag(profile.id, known);
    await page.setViewportSize({ width: size.width, height: size.height });
    await openEditor(page, server, profile.id);
    await titleField(page).fill('Käsespätzle');
    const field = tagField(page);
    await field.click();
    await page.keyboard.type(`${typed}, Hauptgericht, `);
    await expect(chip(page, typed)).toBeVisible();
    await expect(chip(page, 'Hauptgericht')).toBeVisible();

    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // „Häufig verwendet“ below the field (no typed text).
      await expect(frequent(page)).toBeVisible();
      await expect(frequent(page).getByRole('button').first()).toBeVisible();
      await expectClean(page, `${scheme}, Häufig verwendet`);

      // Suggestions with counts and a marked one (focus ring); the long tag is suggested for "omas".
      await field.pressSequentially('s');
      await expect(suggestions(page)).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await expect(suggestions(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
      await expectClean(page, `${scheme}, Vorschläge`);
      await field.fill('');
      await field.pressSequentially('omas');
      await expect.poll(() => optionNames(page)).toEqual([deEditor.tags.option(known, 0)]);
      await expectClean(page, `${scheme}, langer Vorschlag`);
      await field.fill('');
      await expect(suggestions(page)).toBeHidden();
    }
  });
}
