// Checklist section E (navigation), automated: e1, e2, e3, e4, e6, e8.
// - e1: the list loads the next page while scrolling; Back (history step or „Zurück zu Rezepte“) from a
//   recipe far down keeps the position, on phones, iPad landscape and portrait, desktop (F-34).
// - e2: the address of an opened recipe called directly and in a new tab; without a remembered profile;
//   an unknown app path „Nicht gefunden“ (F-34).
// - e3: stopped server → banner ≤ 3 s after „Aktualisieren“, list stays; „Erneut versuchen“ keeps the banner
//   while the server is down and, after the restart, removes it and reloads the list (F-33, NF-09).
// - e4: Back (Android back button, iOS back gesture = history back) closes an open sheet first (F-34).
// - e6: iPad portrait: two card columns, ingredients next to the steps (NF-08).
// - e8: card images are sharp (≥ displayed width × min(DPR, 2)), never l, at most 2× (NF-06), on phones,
//   iPad portrait at 744–834 px and the rows of iPad landscape.
// Existing lower-level coverage: tests/api/static.test.ts (SPA fallback), tests/unit/router.test.ts (route
// table, notFound), tests/api/recipe-list.test.ts (40 + 5 pagination), tests/unit/media-sizes.test.ts (srcset).
import type { Locator, Page } from '@playwright/test';
import { photoJpeg } from '../helpers/images.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';

let seq = 0;

/** Unique suffix per test run: the worker server is shared by the tests of one worker. */
function uid(): string {
  seq += 1;
  const project = test.info().project.name.replace('-chromium', '-c').replace('-webkit', '-w');
  return `${project}-${process.pid.toString(36)}-${seq}`;
}

/** A recipe link in the list (card title or compact row). */
function recipeLink(page: Page, title: string): Locator {
  return page.getByRole('link', { name: title, exact: true });
}

/** Box of a visible element in viewport coordinates. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element ist nicht sichtbar');
  return box;
}

/** Viewport y of an element (changes when the page or the list column scrolls). */
async function topOf(locator: Locator): Promise<number> {
  return (await boxOf(locator)).y;
}

/** Waits until the element sits at `y` again (the router restores over several frames). */
async function expectAt(locator: Locator, y: number): Promise<void> {
  await expect
    .poll(async () => Math.abs((await topOf(locator)) - y), { timeout: 5_000 })
    .toBeLessThanOrEqual(2);
}

async function createNumbered(server: AppServer, profileId: number, prefix: string, count: number) {
  const ids: number[] = [];
  for (let n = 1; n <= count; n++) {
    const recipe = await server.api.createRecipe(profileId, {
      title: `${prefix} ${String(n).padStart(2, '0')}`,
    });
    ids.push(recipe.id);
  }
  return ids;
}

// --- e1: pagination while scrolling and the scroll position after Back

async function openListWith45(page: Page, server: AppServer): Promise<void> {
  const profile = await server.api.createProfile(`Scroll ${uid()}`);
  await createNumbered(server, profile.id, 'Scrollrezept', 45);
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await expect(page.getByText('45 Rezepte')).toBeVisible();
  const links = page.getByRole('link', { name: /^Scrollrezept \d\d$/ });
  // First page: 40 of 45 (newest first, so 45 … 06); the rest follows when the end comes near.
  await expect(links).toHaveCount(40);
  await expect(recipeLink(page, 'Scrollrezept 05')).toHaveCount(0);
  await links.nth(39).scrollIntoViewIfNeeded();
  await expect(links).toHaveCount(45);
  await expect(recipeLink(page, 'Scrollrezept 01')).toBeAttached();
}

/** How far the list is scrolled: the page below 1024 px, the list column from 1024 px (NF-08). */
function listScrolled(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(window.scrollY, document.querySelector('.list-pane')?.scrollTop ?? 0));
}

/**
 * Scrolls to recipe 05 (loaded with the second page), opens it and goes back, either with a history step
 * (Android back button, iOS back gesture) or with the recipe's own „Zurück zu Rezepte“.
 */
async function openFarDownAndReturn(page: Page, server: AppServer, via: 'history' | 'button'): Promise<void> {
  await openListWith45(page, server);
  const target = recipeLink(page, 'Scrollrezept 05');
  await target.scrollIntoViewIfNeeded();
  const y = await topOf(target);
  expect(y, 'Rezept 05 liegt im Sichtbereich').toBeGreaterThan(0);
  const scrolled = await listScrolled(page);
  expect(scrolled, 'die Liste ist weit nach unten gescrollt').toBeGreaterThan(1_000);

  await target.click();
  await expect(page).toHaveURL(/\/rezepte\/\d+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Scrollrezept 05' })).toBeVisible();

  if (via === 'history') await page.goBack();
  else await page.getByRole('button', { name: 'Zurück zu Rezepte' }).click();
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(target).toBeInViewport();
  await expectAt(target, y);
  expect(Math.abs((await listScrolled(page)) - scrolled), 'gleiche Scrollposition').toBeLessThanOrEqual(2);
  // The second page is still there: nothing was loaded from the start again.
  await expect(page.getByRole('link', { name: /^Scrollrezept \d\d$/ })).toHaveCount(45);
}

test('e1: Liste lädt beim Scrollen nach, Zurück aus einem Rezept weit unten behält die Position @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  await openFarDownAndReturn(page, freshServer, 'history');
});

test('e1: „Zurück zu Rezepte“ im Rezept behält die Scrollposition der Liste @phone', async ({
  page,
  freshServer,
}) => {
  await openFarDownAndReturn(page, freshServer, 'button');
});

test('e1: iPad hochkant (2 Spalten): Nachladen, Zurück-Geste und „Zurück zu Rezepte“ behalten die Position @tablet', async ({
  page,
  freshServer,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openFarDownAndReturn(page, freshServer, 'history');
  // Same list again (the pages are kept): open 05 once more and return with the button.
  const target = recipeLink(page, 'Scrollrezept 05');
  const y = await topOf(target);
  await target.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Scrollrezept 05' })).toBeVisible();
  await page.getByRole('button', { name: 'Zurück zu Rezepte' }).click();
  await expect(page).toHaveURL(/\/rezepte$/);
  await expectAt(target, y);
});

// --- e2: deep links

test('e2: Rezeptadresse direkt aufgerufen zeigt das Rezept, auch in einem zweiten Tab @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const name = uid();
  const profile = await server.api.createProfile(`Link ${name}`);
  const recipe = await server.api.createRecipe(profile.id, {
    title: `Direktlink-Eintopf ${name}`,
    steps: [{ text: 'Alles in einen Topf geben.' }],
  });
  await useProfile(page, profile.id);

  // The address of an opened recipe, as the address bar shows it.
  await page.goto(`${server.url}/rezepte`);
  await recipeLink(page, recipe.title).click();
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();
  const address = page.url();
  expect(new URL(address).pathname).toBe(`/rezepte/${recipe.id}`);

  // Called directly in the same tab (no 404: the server answers app paths with the app).
  const res = await page.goto(address);
  expect(res?.status(), 'kein 404 für den App-Pfad').toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();
  await expect(page.getByText('Alles in einen Topf geben.')).toBeVisible();

  // A new tab of the same browser (profile remembered on the device).
  const tab = await page.context().newPage();
  const errors: string[] = [];
  tab.on('pageerror', (error) => errors.push(error.message));
  const tabRes = await tab.goto(address);
  expect(tabRes?.status()).toBe(200);
  await expect(tab.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();
  await expect(tab.getByText('Alles in einen Topf geben.')).toBeVisible();
  await expect(tab.getByRole('heading', { name: 'Wer kocht?' })).toHaveCount(0);
  await tab.close();
  expect(errors, 'Fehler im zweiten Tab').toEqual([]);
});

test('e2: ohne gemerktes Profil fragt der Direktlink erst „Wer kocht?“ und öffnet dann das Rezept @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const name = uid();
  const profile = await server.api.createProfile(`Neu ${name}`);
  const recipe = await server.api.createRecipe(profile.id, { title: `Erstbesuch-Salat ${name}` });

  await page.goto(`${server.url}/rezepte/${recipe.id}`);
  await expect(page.getByRole('heading', { name: 'Wer kocht?' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`Neu ${name}$`) }).click();
  await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();
});

test('e2: ein erfundener Pfad zeigt „Nicht gefunden“ mit dem Weg zur Liste @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(`Pfad ${uid()}`);
  await useProfile(page, profile.id);

  const res = await page.goto(`${server.url}/gibt-es-nicht/rezepte`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Nicht gefunden' })).toBeVisible();
  await expect(page.getByText('Diese Seite gibt es nicht.')).toBeVisible();
  await page.getByRole('link', { name: 'Zur Rezeptliste' }).click();
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rezepte' })).toBeVisible();
});

// --- e3: server down and back

test('e3: gestoppter Server zeigt nach „Aktualisieren“ ≤ 3 s das Banner, „Erneut versuchen“ lädt nach dem Neustart @phone @tablet @desktop', async ({
  page,
  freshServer,
  browserName,
}) => {
  const profile = await freshServer.api.createProfile('Banner');
  const before = await freshServer.api.createRecipe(profile.id, { title: 'Vor dem Ausfall' });
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte`);
  await expect(recipeLink(page, before.title)).toBeVisible();
  await expect(page.getByText('1 Rezept', { exact: true })).toBeVisible();

  const banner = page
    .getByRole('alert')
    .filter({ hasText: 'Server nicht erreichbar – läuft der Rezepte-PC?' });
  await expect(banner).toHaveCount(0);

  await freshServer.stop();
  const failed = page.waitForEvent('requestfailed', {
    predicate: (req) => new URL(req.url()).pathname === '/api/v1/recipes',
    timeout: 10_000,
  });
  const tapped = Date.now();
  await page.getByRole('button', { name: 'Aktualisieren' }).click();
  await failed;
  const failedAfter = Date.now() - tapped;
  // F-33 AK: the banner ≤ 3 s after the failed request.
  await expect(banner).toBeVisible({ timeout: 3_000 });
  const shownAfter = Date.now() - tapped;
  test.info().annotations.push({
    type: 'Banner',
    description: `Anfrage gescheitert nach ${failedAfter} ms, Banner nach ${shownAfter} ms`,
  });
  // Item: ≤ 3 s after the tap. Chromium gets the refused connection at once, like a phone in the LAN whose
  // PC answers with a reset. WebKit on Windows itself needs about 2.2–2.5 s for a refused loopback
  // connection; the next test gives WebKit an immediate refusal and asserts the time from the tap there.
  if (browserName !== 'webkit') expect(shownAfter).toBeLessThanOrEqual(3_000);
  // The last list stays visible below the banner, without an error toast (F-33).
  await expect(recipeLink(page, before.title)).toBeVisible();
  await expect(page.getByText('1 Rezept', { exact: true })).toBeVisible();
  await expect(page.getByText('Server nicht erreichbar – läuft der Rezepte-PC?')).toHaveCount(1);

  // „Erneut versuchen“ really asks the server: while it is still down, banner and list stay.
  const retry = banner.getByRole('button', { name: 'Erneut versuchen' });
  const pingFailed = page.waitForEvent('requestfailed', {
    predicate: (req) => new URL(req.url()).pathname === '/api/v1/revision',
    timeout: 10_000,
  });
  await retry.click();
  await pingFailed;
  await expect(retry).not.toHaveAttribute('aria-busy', 'true');
  await expect(banner).toBeVisible();
  await expect(recipeLink(page, before.title)).toBeVisible();

  await freshServer.restart();
  // Still there after the restart (nothing polls the server), so the tap below is what removes it.
  await expect(banner).toBeVisible();
  // Something changed while the list was offline: the reload after the retry must show it.
  const after = await freshServer.api.createRecipe(profile.id, { title: 'Nach dem Neustart' });
  await retry.click();
  await expect(banner).toHaveCount(0);
  await expect(recipeLink(page, after.title)).toBeVisible();
  await expect(recipeLink(page, before.title)).toBeVisible();
  await expect(page.getByText('2 Rezepte', { exact: true })).toBeVisible();
});

test('e3: sofort abgewiesene Verbindung wie im WLAN: Banner ≤ 3 s nach dem Tippen, auch in WebKit @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const profile = await freshServer.api.createProfile('Abgewiesen');
  const before = await freshServer.api.createRecipe(profile.id, { title: 'Vor dem Ausfall' });
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte`);
  await expect(recipeLink(page, before.title)).toBeVisible();
  const banner = page
    .getByRole('alert')
    .filter({ hasText: 'Server nicht erreichbar – läuft der Rezepte-PC?' });

  await freshServer.stop();
  // A PC in the WLAN answers the closed port with a reset at once. On Windows loopback WebKit waits about
  // 2 s before it reports that, so the refusal comes from the browser's network layer here.
  await page.route('**/api/v1/**', (route) => route.abort('connectionrefused'));
  const tapped = Date.now();
  await page.getByRole('button', { name: 'Aktualisieren' }).click();
  await expect(banner).toBeVisible({ timeout: 3_000 });
  const shownAfter = Date.now() - tapped;
  test.info().annotations.push({ type: 'Banner', description: `Banner nach ${shownAfter} ms` });
  expect(shownAfter, 'Banner ≤ 3 s nach dem Tippen').toBeLessThanOrEqual(3_000);
  await expect(recipeLink(page, before.title)).toBeVisible();
  await expect(page.getByText('1 Rezept', { exact: true })).toBeVisible();

  await page.unroute('**/api/v1/**');
  await freshServer.restart();
  await banner.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(banner).toHaveCount(0);
  await expect(recipeLink(page, before.title)).toBeVisible();
});

// --- e4: Back closes an open sheet first

test('e4: Zurück schließt zuerst das Sheet „Profil wechseln“, die Liste bleibt an ihrer Stelle @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const name = uid();
  const profile = await server.api.createProfile(`Sheet ${name}`);
  await createNumbered(server, profile.id, `Sheetrezept ${name}`, 12);
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  const first = recipeLink(page, `Sheetrezept ${name} 01`);
  await expect(first).toBeAttached();
  // Scroll the list (window on phones, the list column from 1024 px), as far as the avatar stays reachable.
  await first.scrollIntoViewIfNeeded();

  const avatar = page.getByRole('button', { name: `Profil wechseln, aktiv: Sheet ${name}` });
  await avatar.click();
  const sheet = page.getByRole('dialog', { name: 'Profil wechseln' });
  await expect(sheet).toBeVisible();
  const y = await topOf(first);

  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rezepte' })).toBeVisible();
  await expectAt(first, y);
  await expect(avatar).toBeVisible();
});

test('e4: Zurück schließt zuerst „Weitere Aktionen“ im Rezept, das nächste Zurück führt zur Liste @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const name = uid();
  const profile = await server.api.createProfile(`Menü ${name}`);
  const recipe = await server.api.createRecipe(profile.id, { title: `Menürezept ${name}` });
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await recipeLink(page, recipe.title).click();
  await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();

  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Weitere Aktionen' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'In den Papierkorb' })).toBeVisible();

  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();

  // The sheet's history entry is used up: the next Back leaves the recipe.
  await page.goBack();
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rezepte' })).toBeVisible();
});

test('e4: ein per „Schließen“ geschlossenes Sheet hinterlässt keinen Zurück-Schritt @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const name = uid();
  const profile = await server.api.createProfile(`Zu ${name}`);
  const recipe = await server.api.createRecipe(profile.id, { title: `Schließrezept ${name}` });
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await recipeLink(page, recipe.title).click();
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();

  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Weitere Aktionen' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Schließen' }).click();
  await expect(sheet).toBeHidden();

  await page.goBack();
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rezepte' })).toBeVisible();
});

// --- e6: iPad portrait

const IPAD_PORTRAIT_WIDTHS = [
  { width: 744, height: 1133 }, // iPad mini
  { width: 768, height: 1024 }, // iPad 9.7"
  { width: 810, height: 1080 }, // iPad 10.2"
  { width: 834, height: 1194 }, // iPad Pro 11"
];

test('e6: iPad hochkant zeigt die Karten in 2 Spalten und im Detail die Zutaten neben den Schritten @tablet', async ({
  page,
  server,
}) => {
  const name = uid();
  const profile = await server.api.createProfile(`Hoch ${name}`);
  await createNumbered(server, profile.id, `Hochkant ${name}`, 3);
  const detail = await server.api.createRecipe(profile.id, {
    title: `Hochkant-Gulasch ${name}`,
    servings: 4,
    ingredients: [
      { amount: 500, unit: 'g', name: 'Rindfleisch' },
      { amount: 2, name: 'Zwiebeln' },
      { amount: 1, unit: 'EL', name: 'Paprikapulver' },
    ],
    steps: [
      { text: 'Fleisch anbraten.' },
      { text: 'Zwiebeln dazugeben.' },
      { text: 'Zwei Stunden schmoren.' },
    ],
  });
  await useProfile(page, profile.id);

  for (const size of IPAD_PORTRAIT_WIDTHS) {
    await page.setViewportSize(size);
    await page.goto(`${server.url}/rezepte`);
    // Newest first: the detail recipe, then 03, 02, 01 → two per row.
    const card = (title: string) => page.getByRole('listitem').filter({ has: recipeLink(page, title) });
    const a = await boxOf(card(detail.title));
    const b = await boxOf(card(`Hochkant ${name} 03`));
    const c = await boxOf(card(`Hochkant ${name} 02`));
    const d = await boxOf(card(`Hochkant ${name} 01`));
    const where = `${size.width}×${size.height}`;
    expect(Math.abs(a.y - b.y), `${where}: 1. und 2. Karte in einer Reihe`).toBeLessThanOrEqual(1);
    expect(b.x, `${where}: 2. Karte rechts neben der 1.`).toBeGreaterThanOrEqual(a.x + a.width);
    expect(Math.abs(a.width - b.width), `${where}: gleich breite Spalten`).toBeLessThanOrEqual(1);
    expect(a.width * 2, `${where}: zwei Spalten füllen die Breite`).toBeGreaterThan(size.width * 0.85);
    expect(c.y, `${where}: 3. Karte in der nächsten Reihe`).toBeGreaterThanOrEqual(a.y + a.height);
    expect(Math.abs(c.x - a.x), `${where}: 3. Karte wieder links`).toBeLessThanOrEqual(1);
    expect(Math.abs(d.y - c.y), `${where}: 4. Karte neben der 3.`).toBeLessThanOrEqual(1);

    await recipeLink(page, detail.title).click();
    await expect(page.getByRole('heading', { level: 1, name: detail.title })).toBeVisible();
    const ingredients = page.getByRole('region', { name: 'Zutaten' });
    const steps = page.getByRole('region', { name: 'Zubereitung' });
    await expect(ingredients.getByText('Paprikapulver')).toBeVisible();
    await expect(steps.getByText('Zwei Stunden schmoren.')).toBeVisible();
    const ing = await boxOf(ingredients);
    const st = await boxOf(steps);
    expect(st.x, `${where}: Schritte rechts neben den Zutaten`).toBeGreaterThanOrEqual(ing.x + ing.width);
    expect(
      Math.abs(st.y - ing.y),
      `${where}: Zutaten und Schritte beginnen auf einer Höhe`,
    ).toBeLessThanOrEqual(2);
    expect(Math.round(ing.width), `${where}: Zutatenspalte 300 px`).toBe(300);
  }
});

// --- e8: sharp card images, never l, at most 2×

let photos: Promise<[Buffer, Buffer]> | null = null;

/** A 3:2 landscape and a 2:3 portrait photo: both offer s (720 px) and m (1200 / 800 px) to cards. */
function testPhotos(): Promise<[Buffer, Buffer]> {
  photos ??= Promise.all([
    photoJpeg({ width: 1800, height: 1200, noise: 4 }),
    photoJpeg({ width: 1200, height: 1800, noise: 4 }),
  ]);
  return photos;
}

interface ShownImage {
  natural: number;
  displayed: number;
  dpr: number;
  src: string;
}

/** Viewport of an iPad model; null keeps the project's own viewport. */
type Viewport = { width: number; height: number } | null;

/**
 * For each viewport: two new photo recipes (new uploads, so no variant comes from the cache of an earlier
 * viewport) below a recipe without photo, then the list is loaded and both images are checked.
 */
async function checkListImages(
  page: Page,
  server: AppServer,
  layout: 'cards' | 'rows',
  viewports: Viewport[] = [null],
): Promise<void> {
  const name = uid();
  const profile = await server.api.createProfile(`Bild ${name}`);
  await useProfile(page, profile.id);
  const [landscape, portrait] = await testPhotos();
  const media: string[] = [];
  page.on('request', (req) => {
    const { pathname } = new URL(req.url());
    if (pathname.startsWith('/media/')) media.push(pathname);
  });
  const dprCap = Math.min(test.info().project.use.deviceScaleFactor ?? 1, 2);

  for (const [v, viewport] of viewports.entries()) {
    if (viewport) await page.setViewportSize(viewport);
    const uploads = [
      await server.api.uploadImage(profile.id, landscape),
      await server.api.uploadImage(profile.id, portrait),
    ];
    const titles: string[] = [];
    for (const [i, upload] of uploads.entries()) {
      const recipe = await server.api.createRecipe(profile.id, {
        title: `Fotorezept ${name}-${v} ${i + 1}`,
        imageId: upload.imageId,
      });
      titles.push(recipe.title);
    }
    // A recipe without photo on top, so the photo cards are lazy ones further down.
    await server.api.createRecipe(profile.id, { title: `Ohne Foto ${name}-${v}` });
    await page.goto(`${server.url}/rezepte`);

    for (const [i, title] of titles.entries()) {
      const item = page.getByRole('listitem').filter({ has: recipeLink(page, title) });
      const img = item.locator('img');
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
        .toBe(true);
      const shown: ShownImage = await img.evaluate(async (el: HTMLImageElement) => {
        // naturalWidth of a srcset image is density-corrected (file width ÷ the w-descriptor density), so
        // the file's real pixel width comes from the same URL loaded without srcset (from the cache).
        const file = new Image();
        file.src = el.currentSrc;
        await file.decode();
        return {
          natural: file.naturalWidth,
          displayed: el.getBoundingClientRect().width,
          dpr: window.devicePixelRatio,
          src: new URL(el.currentSrc).pathname,
        };
      });
      const upload = uploads[i];
      if (!upload) throw new Error('Upload fehlt');
      const size = viewport ? `${viewport.width}×${viewport.height}` : test.info().project.name;
      const where = `${size}, ${i === 0 ? 'Querformat' : 'Hochformat'}: ${JSON.stringify(shown)}`;
      test.info().annotations.push({ type: 'Bild', description: where });
      expect(shown.dpr, 'emulierte Pixeldichte').toBe(test.info().project.use.deviceScaleFactor ?? 1);
      if (layout === 'rows') expect(Math.round(shown.displayed), where).toBe(112);
      // Sharp: at least as many pixels as displayed × min(DPR, 2).
      expect(shown.natural, where).toBeGreaterThanOrEqual(Math.ceil(shown.displayed * dprCap));
      expect(shown.src, where).not.toMatch(/-l\.webp$/);
      // At most 2×: where s covers displayed × 2, the list loads s and never m.
      if (720 >= shown.displayed * dprCap) {
        expect(shown.src, where).toBe(upload.urls.s);
        expect(media, where).not.toContain(upload.urls.m);
      } else {
        expect(shown.src, where).toBe(upload.urls.m);
      }
    }
  }
  expect(
    media.filter((p) => p.endsWith('-l.webp')),
    'die Liste lädt nie die Variante l',
  ).toEqual([]);
}

test('e8: Kartenbilder am Handy sind scharf, höchstens 2× und nie l @phone', async ({ page, server }) => {
  await checkListImages(page, server, 'cards');
});

test('e8: Kartenbilder am iPad hochkant (744–834 px) sind scharf, höchstens 2× und nie l @tablet', async ({
  page,
  server,
}) => {
  // iPad mini and 9.7" load s (cards ≤ 360 px); 10.2" and 11" need m for 2× (cards 377 and 389 px).
  await checkListImages(page, server, 'cards', IPAD_PORTRAIT_WIDTHS);
});

test('e8: kleine Listenbilder am iPad quer sind scharf und nie l @tablet', async ({ page, server }) => {
  await checkListImages(page, server, 'rows');
});
