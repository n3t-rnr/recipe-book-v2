// Layout and theme (checklist area "layout-theme").
// Covered checklist items:
//   e7 – with a dark system scheme the app starts without a light flash (NF-14): before the app runs
//        (entry module held back) index.html and the CSS alone give a dark page, and no animation frame
//        from the first one to the finished screen shows a light surface outside the approved ones, on
//        three entry points (profile choice on a new device, list, link straight to a recipe). A stored
//        choice („Hell“/„Dunkel“; the switch follows in M5) is set by the inline script before the app.
//   e9 – dark mode: profile sheet, menu sheet, dialogs („Änderungen verwerfen?“, „… endgültig
//        löschen?“), toast, placeholder image (detail and list), skeletons (list, detail, editor),
//        editor (whole page, including field values and placeholders), photo lightbox and every other
//        screen built so far are dark and readable (NF-14, NF-13). Approved light parts: Moonstone and
//        Vanilla surfaces with Raisin Black text (Kap. 6.7, A19), avatars, the inverted toast and the
//        editor's inverted step numbers. Amount and unit fields of the editor show their placeholder
//        and every suggested unit in full, also while focused.
// Also the Muss requirements that no checklist item names:
//   NF-08 – no horizontal scrolling at 360, 390, 768, 1024 and 1440 px on every screen built so far (the
//           chip row of the list scrolls on its own); the offline banner and the sticky search row never
//           overlap (M4, amendment 5).
//   NF-07 – every visible button, link and form control has a hit area ≥ 44 × 44 px (links in running
//           text excepted), kitchen actions (FAB, Speichern) ≥ 48 px, also in the filter sheet and panel.
//           Heart and stars follow in M5.
//   NF-11 – a card focused with the keyboard is always fully below the sticky search row (M4).
// M4 adds the list without hits, the filtered list (active chip) and the filter sheet to the sweeps.
// Token level coverage stays in Vitest: tests/unit/contrast.test.ts (NF-13 for every token pair in both
// modes, identical dark blocks) and tests/api/static.test.ts (the CSP carries the theme script hash).
//
// Engine notes: page.screenshot() in WebKit appends a <style> element to sync animations, which the
// app's CSP blocks, and the CSP guard of fixtures.ts would fail the test. So screenshots (pixel checks
// and the pictures for a look by hand) are taken in Chromium only; WebKit runs the DOM checks. WebKit
// also paints nothing and runs no animation frame while the entry module is pending, so there the state
// before the app is read with timer polling, and the frame recorder starts with the first real paint.
import type { Locator, Page, Route } from '@playwright/test';
import { de } from '../../client/src/i18n/de.ts';
import { deEditor } from '../../client/src/i18n/de-editor.ts';
import { ds } from '../../client/src/i18n/de-screens.ts';
import { df } from '../../client/src/i18n/de-screens-filter.ts';
import { dl } from '../../client/src/i18n/de-screens-lazy.ts';
import type { Profile, RecipeDetail } from '../../shared/types.ts';
import { smallJpeg } from '../helpers/images.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';
import {
  type ClippedText,
  COLORS,
  clippedFocused,
  clippedPlaceholders,
  clippedValues,
  contrast,
  horizontalOverflow,
  lightSurfaces,
  lowContrastTexts,
  parseRgb,
  pixelStats,
  placeholderColor,
  type Rgb,
  recordStartup,
  type Surface,
  sameColor,
  settle,
  shotPath,
  skeletonTones,
  stopStartup,
  type TapTarget,
  tapTargets,
} from './helpers-layout-theme.ts';

let counter = 0;
/** Unique names per worker server (the tests of one worker share it). */
function unique(label: string): string {
  counter += 1;
  return `${label} ${test.info().project.name} ${test.info().workerIndex}-${counter}`;
}

function isWebkit(): boolean {
  return test.info().project.use.defaultBrowserType === 'webkit';
}

/** Screenshot of the viewport for a look by hand and pixel checks; null in WebKit (engine notes above). */
async function snap(page: Page, name: string): Promise<Buffer | null> {
  if (isWebkit()) return null;
  return page.screenshot({ path: shotPath(test.info(), name), caret: 'initial' });
}

async function bodyBackground(page: Page): Promise<Rgb | null> {
  return parseRgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
}

/**
 * Light surfaces that are part of the approved design in dark mode: Moonstone and Vanilla surfaces
 * with Raisin Black text (Kap. 6.7: surface only, always with --color-ink; A19: Moonstone chips stay),
 * avatars (avatar-4 turns Linen in dark mode, tokens.css), and the editor's step numbers, inverted
 * badges with --color-text on --color-bg (artboard "Neues Rezept", generate-mockups.mjs).
 */
function approvedLight(surface: Surface): boolean {
  const color = parseRgb(surface.color);
  const text = parseRgb(surface.text);
  const accent = sameColor(color, COLORS.moonstone) || sameColor(color, COLORS.vanilla);
  if (accent) return sameColor(text, COLORS.raisin);
  if (surface.what.startsWith('span.avatar')) return true;
  // Inverted like the step numbers: the list's filter button and the checked segment of the filter
  // sheet, --color-text surface with --color-bg icon or text (generator searchRow(), segmented()).
  const inverted = /^span\.number "\d+"$|^button\.filter "Filter|^button\.option\.checked "/.test(
    surface.what,
  );
  return inverted && sameColor(color, COLORS.linen) && sameColor(text, COLORS.raisin);
}

// ---------------------------------------------------------------------------------------------------
// e7 – NF-14: the color scheme is settled before the first paint
// ---------------------------------------------------------------------------------------------------

/** Holds the entry module (the app) until the returned function is called. */
async function holdApp(page: Page): Promise<() => void> {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/index-[\w-]+\.js$/, async (route: Route) => {
    await held;
    await route.continue();
  });
  return () => release();
}

interface BeforeApp {
  body: string;
  theme: string | null;
  appChildren: number;
}

/** The page while the app is held: what index.html (inline theme script) and the stylesheets alone give. */
async function beforeApp(page: Page): Promise<BeforeApp> {
  const handle = await page.waitForFunction(
    () => {
      if (document.readyState === 'loading' || !document.body) return null;
      const sheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
      if (sheets.some((link) => link.sheet === null)) return null;
      return {
        body: getComputedStyle(document.body).backgroundColor,
        theme: document.documentElement.dataset.theme ?? null,
        appChildren: document.getElementById('app')?.childElementCount ?? -1,
      };
    },
    null,
    // Timer polling: WebKit runs no animation frame while the entry module is pending.
    { polling: 50 },
  );
  return (await handle.jsonValue()) as BeforeApp;
}

/** Chromium only (it paints while the app is held): the recorder's first frame. */
async function firstFrame(page: Page): Promise<BeforeApp> {
  const handle = await page.waitForFunction(
    () => (window as unknown as { __startup?: { first: unknown } }).__startup?.first ?? null,
  );
  return (await handle.jsonValue()) as BeforeApp;
}

/**
 * Stops the startup recorder: dark from the first frame on, and no light surface in any frame. The
 * frames are what the user sees; the DOM state when the app mounts is not checked here, because WebKit
 * may run a cached app before the stylesheets are applied and still paints nothing until they are.
 */
async function expectNoLightFrame(page: Page, where: string): Promise<void> {
  await settle(page);
  const run = await stopStartup(page);
  expect(run.frames, `${where}: aufgezeichnete Frames`).toBeGreaterThan(0);
  expect(parseRgb(run.first?.body ?? null), `${where}: Hintergrund im ersten Frame`).toEqual(COLORS.raisin);
  expect(
    run.light.filter((s) => !approvedLight(s)),
    `${where}: helle Flächen in einem Frame während des Starts`,
  ).toEqual([]);
  expect(await bodyBackground(page), `${where}: Hintergrund danach`).toEqual(COLORS.raisin);
}

async function storeTheme(page: Page, value: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((v) => {
    try {
      localStorage.setItem('theme', v);
    } catch {
      // storage blocked: nothing to remember
    }
  }, value);
}

test.describe('dunkles Systemschema', () => {
  test.use({ colorScheme: 'dark' });

  test('e7: die App startet ohne hellen Blitz – dunkel schon vor dem Start der App und in jedem Frame bis zur fertigen Ansicht @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const profile = await server.api.createProfile(unique('Nacht'), 'avatar-4');
    const recipe = await server.api.createRecipe(profile.id, {
      title: unique('Nachtisch'),
      prepMinutes: 10,
      cookMinutes: 20,
      tags: ['Süß'],
      ingredients: [{ amount: 200, unit: 'g', name: 'Quark' }],
      steps: [{ text: 'Verrühren.' }],
    });
    await recordStartup(page);

    // 1. First start on a new device (no profile yet): the app shows the profile choice. The app is held
    // back, so what the page shows now comes from index.html and the render-blocking CSS alone.
    const release = await holdApp(page);
    await page.goto(`${server.url}/`, { waitUntil: 'commit' });
    const held = await beforeApp(page);
    expect(held.appChildren, 'die App läuft noch nicht').toBe(0);
    expect(parseRgb(held.body), `Hintergrund vor dem Start der App: ${held.body}`).toEqual(COLORS.raisin);
    if (!isWebkit()) {
      // Chromium paints while the app loads: the first frame, and a picture of it, are dark.
      const first = await firstFrame(page);
      expect(first.appChildren, 'die App läuft beim ersten Frame noch nicht').toBe(0);
      expect(parseRgb(first.body), `Hintergrund im ersten Frame: ${first.body}`).toEqual(COLORS.raisin);
      const shot = await snap(page, 'e7-vor-dem-start');
      expect(shot).not.toBeNull();
      if (shot)
        expect((await pixelStats(shot)).share(COLORS.raisin), 'Anteil Raisin Black').toBeGreaterThan(0.99);
    }
    // The browser chrome (address bar, iOS status bar) gets the dark theme color, too.
    await expect(
      page.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]'),
    ).toHaveAttribute('content', '#231F20');
    release();
    await expect(page.getByRole('heading', { level: 1, name: de.titles.profile })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(profile.name) })).toBeVisible();
    await expectNoLightFrame(page, 'Profilwahl');

    // 2. Start with a remembered profile (list) and 3. a link straight to a recipe (lazy detail chunk).
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte`, { waitUntil: 'commit' });
    await expect(page.getByRole('link', { name: recipe.title }).first()).toBeVisible();
    await expectNoLightFrame(page, 'Rezeptliste');
    await page.goto(`${server.url}/rezepte/${recipe.id}`, { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();
    await expect(page.getByText('Quark')).toBeVisible();
    await expectNoLightFrame(page, 'Rezeptdetail');
  });

  test('e7: eine gespeicherte Wahl „Hell“ gilt schon vor dem Start der App – gegen das dunkle System @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const profile = await server.api.createProfile(unique('Tag'));
    await useProfile(page, profile.id);
    await storeTheme(page, 'light');
    await recordStartup(page);
    const release = await holdApp(page);
    await page.goto(`${server.url}/rezepte`, { waitUntil: 'commit' });

    const held = await beforeApp(page);
    expect(held.appChildren, 'die App läuft noch nicht').toBe(0);
    expect(held.theme, 'data-theme aus dem Inline-Skript in index.html').toBe('light');
    expect(parseRgb(held.body), `Hintergrund vor dem Start der App: ${held.body}`).toEqual(COLORS.linen);
    release();
    await expect(page.getByRole('heading', { level: 1, name: de.titles.recipes })).toBeVisible();
    await settle(page);
    const run = await stopStartup(page);
    expect(run.first?.theme, 'erster Frame').toBe('light');
    expect(parseRgb(run.first?.body ?? null), 'Hintergrund im ersten Frame').toEqual(COLORS.linen);
    expect(parseRgb(run.mount?.body ?? null), 'Hintergrund beim ersten Rendern').toEqual(COLORS.linen);
    expect(await bodyBackground(page)).toEqual(COLORS.linen);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: de.titles.recipes })).toBeVisible();
    expect(await bodyBackground(page), 'nach dem Neuladen').toEqual(COLORS.linen);
  });
});

test.describe('helles Systemschema', () => {
  test.use({ colorScheme: 'light' });

  test('e7: eine gespeicherte Wahl „Dunkel“ gilt schon vor dem Start der App – gegen das helle System @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const profile = await server.api.createProfile(unique('Eule'));
    await useProfile(page, profile.id);
    await storeTheme(page, 'dark');
    await recordStartup(page);
    const release = await holdApp(page);
    await page.goto(`${server.url}/rezepte`, { waitUntil: 'commit' });

    const held = await beforeApp(page);
    expect(held.appChildren, 'die App läuft noch nicht').toBe(0);
    expect(held.theme, 'data-theme aus dem Inline-Skript in index.html').toBe('dark');
    expect(parseRgb(held.body), `Hintergrund vor dem Start der App: ${held.body}`).toEqual(COLORS.raisin);
    release();
    await expect(page.getByRole('heading', { level: 1, name: de.titles.recipes })).toBeVisible();
    await expectNoLightFrame(page, 'Rezeptliste mit gespeicherter Wahl „Dunkel“');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: de.titles.recipes })).toBeVisible();
    expect(await bodyBackground(page), 'nach dem Neuladen').toEqual(COLORS.raisin);
  });
});

// ---------------------------------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------------------------------

interface Seed {
  profile: Profile;
  recipe: RecipeDetail;
  trashed: RecipeDetail;
  /** Id of the recipe's tag „Schwäbisch“ (filtered list, M4). */
  tagId: number;
}

/** A profile, a full recipe without photo and a recipe in the trash, all with unique names. */
async function seed(server: AppServer): Promise<Seed> {
  const profile = await server.api.createProfile(unique('Layout'), 'avatar-1');
  const recipe = await server.api.createRecipe(profile.id, {
    title: unique('Linsensuppe mit Spätzle und Saitenwürstchen'),
    description: 'Deftig, wärmend und schnell gemacht – das Lieblingsessen an kalten Tagen.',
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 45,
    source: 'Omas Kochbuch, S. 12',
    tags: ['Schwäbisch', 'Eintopf', 'Winter', 'Schnell'],
    ingredients: [
      { group: 'Suppe', amount: 250, unit: 'g', name: 'Tellerlinsen', note: 'über Nacht eingeweicht' },
      { group: 'Suppe', amount: 1, unit: 'Bund', name: 'Suppengrün', note: '' },
      { group: 'Suppe', amount: 2, unit: 'EL', name: 'Rotweinessig', note: '' },
      { group: 'Dazu', amount: 4, unit: 'Stück', name: 'Saitenwürstchen', note: '' },
    ],
    steps: [
      { text: 'Linsen abgießen und mit dem geputzten Suppengrün in 1,5 l Wasser aufsetzen.' },
      { text: 'Etwa 40 Minuten köcheln lassen, mit Essig, Salz und Pfeffer abschmecken.' },
      { text: 'Würstchen in der Suppe erwärmen und mit Spätzle servieren.' },
    ],
  });
  const trashed = await server.api.createRecipe(profile.id, { title: unique('Alter Auflauf') });
  const res = await server.api.request('DELETE', `/api/v1/recipes/${trashed.id}`, { profileId: profile.id });
  expect(res.status, 'Rezept in den Papierkorb legen').toBeLessThan(300);
  const tagId = await server.api.tagIdByName('Schwäbisch');
  return { profile, recipe, trashed, tagId };
}

// ---------------------------------------------------------------------------------------------------
// e9 – dark mode: every surface is dark and readable
// ---------------------------------------------------------------------------------------------------

/**
 * Fails on every light surface outside the approved ones and on every text (including field values and
 * placeholders) below the WCAG minimum, on the whole page, not only the part in the viewport.
 */
async function expectDarkAndReadable(
  page: Page,
  name: string,
  extraAllowed: (surface: Surface) => boolean = () => false,
): Promise<void> {
  await settle(page);
  const light = (await lightSurfaces(page, { wholePage: true })).filter(
    (s) => !approvedLight(s) && !extraAllowed(s),
  );
  expect(light, `${name}: helle Flächen im Dark Mode`).toEqual([]);
  expect(await lowContrastTexts(page, { wholePage: true }), `${name}: Text unter dem WCAG-Kontrast`).toEqual(
    [],
  );
  await snap(page, name);
}

/** Background of an element (sheet or dialog panel). */
async function background(locator: Locator): Promise<Rgb | null> {
  return parseRgb(await locator.evaluate((el) => getComputedStyle(el).backgroundColor));
}

/** Surface of a placeholder image and fill of its plate (the first circle of the plate illustration). */
async function placeholderLook(
  art: Locator,
): Promise<{ surface: Rgb | null; plate: Rgb | null; opacity: string }> {
  const look = await art.evaluate((el) => {
    const plate = el.querySelector('svg circle');
    return {
      surface: getComputedStyle(el.parentElement ?? el).backgroundColor,
      plate: plate ? getComputedStyle(plate).fill : '',
      opacity: plate ? getComputedStyle(plate).fillOpacity : '',
    };
  });
  return { surface: parseRgb(look.surface), plate: parseRgb(look.plate), opacity: look.opacity };
}

test.describe('Dark Mode', () => {
  test.use({ colorScheme: 'dark' });

  test('e9: das Profil-Sheet ist dunkel und gut lesbar @phone @tablet @desktop', async ({ page, server }) => {
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    await page.goto(`${server.url}/rezepte`);
    await page.getByRole('button', { name: de.profile.switchLabel(data.profile.name) }).click();
    const sheet = page.getByRole('dialog', { name: de.profile.switchTitle });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: new RegExp(data.profile.name) })).toBeVisible();
    await expect(sheet.getByText(de.profile.hint)).toBeVisible();
    // Sheets use the raised dark surface (Kap. 6.7).
    expect(await background(sheet.locator(':scope > *').first()), 'Fläche des Sheets').toEqual(
      COLORS.surfaceRaisedDark,
    );
    await expectDarkAndReadable(page, 'e9-profil-sheet');
  });

  test('e9: der Dialog „Änderungen verwerfen?“ ist dunkel und gut lesbar @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    await page.goto(`${server.url}/rezepte/neu`);
    await page.getByRole('textbox', { name: deEditor.title.label }).fill('Halb angefangen');
    await page.getByRole('button', { name: deEditor.cancel }).click();
    const dialog = page.getByRole('alertdialog', { name: deEditor.discard.title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: deEditor.discard.keep })).toBeVisible();
    await expect(dialog.getByRole('button', { name: deEditor.discard.confirm })).toBeVisible();
    // Dialogs use the raised dark surface (Kap. 6.7).
    expect(await background(dialog.locator(':scope > *').first()), 'Fläche des Dialogs').toEqual(
      COLORS.surfaceRaisedDark,
    );
    await expectDarkAndReadable(page, 'e9-dialog-verwerfen');
  });

  test('e9: der Bestätigungsdialog „… endgültig löschen?“ im Papierkorb ist dunkel und gut lesbar @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    await page.goto(`${server.url}/mehr/papierkorb`);
    await page
      .getByRole('listitem')
      .filter({ hasText: data.trashed.title })
      .getByRole('button', { name: dl.trash.purge })
      .click();
    const dialog = page.getByRole('alertdialog', { name: dl.trash.confirmTitle(data.trashed.title) });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(dl.trash.confirmText)).toBeVisible();
    expect(await background(dialog.locator(':scope > *').first()), 'Fläche des Dialogs').toEqual(
      COLORS.surfaceRaisedDark,
    );
    await expectDarkAndReadable(page, 'e9-dialog-endgueltig-loeschen');
  });

  test('e9: der Toast „Rezept gelöscht“ ist invertiert (hell auf dunkler Seite) und gut lesbar @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    await page.goto(`${server.url}/rezepte/${data.recipe.id}`);
    await expect(page.getByRole('heading', { level: 1, name: data.recipe.title })).toBeVisible();
    await page.getByRole('button', { name: de.common.moreActions }).click();
    // The menu sheet on the way is dark, too.
    const menu = page.getByRole('dialog', { name: de.common.moreActions });
    await expect(menu).toBeVisible();
    expect(await background(menu.locator(':scope > *').first()), 'Fläche des Menüs').toEqual(
      COLORS.surfaceRaisedDark,
    );
    await expectDarkAndReadable(page, 'e9-menue-sheet');
    await page.getByRole('button', { name: dl.detail.toTrash }).click();
    const toast = page.locator('.toast').filter({ hasText: dl.detail.deleted });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: de.common.undo })).toBeVisible();
    // Approved component sheet: the toast is inverted in both modes, Linen with Raisin Black in dark
    // mode (docs/design/canvas/generate-mockups.mjs, toastBg/toastText), so it stands out on the page.
    const colors = await toast.evaluate((el) => {
      const style = getComputedStyle(el);
      return { bg: style.backgroundColor, fg: style.color };
    });
    const bg = parseRgb(colors.bg);
    const fg = parseRgb(colors.fg);
    expect(bg).toEqual(COLORS.linen);
    expect(fg).toEqual(COLORS.raisin);
    expect(contrast(bg ?? COLORS.linen, fg ?? COLORS.linen)).toBeGreaterThanOrEqual(4.5);
    await expectDarkAndReadable(page, 'e9-toast', (s) => s.what.startsWith('div.toast'));
  });

  test('e9: das Platzhalterbild ist dunkel mit farbigem Teller, im Detail und in der Liste @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    const name = de.recipe.noPhoto(data.recipe.title);
    // Dark: --color-surface around a plate in the recipe's placeholder color (docs/design/README.md).
    const expected = { surface: COLORS.surfaceDark, plate: placeholderColor(data.recipe.id), opacity: '1' };

    await page.goto(`${server.url}/rezepte/${data.recipe.id}`);
    await expect(page.getByRole('heading', { level: 1, name: data.recipe.title })).toBeVisible();
    // The detail's placeholder is the one with „Foto hinzufügen“ (from 1024 px the list sits next to it).
    const detail = page
      .getByRole('link', { name: de.recipe.addPhoto })
      .locator('xpath=..')
      .getByRole('img', { name });
    await expect(detail).toBeVisible();
    expect(await placeholderLook(detail), 'Platzhalter im Detail').toEqual(expected);
    const shot = isWebkit() ? null : await detail.screenshot({ caret: 'initial' });
    if (shot) {
      const stats = await pixelStats(shot);
      expect(stats.share(expected.plate), 'Anteil der Tellerfarbe im Bild').toBeGreaterThan(0.05);
      expect(stats.share(COLORS.surfaceDark), 'Anteil der dunklen Fläche im Bild').toBeGreaterThan(0.3);
    }
    await expectDarkAndReadable(page, 'e9-platzhalter-detail');

    await page.goto(`${server.url}/rezepte`);
    const card = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: data.recipe.title }) })
      .getByRole('img', { name });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    expect(await placeholderLook(card), 'Platzhalter in der Liste').toEqual(expected);
    await expectDarkAndReadable(page, 'e9-platzhalter-liste');
  });

  test('e9: die Ladeplatzhalter (Skeletons) von Liste, Detail und Editor sind dunkel und heben sich ab @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/recipes'),
      async (route) => {
        await held;
        // Requests of pages left in the meantime are gone.
        await route.continue().catch(() => {});
      },
    );
    const expectSkeletons = async (name: string): Promise<void> => {
      await expectDarkAndReadable(page, name);
      const tones = await skeletonTones(page);
      expect(tones.blocks, `${name}: sichtbare Skeleton-Blöcke`).toBeGreaterThan(0);
      expect(tones.faint, `${name}: Skeleton-Blöcke ohne eigenen Ton`).toEqual([]);
      expect(tones.light, `${name}: helle Skeleton-Blöcke`).toEqual([]);
    };

    await page.goto(`${server.url}/rezepte`);
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: de.common.loading }).first()).toBeAttached();
    await expectSkeletons('e9-skeleton-liste');

    await page.goto(`${server.url}/rezepte/${data.recipe.id}`);
    await expect(page.locator('article[aria-busy="true"]').first()).toBeVisible();
    await expectSkeletons('e9-skeleton-detail');

    await page.goto(`${server.url}/rezepte/${data.recipe.id}/bearbeiten`);
    await expect(page.getByText(deEditor.load.busy)).toBeAttached();
    await expectSkeletons('e9-skeleton-editor');

    release();
    await expect(page.getByRole('textbox', { name: deEditor.title.label })).toHaveValue(data.recipe.title);
  });

  test('e9: der Editor ist dunkel und gut lesbar – neues Rezept und Bearbeiten, ganze Seite @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    await page.goto(`${server.url}/rezepte/neu`);
    await expect(page.getByRole('heading', { level: 1, name: deEditor.titleNew })).toBeVisible();
    await expectDarkAndReadable(page, 'e9-editor-neu');
    // Validation hint after saving an unreadable amount: the error text must stay readable, too.
    await page.getByRole('textbox', { name: deEditor.title.label }).fill('Probe');
    await page
      .getByRole('group', { name: deEditor.ingredients.row(1) })
      .getByRole('textbox', { name: deEditor.ingredients.amount })
      .fill('abc');
    await page.getByRole('button', { name: deEditor.save }).click();
    await expect(page.getByText(deEditor.ingredients.amountInvalid).first()).toBeVisible();
    await expectDarkAndReadable(page, 'e9-editor-fehler');

    await page.goto(`${server.url}/rezepte/${data.recipe.id}/bearbeiten`);
    await expect(page.getByRole('textbox', { name: deEditor.title.label })).toHaveValue(data.recipe.title);
    // Phones fold „Weitere Angaben“ (unless it holds values); from 1024 px it is always open.
    const more = page.getByRole('button', { name: new RegExp(deEditor.more.heading) });
    if ((await more.count()) > 0 && (await more.getAttribute('aria-expanded')) === 'false')
      await more.click();
    await expect(page.getByRole('textbox', { name: deEditor.more.source })).toBeVisible();
    // The whole form is filled: ingredients, steps and the further fields are part of the scan.
    await expect(page.getByRole('textbox', { name: deEditor.ingredients.name }).first()).toHaveValue(
      'Tellerlinsen',
    );
    await expectDarkAndReadable(page, 'e9-editor-bearbeiten');
    // Input fields: dark field surface in dark mode.
    expect(await background(page.getByRole('textbox', { name: deEditor.title.label }))).toEqual(
      COLORS.surfaceDark,
    );
  });

  test('e9: Foto, Vollbild (Lightbox) und Bildvorschau im Editor sind dunkel und gut lesbar @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const profile = await server.api.createProfile(unique('Foto'));
    const image = await server.api.uploadImage(profile.id, await smallJpeg(900, 600));
    const recipe = await server.api.createRecipe(profile.id, {
      title: unique('Mit Foto'),
      imageId: image.imageId,
    });
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}`);
    await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();
    await expect(page.getByRole('img', { name: de.recipe.photo(recipe.title) }).last()).toBeVisible();
    await expectDarkAndReadable(page, 'e9-detail-mit-foto');

    await page.getByRole('button', { name: dl.detail.zoom }).click();
    const lightbox = page.getByRole('dialog', { name: recipe.title });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByRole('img', { name: recipe.title })).toBeVisible();
    expect(await background(lightbox), 'Fläche hinter dem Foto').toEqual(COLORS.raisin);
    await expectDarkAndReadable(page, 'e9-lightbox');
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();

    await page.goto(`${server.url}/rezepte/${recipe.id}/bearbeiten`);
    await expect(page.getByRole('textbox', { name: deEditor.title.label })).toHaveValue(recipe.title);
    await expect(page.getByRole('img', { name: deEditor.photo.preview })).toBeVisible();
    await expectDarkAndReadable(page, 'e9-editor-mit-foto');
  });
});

// ---------------------------------------------------------------------------------------------------
// NF-08 and NF-07 on every screen built so far
// ---------------------------------------------------------------------------------------------------

interface Screen {
  name: string;
  path(data: Seed): string;
  /** Waits until the screen shows its content (no skeletons, fonts loaded). */
  ready(page: Page, data: Seed): Promise<void>;
}

const SCREENS: readonly Screen[] = [
  {
    name: 'Profilwahl',
    path: () => '/profil',
    async ready(page, data) {
      await expect(page.getByRole('heading', { level: 1, name: de.titles.profile })).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(data.profile.name) }).first()).toBeVisible();
    },
  },
  {
    name: 'Rezeptliste',
    path: () => '/rezepte',
    async ready(page, data) {
      await expect(page.getByRole('link', { name: data.recipe.title }).first()).toBeVisible();
    },
  },
  {
    name: 'Rezeptdetail',
    path: (data) => `/rezepte/${data.recipe.id}`,
    async ready(page, data) {
      await expect(page.getByRole('heading', { level: 1, name: data.recipe.title })).toBeVisible();
      await expect(page.getByText('Tellerlinsen')).toBeVisible();
    },
  },
  {
    name: 'Neues Rezept',
    path: () => '/rezepte/neu',
    async ready(page) {
      await expect(page.getByRole('heading', { level: 1, name: deEditor.titleNew })).toBeVisible();
    },
  },
  {
    name: 'Rezept bearbeiten',
    path: (data) => `/rezepte/${data.recipe.id}/bearbeiten`,
    async ready(page, data) {
      await expect(page.getByRole('textbox', { name: deEditor.title.label })).toHaveValue(data.recipe.title);
    },
  },
  {
    name: 'Mehr',
    path: () => '/mehr',
    async ready(page, data) {
      await expect(page.getByRole('heading', { level: 1, name: de.titles.more })).toBeVisible();
      await expect(page.getByText(data.profile.name).first()).toBeVisible();
    },
  },
  {
    name: 'Papierkorb',
    path: () => '/mehr/papierkorb',
    async ready(page, data) {
      await expect(page.getByText(data.trashed.title).first()).toBeVisible();
    },
  },
  {
    name: 'Status',
    path: () => '/mehr/status',
    async ready(page) {
      await expect(page.getByText(dl.status.version, { exact: true })).toBeVisible();
    },
  },
  {
    name: 'Verbinden',
    path: () => '/mehr/verbinden',
    async ready(page) {
      await expect(page.getByRole('img', { name: /QR-Code für/ })).toBeVisible();
    },
  },
  {
    // M4: search without hits (F-23, F-33), a long word so nothing matches and nothing is suggested.
    name: 'Suche ohne Treffer',
    path: () => '/rezepte?q=Qwxzvykjbfgh',
    async ready(page) {
      await expect(page.getByRole('heading', { name: 'Nichts gefunden für ‚Qwxzvykjbfgh‘' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Rezept ‚Qwxzvykjbfgh‘ anlegen' })).toBeVisible();
    },
  },
  {
    // M4: a tag filter (F-24): the active chip on the primary surface with its check icon.
    name: 'Gefilterte Liste',
    path: (data) => `/rezepte?tags=${data.tagId}`,
    async ready(page, data) {
      await expect(page.getByRole('link', { name: data.recipe.title }).first()).toBeVisible();
      await expect(
        page
          .getByRole('group', { name: ds.list.chips })
          .getByRole('button', { name: 'Schwäbisch', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
    },
  },
];

async function open(page: Page, server: AppServer, data: Seed, screen: Screen): Promise<void> {
  await page.goto(server.url + screen.path(data));
  await screen.ready(page, data);
  await settle(page);
}

test.describe('Dark Mode, alle Screens', () => {
  test.use({ colorScheme: 'dark' });

  test('e9: nichts bleibt hell – alle bisher gebauten Screens sind im Dark Mode dunkel und gut lesbar @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    test.setTimeout(60_000);
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    for (const screen of SCREENS) {
      await open(page, server, data, screen);
      await expectDarkAndReadable(page, `e9-screen-${screen.name}`);
    }
  });
});

const WIDTHS = [
  { width: 360, height: 800, tag: '@phone' },
  { width: 390, height: 844, tag: '@phone' },
  { width: 768, height: 1024, tag: '@tablet @desktop' },
  { width: 1024, height: 768, tag: '@tablet @desktop' },
  { width: 1440, height: 900, tag: '@desktop' },
] as const;

for (const size of WIDTHS) {
  test(`NF-08: bei ${size.width} px Breite scrollt kein Screen waagerecht ${size.tag}`, async ({
    page,
    server,
  }) => {
    test.setTimeout(90_000);
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const screen of SCREENS) {
      await open(page, server, data, screen);
      const overflow = await horizontalOverflow(page);
      expect(overflow.innerWidth, `${screen.name}: Fensterbreite`).toBe(size.width);
      expect(
        overflow.scrollWidth,
        `${screen.name}: scrollWidth ≤ innerWidth (ragt heraus: ${overflow.culprits.join(', ')})`,
      ).toBeLessThanOrEqual(overflow.innerWidth);
      await snap(page, `nf08-${size.width}-${screen.name}`);
    }
  });

  test(`NF-07: bei ${size.width} px Breite sind alle Schaltflächen, Links und Felder mindestens 44 × 44 px groß ${size.tag}`, async ({
    page,
    server,
  }) => {
    test.setTimeout(90_000);
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    await page.setViewportSize({ width: size.width, height: size.height });
    const tooSmall: string[] = [];
    const collect = async (where: string): Promise<TapTarget[]> => {
      const targets = await tapTargets(page);
      expect(targets.length, `${where}: gefundene Tippflächen`).toBeGreaterThan(0);
      for (const t of targets) {
        if (t.width < 44 || t.height < 44) tooSmall.push(`${where}: ${t.what} ${t.width}×${t.height}`);
      }
      return targets;
    };

    for (const screen of SCREENS) {
      await open(page, server, data, screen);
      await collect(screen.name);
    }

    // Overlays: profile sheet and the discard dialog.
    await open(page, server, data, SCREENS[1] as Screen);
    await page.getByRole('button', { name: de.profile.switchLabel(data.profile.name) }).click();
    await expect(page.getByRole('dialog', { name: de.profile.switchTitle })).toBeVisible();
    await collect('Profil-Sheet');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: de.profile.switchTitle })).toBeHidden();

    // Filter sheet (phone, tablet portrait) or side panel (≥ 1024 px), with an active tag.
    await page.goto(`${server.url}/rezepte?tags=${data.tagId}`);
    await page.getByRole('button', { name: ds.list.filter(1), exact: true }).click();
    const filter = page.getByRole('dialog', { name: df.title });
    await expect(filter.getByRole('button', { name: /^Schwäbisch/ })).toBeVisible();
    await settle(page);
    await collect('Filter-Sheet');
    await page.keyboard.press('Escape');
    await expect(filter).toBeHidden();

    await open(page, server, data, SCREENS[3] as Screen);
    await page.getByRole('textbox', { name: deEditor.title.label }).fill('Nur kurz');
    await page.getByRole('button', { name: deEditor.cancel }).click();
    await expect(page.getByRole('alertdialog', { name: deEditor.discard.title })).toBeVisible();
    await collect('Dialog Verwerfen');

    expect(tooSmall, 'Tippflächen unter 44 × 44 px').toEqual([]);
  });
}

test('NF-07: Küchenaktionen (FAB „Neues Rezept“, „Speichern“) sind mindestens 48 × 48 px groß @phone @tablet', async ({
  page,
  server,
}) => {
  const data = await seed(server);
  await useProfile(page, data.profile.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, server, data, SCREENS[1] as Screen);
  const fab = await page.getByRole('link', { name: de.nav.newRecipe }).last().boundingBox();
  expect(fab?.width ?? 0).toBeGreaterThanOrEqual(48);
  expect(fab?.height ?? 0).toBeGreaterThanOrEqual(48);
  await open(page, server, data, SCREENS[3] as Screen);
  const save = await page.getByRole('button', { name: deEditor.save }).boundingBox();
  expect(save?.width ?? 0).toBeGreaterThanOrEqual(48);
  expect(save?.height ?? 0).toBeGreaterThanOrEqual(48);
});

test.describe('Dark Mode, Filter', () => {
  test.use({ colorScheme: 'dark' });

  test('e9: Filter-Sheet bzw. -Panel mit aktivem Tag ist dunkel und gut lesbar @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    await page.goto(`${server.url}/rezepte?tags=${data.tagId}`);
    await page.getByRole('button', { name: ds.list.filter(1), exact: true }).click();
    const sheet = page.getByRole('dialog', { name: df.title });
    const active = sheet.getByRole('button', { name: /^Schwäbisch/ });
    await expect(active).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByRole('radio', { name: df.modes.all })).toHaveAttribute('aria-checked', 'true');
    expect(await background(sheet.locator(':scope > *').first()), 'Fläche des Sheets').toEqual(
      COLORS.surfaceRaisedDark,
    );
    await expectDarkAndReadable(page, 'e9-filter-sheet');
  });
});

// ---------------------------------------------------------------------------------------------------
// M4: the sticky search row next to the offline banner and the keyboard focus
// ---------------------------------------------------------------------------------------------------

/** Twelve recipes of a new profile and its list, so the page (or the list column) scrolls. */
async function longList(page: Page, server: AppServer): Promise<void> {
  const profile = await server.api.createProfile(unique('Lang'));
  for (let i = 1; i <= 12; i++)
    await server.api.createRecipe(profile.id, { title: unique(`Langrezept ${i}`) });
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await expect(page.getByRole('main').getByRole('listitem').nth(11)).toBeAttached();
}

function searchRowBox(page: Page): Promise<{ top: number; bottom: number }> {
  return page.evaluate(() => {
    const r = document.querySelector('.search-row')?.getBoundingClientRect();
    return { top: r?.top ?? -1, bottom: r?.bottom ?? -1 };
  });
}

/** Scrolls what scrolls the list: the page below 1024 px, the list column from 1024 px. */
async function scrollList(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => {
    const pane = document.querySelector('.list-pane');
    if (pane) pane.scrollTop = top;
    else window.scrollTo(0, top);
  }, y);
}

test('NF-08: das Offline-Banner und die fixierte Suchzeile überlappen sich nie, auch beim Scrollen @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  await longList(page, server);
  const sizes = test.info().project.name === 'tablet-webkit' ? [null, { width: 768, height: 1024 }] : [null];
  for (const size of sizes) {
    if (size) {
      await page.setViewportSize(size);
      await page.reload();
    }
    await page.route('**/api/v1/**', (route) => route.abort('connectionrefused'));
    await page.getByRole('button', { name: de.common.refresh }).click();
    const banner = page.getByRole('alert').filter({ hasText: de.connection.offline });
    await expect(banner).toBeVisible();
    for (const y of [0, 200, 1_500]) {
      await scrollList(page, y);
      await settle(page);
      const bannerBox = await banner.boundingBox();
      const row = await searchRowBox(page);
      const where = `${page.viewportSize()?.width} px, ${y} px gescrollt`;
      expect(bannerBox, where).not.toBeNull();
      expect(row.top, `${where}: Suchzeile unter dem Banner`).toBeGreaterThanOrEqual(
        (bannerBox?.y ?? 0) + (bannerBox?.height ?? 0) - 0.5,
      );
      await expect(banner, where).toBeInViewport();
      await expect(
        page.getByRole('searchbox', { name: ds.list.search, exact: true }),
        where,
      ).toBeInViewport();
      await snap(page, `nf08-banner-suchzeile-${page.viewportSize()?.width}-${y}`);
    }
    await page.unroute('**/api/v1/**');
    await banner.getByRole('button', { name: de.common.retry }).click();
    await expect(banner).toHaveCount(0);
    // Without the banner the row sticks to the top again.
    await scrollList(page, 1_500);
    await expect.poll(async () => Math.round((await searchRowBox(page)).top)).toBeLessThanOrEqual(0);
  }
});

test('NF-11: eine per Tastatur fokussierte Karte liegt ganz unter der fixierten Suchzeile, vorwärts und rückwärts @phone @tablet @desktop', async ({
  page,
  server,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'WebKit springt mit Tab nicht auf Links (Systemeinstellung), Tastaturtest in Chromium',
  );
  await longList(page, server);
  // The newest 12 are this test's recipes (the worker's tests run one after the other).
  const links = page.getByRole('main').getByRole('list').first().getByRole('link');
  const count = 12;
  // The sort button is the last control before the first card.
  await page.getByRole('button', { name: /^Sortierung: / }).focus();
  const check = async (step: string): Promise<void> => {
    const place = await page.evaluate(() => {
      const item = document.activeElement?.closest('li')?.getBoundingClientRect();
      const row = document.querySelector('.search-row')?.getBoundingClientRect();
      const pane = document.querySelector('.list-pane')?.getBoundingClientRect();
      return {
        top: item?.top ?? -1,
        bottom: item?.bottom ?? -1,
        row: row?.bottom ?? -1,
        end: pane ? pane.bottom : window.innerHeight,
      };
    });
    expect(place.top, `${step}: Karte beginnt unter der Suchzeile`).toBeGreaterThanOrEqual(place.row - 0.5);
    expect(place.bottom, `${step}: Karte endet im Sichtbereich`).toBeLessThanOrEqual(place.end + 0.5);
  };
  for (let i = 1; i <= count; i++) {
    await page.keyboard.press('Tab');
    await expect(links.nth(i - 1)).toBeFocused();
    await settle(page);
    await check(`Tab ${i}`);
  }
  for (let i = count - 1; i >= 1; i--) {
    await page.keyboard.press('Shift+Tab');
    await expect(links.nth(i - 1)).toBeFocused();
    await settle(page);
    await check(`Umschalt+Tab ${i}`);
  }
});

test('e9: im Editor sind Menge und Einheit vollständig lesbar – Platzhalter einer leeren Zeile und alle vorgeschlagenen Einheiten @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  // Regression: the amount field (72 px; 64 px in the one-line row from 480 px container width) and the
  // unit field (88 px; 76 px) of the approved artboards, which only show short values („g“), once cut „Meng“,
  // „Einhe“ and units like „Packu“ (in Chromium also „Stü“, „Bun“ … because of the datalist arrow). The
  // widths stay; the two fields have 5 px side padding and no datalist arrow (docs/design/README.md).
  const data = await seed(server);
  const units = await server.api.createRecipe(data.profile.id, {
    title: unique('Alle Einheiten'),
    ingredients: deEditor.unitSuggestions.map((unit, i) => ({
      amount: i === 0 ? 1250 : 1.5,
      unit,
      name: `Zutat ${unit}`,
    })),
  });
  await useProfile(page, data.profile.id);
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const widths =
    viewport.width < 600 ? [360, viewport.width] : viewport.width === 1024 ? [768, 1024] : [viewport.width];
  const labels = [deEditor.ingredients.amount, deEditor.ingredients.unit];
  const clipped: string[] = [];
  const report = (where: string, found: ClippedText[]): void => {
    for (const c of found)
      clipped.push(`${where}: ${c.what} „${c.text}“ braucht ${c.needed} px, hat ${c.available} px`);
  };
  for (const width of widths) {
    await page.setViewportSize({ width, height: viewport.height });
    await open(page, server, data, SCREENS[3] as Screen);
    report(`${width} px, leere Zeile`, await clippedPlaceholders(page));
    // With the focus (2 px border) the text must fit as well.
    report(`${width} px, leere Zeile mit Fokus`, await clippedFocused(page, labels));
    await page.goto(`${server.url}/rezepte/${units.id}/bearbeiten`);
    await expect(page.getByRole('textbox', { name: deEditor.title.label })).toHaveValue(units.title);
    await settle(page);
    report(`${width} px`, await clippedValues(page, labels));
    report(`${width} px mit Fokus`, await clippedFocused(page, labels));
  }
  expect(clipped).toEqual([]);
});

test.describe('Prüfhilfen', () => {
  test.use({ colorScheme: 'dark' });

  test('die Scans erkennen helle Flächen und Frames, schwachen Kontrast auch in Feldern, unsichtbare Skeletons, kleine Tippflächen, Überbreite und abgeschnittene Platzhalter @desktop', async ({
    page,
    server,
  }) => {
    const data = await seed(server);
    await useProfile(page, data.profile.id);
    await recordStartup(page);
    await open(page, server, data, SCREENS[7] as Screen);
    // A light layer over the page during the start is caught by the frame recorder.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const flash = document.createElement('div');
          flash.textContent = 'Blitz';
          Object.assign(flash.style, { position: 'fixed', inset: '0', zIndex: '999' });
          flash.style.background = 'rgb(255, 255, 255)';
          document.body.append(flash);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              flash.remove();
              resolve();
            }),
          );
        }),
    );
    expect((await stopStartup(page)).light.map((s) => s.what)).toContain('div "Blitz"');
    // Moonstone or Vanilla count as approved only with Raisin Black text; a skeleton needs its own tone.
    await page.evaluate(() => {
      const chip = (color: string): HTMLElement => {
        const el = document.createElement('span');
        el.textContent = `Chip ${color}`;
        Object.assign(el.style, { display: 'inline-block', padding: '8px' });
        el.style.background = 'rgb(126, 189, 194)';
        el.style.color = color;
        return el;
      };
      const busy = document.createElement('div');
      busy.setAttribute('aria-busy', 'true');
      const bone = document.createElement('div');
      Object.assign(bone.style, { width: '200px', height: '20px' });
      bone.style.background = 'rgba(35, 31, 32, 0.08)';
      busy.append(bone);
      document.body.prepend(chip('rgb(35, 31, 32)'), chip('rgb(239, 230, 221)'), busy);
    });
    const chips = (await lightSurfaces(page, { wholePage: true })).filter((s) =>
      s.what.startsWith('span "Chip'),
    );
    expect(chips.map((s) => [s.what, approvedLight(s)])).toEqual([
      ['span "Chip rgb(35, 31, 32)"', true],
      ['span "Chip rgb(239, 230, 221)"', false],
    ]);
    const tones = await skeletonTones(page);
    expect(tones.blocks).toBeGreaterThan(0);
    expect(tones.faint).toHaveLength(1);
    // Deliberate defects, styled through the CSSOM (allowed by the CSP, unlike style attributes).
    await page.evaluate(() => {
      const pale = document.createElement('div');
      pale.textContent = 'Blasser Hinweis';
      Object.assign(pale.style, { position: 'fixed', top: '0', left: '0', zIndex: '999', padding: '8px' });
      pale.style.background = 'rgb(239, 230, 221)';
      pale.style.color = 'rgb(190, 190, 190)';
      const tiny = document.createElement('button');
      tiny.type = 'button';
      tiny.textContent = 'x';
      Object.assign(tiny.style, { position: 'fixed', top: '60px', left: '0', width: '30px', height: '30px' });
      const wide = document.createElement('div');
      Object.assign(wide.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '3000px',
        height: '4px',
      });
      const field = document.createElement('input');
      field.placeholder = 'Ein viel zu langer Platzhalter';
      Object.assign(field.style, { position: 'fixed', top: '100px', left: '0', width: '60px' });
      // Muted placeholder (Linen-based in dark mode) on a Linen field and a pale value: both unreadable.
      const paleField = document.createElement('input');
      paleField.setAttribute('aria-label', 'Blasses Feld');
      paleField.placeholder = 'Blasser Platzhalter';
      Object.assign(paleField.style, { position: 'fixed', top: '160px', left: '0', width: '300px' });
      paleField.style.background = 'rgb(239, 230, 221)';
      const paleValue = document.createElement('textarea');
      paleValue.setAttribute('aria-label', 'Blasser Wert');
      paleValue.value = 'Kaum lesbar';
      Object.assign(paleValue.style, { position: 'fixed', top: '220px', left: '0' });
      paleValue.style.background = 'rgb(47, 43, 44)';
      paleValue.style.color = 'rgb(70, 66, 67)';
      document.body.append(pale, tiny, wide, field, paleField, paleValue);
    });
    expect((await lightSurfaces(page)).map((s) => s.what)).toContain('div "Blasser Hinweis"');
    expect((await lowContrastTexts(page)).map((t) => t.what)).toEqual(
      expect.arrayContaining([
        'div "Blasser Hinweis"',
        'input[Blasses Feld] "Blasser Platzhalter"',
        'textarea[Blasser Wert] "Kaum lesbar"',
      ]),
    );
    expect(await tapTargets(page)).toContainEqual({ what: 'button "x"', width: 30, height: 30 });
    const overflow = await horizontalOverflow(page);
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.innerWidth);
    expect((await clippedPlaceholders(page)).map((c) => c.text)).toContain('Ein viel zu langer Platzhalter');
    // A field that fits until its focus style adds padding.
    await page.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('input[aria-label="Fokusfeld"]:focus { padding: 0 40px; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      const focusField = document.createElement('input');
      focusField.setAttribute('aria-label', 'Fokusfeld');
      focusField.value = 'Packung';
      Object.assign(focusField.style, { position: 'fixed', top: '280px', left: '0', width: '120px' });
      document.body.append(focusField);
    });
    expect(await clippedValues(page, ['Fokusfeld'])).toEqual([]);
    expect((await clippedFocused(page, ['Fokusfeld'])).map((c) => c.text)).toEqual(['Packung']);
  });
});
