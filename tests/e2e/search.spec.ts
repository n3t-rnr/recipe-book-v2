// Search in the recipe list (F-21, F-22, F-23, F-33, Kap. 6.3 and 6.4), end to end:
// - M4 DoD: „kaese“, „suppe“ and „zwieb“ on the 1,000 seeded recipes (NF-04 data set).
// - F-21 AK: hits ≤ 300 ms after the last key and at most one running search request; the search starts at
//   2 characters with 150 ms debounce (amendment 16); old hits stay visible until the new ones are there,
//   and the outdated request is aborted.
// - F-23/F-33: „Nichts gefunden für ‚Spazle‘“, „Meintest du: Spätzle?“ (a tap searches), „Rezept ‚…‘
//   anlegen“ takes the term as title (cut to the title limit, never inside an emoji); a filter by tags only
//   offers no create button. After „Meintest du“ or „Filter zurücksetzen“ a tap leaves the focus on the count
//   line (no on-screen keyboard over the hits), the keyboard puts it into the search field (NF-11).
// - Kap. 6.3: sticky search field, type search with 16 px text; Enter searches at once, closes the keyboard
//   and submits nothing; Kap. 6.4: "/" focuses the search.
// - NF-09: a search while the server is stopped shows its hits after the reconnection; a chunk that failed
//   (the no-hits part) leaves the count row, without an uncaught error or a loop of list requests.
// Lower levels: tests/api/recipe-search.test.ts, tests/api/search-seed.test.ts (ranking, spellings),
// tests/unit/list-query.test.ts (URL model, debounce constant), tests/unit/screens-markup.test.ts.
import type { Locator, Page, Request } from '@playwright/test';
import { deEditor } from '../../client/src/i18n/de-editor.ts';
import { ds } from '../../client/src/i18n/de-screens.ts';
import { df } from '../../client/src/i18n/de-screens-filter.ts';
import { LIMITS } from '../../shared/constants.ts';
import type { Profile, RecipeListPage } from '../../shared/types.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';

let seq = 0;

/** Unique suffix per test run: the worker server is shared by the tests of one worker. */
function uid(): string {
  seq += 1;
  const project = test.info().project.name.replace('-chromium', 'c').replace('-webkit', 'w').replace('-', '');
  return `${project}${process.pid.toString(36)}x${seq}`;
}

function searchBox(page: Page): Locator {
  return page.getByRole('searchbox', { name: ds.list.search, exact: true });
}

/** The first recipe link with this title (the seed data has a few titles twice). */
function recipeLink(page: Page, title: string): Locator {
  return page.getByRole('main').getByRole('link', { name: title, exact: true }).first();
}

function countText(page: Page): Locator {
  return page.locator('main p.count');
}

/** A profile of the seeded server (read only: tests must not add data there). */
async function seededProfile(server: AppServer): Promise<number> {
  const res = await server.api.request('GET', '/api/v1/profiles');
  const { profiles } = (await res.json()) as { profiles: Profile[] };
  const first = profiles[0];
  if (!first) throw new Error('Der Seed-Server hat kein Profil');
  return first.id;
}

/** A GET /recipes request that searches (has q=). */
function isSearch(req: Request): boolean {
  const url = new URL(req.url());
  return req.method() === 'GET' && url.pathname === '/api/v1/recipes' && url.searchParams.has('q');
}

/** Counts search requests and the most that ran at the same time. */
function watchSearches(page: Page): { sent: () => number; maxRunning: () => number } {
  let sent = 0;
  let running = 0;
  let max = 0;
  page.on('request', (req) => {
    if (!isSearch(req)) return;
    sent += 1;
    running += 1;
    max = Math.max(max, running);
  });
  const done = (req: Request): void => {
    if (isSearch(req)) running -= 1;
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return { sent: () => sent, maxRunning: () => max };
}

/** Types into the search field like a person (one key after the other). */
async function typeSearch(page: Page, text: string, delay = 60): Promise<void> {
  await searchBox(page).pressSequentially(text, { delay });
}

test('M4-DoD: „kaese“, „suppe“ und „zwieb“ liefern die erwarteten Treffer @phone @tablet @desktop', async ({
  page,
  seededServer,
}) => {
  await useProfile(page, await seededProfile(seededServer));
  await page.goto(`${seededServer.url}/rezepte`);
  await expect(countText(page)).toHaveText('1.000 Rezepte');

  // F-22: „kaese“ is a spelling of „käse“; title hits come first (F-21).
  await searchBox(page).fill('kaese');
  await expect(page).toHaveURL(/\?q=kaese$/);
  await expect(recipeLink(page, 'Käsekuchen')).toBeAttached();
  await expect(recipeLink(page, 'Käsespätzle')).toBeAttached();
  await expect(countText(page)).toHaveText(/^\d+ von 1\.000 Rezepten$/);

  await searchBox(page).fill('suppe');
  await expect(page).toHaveURL(/\?q=suppe$/);
  await expect(recipeLink(page, 'Kürbissuppe')).toBeAttached();
  await expect(recipeLink(page, 'Tomatensuppe')).toBeAttached();

  // F-21 AK: „zwieb“ also finds recipes that have onions only as an ingredient.
  await searchBox(page).fill('zwieb');
  await expect(page).toHaveURL(/\?q=zwieb$/);
  await expect(recipeLink(page, 'Zwiebelkuchen')).toBeAttached();
  await expect(countText(page)).toHaveText(/^\d+ von 1\.000 Rezepten$/);
  const hits = Number(((await countText(page).textContent()) ?? '').split(' ')[0]?.replace('.', ''));
  expect(hits, 'Treffer für „zwieb“').toBeGreaterThan(10);
  // More hits than titles with „Zwiebel“: the rest has onions only as an ingredient (or in the steps).
  let titleHits = 0;
  let cursor: string | null = null;
  do {
    const next: RecipeListPage = await seededServer.api.list(
      `q=zwieb&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    titleHits += next.items.filter((item) => /zwieb/i.test(item.title)).length;
    cursor = next.nextCursor;
  } while (cursor);
  expect(hits, 'Treffer ohne „Zwiebel“ im Titel').toBeGreaterThan(titleHits);
});

test('F-21: ab 2 Zeichen mit Debounce; Treffer ≤ 300 ms nach der letzten Eingabe, höchstens eine laufende Suchanfrage @phone @desktop', async ({
  page,
  seededServer,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'Zeitmessung nur in Chromium (Kap. 9: Timing in pnpm perf und Chromium-E2E)',
  );
  await useProfile(page, await seededProfile(seededServer));
  // The expected first hit and count, from the server itself.
  const expected = await seededServer.api.list('q=kartoffel%20k%C3%A4se');
  const first = expected.items[0]?.title;
  expect(first, 'es gibt Rezepte mit Kartoffel und Käse').toBeDefined();
  const count = `${expected.total.toLocaleString('de-DE')} von 1.000 Rezepten`;

  await page.goto(`${seededServer.url}/rezepte`);
  await expect(countText(page)).toHaveText('1.000 Rezepte');
  const searches = watchSearches(page);

  // One character does not search (F-21: „startet ab 2 Zeichen“).
  await typeSearch(page, 'k');
  await page.waitForTimeout(500);
  expect(searches.sent(), 'keine Suchanfrage für „k“').toBe(0);
  await page.getByRole('button', { name: ds.list.clearSearch }).click();
  await expect(searchBox(page)).toHaveValue('');

  await page.evaluate(() => {
    const w = window as unknown as { __lastInput: number };
    w.__lastInput = 0;
    document.addEventListener('input', () => (w.__lastInput = performance.now()), true);
  });
  await typeSearch(page, 'kartoffel käse', 40);
  const elapsed = await page.evaluate(
    ({ title, text }) =>
      new Promise<number>((resolve) => {
        const check = (): void => {
          const link = document.querySelector('main ul.items li a');
          const shown = document.querySelector('main p.count')?.textContent?.trim();
          if (link?.textContent?.trim() === title && shown === text) {
            resolve(performance.now() - (window as unknown as { __lastInput: number }).__lastInput);
          } else requestAnimationFrame(check);
        };
        check();
      }),
    { title: first, text: count },
  );
  test.info().annotations.push({
    type: 'F-21',
    description: `Treffer ${Math.round(elapsed)} ms nach der letzten Taste`,
  });
  expect(elapsed, 'Treffer ≤ 300 ms nach der letzten Eingabe').toBeLessThanOrEqual(300);
  await expect(page).toHaveURL(/\?q=kartoffel(%20|\+)k%C3%A4se$/);
  expect(searches.maxRunning(), 'höchstens eine laufende Suchanfrage').toBeLessThanOrEqual(1);
  // 150 ms debounce: 40 ms per key give no request before the last key.
  expect(searches.sent(), 'Suchanfragen beim Tippen von „kartoffel käse“').toBeLessThanOrEqual(2);
  expect(searches.sent()).toBeGreaterThanOrEqual(1);
});

test('F-21: bisherige Treffer bleiben sichtbar, bis neue da sind; die veraltete Anfrage wird abgebrochen @desktop', async ({
  page,
  seededServer,
}) => {
  await useProfile(page, await seededProfile(seededServer));
  await page.goto(`${seededServer.url}/rezepte?q=suppe`);
  const old = recipeLink(page, 'Kürbissuppe');
  await expect(old).toBeVisible();
  await expect(searchBox(page)).toHaveValue('suppe');

  // A slow WLAN: every new search answers after 800 ms.
  await page.route(
    (url) => url.pathname === '/api/v1/recipes' && url.searchParams.has('q'),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue().catch(() => {});
    },
  );
  const failed: string[] = [];
  page.on('requestfailed', (req) => {
    if (isSearch(req)) failed.push(new URL(req.url()).searchParams.get('q') ?? '');
  });
  const firstSent = page.waitForRequest(
    (req) => isSearch(req) && new URL(req.url()).searchParams.get('q') === 'kase',
  );
  await searchBox(page).fill('kase');
  await firstSent;
  // While the answer is on its way: the old hits, no skeletons, the list marked busy.
  await expect(old).toBeVisible();
  await expect(page.getByRole('main').getByRole('list')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Lädt …' })).toHaveCount(0);

  // A newer search replaces the running one: that request is aborted (F-21 „veraltete Anfragen werden
  // abgebrochen“), the old hits still stay.
  const secondSent = page.waitForRequest(
    (req) => isSearch(req) && new URL(req.url()).searchParams.get('q') === 'kaese',
  );
  await searchBox(page).fill('kaese');
  await secondSent;
  await expect.poll(() => failed).toContain('kase');
  await expect(old).toBeVisible();

  await expect(recipeLink(page, 'Käsekuchen')).toBeVisible();
  await expect(old).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('list')).toHaveAttribute('aria-busy', 'false');
});

/** A tap on touch devices, else a click: both are pointer activations (click detail 1). */
async function press(target: Locator, hasTouch: boolean): Promise<void> {
  if (hasTouch) await target.tap();
  else await target.click();
}

test('F-23/F-33: „Spazle“ zeigt „Nichts gefunden für ‚Spazle‘“ und „Meintest du: Spätzle?“; der Fingertipp sucht „Spätzle“ ohne Bildschirmtastatur, die Tastatur führt ins Suchfeld @phone @tablet @desktop', async ({
  page,
  freshServer,
  hasTouch,
}) => {
  const profile = await freshServer.api.createProfile('Anna');
  await freshServer.api.createRecipe(profile.id, {
    title: 'Spätzle mit Linsen',
    ingredients: [{ amount: 250, unit: 'g', name: 'Linsen' }],
  });
  await freshServer.api.createRecipe(profile.id, { title: 'Apfelstrudel' });
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte`);
  await expect(countText(page)).toHaveText('2 Rezepte');

  await typeSearch(page, 'Spazle');
  await expect(page.getByRole('heading', { name: 'Nichts gefunden für ‚Spazle‘' })).toBeVisible();
  // As the user sees it: the suggestion is a button inside the sentence.
  const suggestion = page.getByRole('paragraph').filter({ hasText: df.didYouMean });
  await expect.poll(() => suggestion.innerText()).toBe('Meintest du: Spätzle?');
  await expect(countText(page)).toHaveText('0 von 2 Rezepten');
  await expect(page.getByRole('link', { name: 'Rezept ‚Spazle‘ anlegen' })).toBeVisible();
  await expect(page.getByRole('button', { name: df.reset })).toBeVisible();

  // A tap searches without opening the on-screen keyboard over the hits (or leaving it open): the focus
  // goes to the count line, not to <body> with the button that went (NF-11).
  await press(page.getByRole('button', { name: 'Spätzle', exact: true }), hasTouch);
  await expect(searchBox(page)).toHaveValue('Spätzle');
  await expect(page).toHaveURL(/\?q=Sp%C3%A4tzle$/);
  await expect(recipeLink(page, 'Spätzle mit Linsen')).toBeVisible();
  await expect(countText(page)).toHaveText('1 von 2 Rezepten');
  await expect(page.getByText(/Nichts gefunden/)).toHaveCount(0);
  await expect(countText(page)).toBeFocused();
  await expect(searchBox(page)).not.toBeFocused();

  // From the keyboard the focus goes to the search field, to type on (NF-11).
  const noHits = page.getByRole('heading', { name: 'Nichts gefunden für ‚Spazle‘' });
  await searchBox(page).fill('Spazle');
  await expect(noHits).toBeVisible();
  await page.getByRole('button', { name: 'Spätzle', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(recipeLink(page, 'Spätzle mit Linsen')).toBeVisible();
  await expect(searchBox(page)).toHaveValue('Spätzle');
  await expect(searchBox(page)).toBeFocused();

  // „Filter zurücksetzen“ of the empty result: all recipes; by tap the focus on the count line …
  await searchBox(page).fill('Spazle');
  await expect(noHits).toBeVisible();
  await press(page.getByRole('button', { name: df.reset }), hasTouch);
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(searchBox(page)).toHaveValue('');
  await expect(countText(page)).toHaveText('2 Rezepte');
  await expect(countText(page)).toBeFocused();

  // … by keyboard in the search field.
  await searchBox(page).fill('Spazle');
  await expect(noHits).toBeVisible();
  await page.getByRole('button', { name: df.reset }).focus();
  await page.keyboard.press(' ');
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(countText(page)).toHaveText('2 Rezepte');
  await expect(searchBox(page)).toHaveValue('');
  await expect(searchBox(page)).toBeFocused();
});

test('F-33: „Rezept ‚…‘ anlegen“ öffnet den Editor mit dem Suchbegriff als Titel @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const term = `Quarkauflauf ${uid()}`;
  const profile = await server.api.createProfile(`Anleger ${uid()}`);
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await searchBox(page).fill(term);
  await expect(page.getByRole('heading', { name: `Nichts gefunden für ‚${term}‘` })).toBeVisible();
  const create = page.getByRole('link', { name: `Rezept ‚${term}‘ anlegen` });
  await expect(create).toHaveAttribute('href', `/rezepte/neu?title=${encodeURIComponent(term)}`);
  await create.click();
  await expect(page).toHaveURL(
    new RegExp(`/rezepte/neu\\?title=${encodeURIComponent(term).replaceAll('%20', '(%20|\\+)')}$`),
  );
  await expect(page.getByRole('textbox', { name: deEditor.title.label })).toHaveValue(term);
});

test('F-33: ein langer Suchbegriff mit einem Emoji an der Titelgrenze wird ohne Fehler zum Titel, ohne halbes Emoji @desktop', async ({
  page,
  server,
}) => {
  // 119 characters, then an emoji across the title limit: cutting it in half would make the create
  // link's encodeURIComponent throw and take the list down (uncaught error, fixtures.ts).
  const title = `Zq${uid()}`.padEnd(LIMITS.recipeTitle - 1, 'x');
  const term = `${title}😀`;
  const profile = await server.api.createProfile(`Emoji ${uid()}`);
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await searchBox(page).fill(term);
  await expect(page.getByRole('heading', { name: `Nichts gefunden für ‚${term}‘` })).toBeVisible();
  const create = page.getByRole('link', { name: `Rezept ‚${term}‘ anlegen` });
  await expect(create).toHaveAttribute('href', `/rezepte/neu?title=${encodeURIComponent(title)}`);
  await create.click();
  await expect(page.getByRole('textbox', { name: deEditor.title.label })).toHaveValue(title);
});

test('F-33: ein Tag-Filter ohne Treffer zeigt „Keine Rezepte mit diesen Filtern“ und „Filter zurücksetzen“, aber kein „anlegen“ @desktop', async ({
  page,
  server,
}) => {
  const id = uid();
  const profile = await server.api.createProfile(`Tagfilter ${id}`);
  const a = await server.api.createRecipe(profile.id, { title: `Nur Grill ${id}`, tags: [`Grill${id}`] });
  await server.api.createRecipe(profile.id, { title: `Nur Ofen ${id}`, tags: [`Ofen${id}`] });
  const grill = await server.api.tagIdByName(`Grill${id}`);
  const ofen = await server.api.tagIdByName(`Ofen${id}`);
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte?tags=${grill},${ofen}`);
  await expect(page.getByRole('heading', { name: df.noHitsFiltered })).toBeVisible();
  await expect(page.getByRole('link', { name: /anlegen/ })).toHaveCount(0);
  await expect(page.getByText(/Meintest du/)).toHaveCount(0);
  await expect(countText(page)).toHaveText(/^0 von \d+ Rezepten$/);

  await page.getByRole('button', { name: df.reset }).click();
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(recipeLink(page, a.title)).toBeVisible();
  // A click keeps the focus on the count line, not in the search field (NF-11).
  await expect(countText(page)).toBeFocused();
  await expect(searchBox(page)).not.toBeFocused();
});

/** Collects the list requests (GET /recipes) of the page, across reloads. */
function listRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/api/v1/recipes') urls.push(req.url());
  });
  return urls;
}

test('NF-09: eine Suche bei gestopptem Server zeigt nach der Wiederverbindung ihre Treffer, ohne Anfrageschleife @phone @desktop', async ({
  page,
  freshServer,
}) => {
  const profile = await freshServer.api.createProfile('Offline');
  for (const title of ['Kürbissuppe', 'Linsensuppe', 'Apfelkuchen']) {
    await freshServer.api.createRecipe(profile.id, { title });
  }
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte`);
  await expect(countText(page)).toHaveText('3 Rezepte');

  await freshServer.stop();
  await searchBox(page).fill('suppe');
  const banner = page.getByRole('alert').filter({ hasText: 'Server nicht erreichbar' });
  await expect(banner).toBeVisible();
  // The last list stays (F-33).
  await expect(countText(page)).toHaveText('3 Rezepte');

  await freshServer.restart();
  const lists = listRequests(page);
  await banner.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(countText(page)).toHaveText('2 von 3 Rezepten');
  await expect(banner).toHaveCount(0);
  await expect(searchBox(page)).toHaveValue('suppe');
  // The list settles: the part that failed with the server (the empty result, preloaded by the search)
  // does not start one reload after the other.
  const settled = lists.length;
  await page.waitForTimeout(1_500);
  expect(lists.length - settled, 'Listenanfragen nach dem Laden').toBe(0);
  expect(lists.length, 'Listenanfragen seit der Wiederverbindung').toBeLessThanOrEqual(3);
});

test('NF-09: lädt der Teil „Nichts gefunden“ nicht, obwohl der Server antwortet, bleibt die Zählzeile – ohne Fehler und ohne Anfrageschleife @desktop', async ({
  page,
  server,
}) => {
  const term = `Zzgrmpf${uid()}`;
  const profile = await server.api.createProfile(`Lücke ${uid()}`);
  await server.api.createRecipe(profile.id, { title: `Lückenfüller ${uid()}` });
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await expect(countText(page)).toHaveText(/^[\d.]+ Rezepte?$/);
  const all = Number(((await countText(page).textContent()) ?? '').split(' ')[0]?.replaceAll('.', ''));
  // Chromium keeps a failed chunk for the page; here it fails on every try.
  await page.route(/\/assets\/NoHits-[\w-]+\.js$/, (route) => route.abort('connectionrefused'));
  const lists = listRequests(page);
  await searchBox(page).fill(term);
  // No uncaught error (fixtures.ts); the count explains the empty list. The page may reload once.
  await expect(countText(page)).toHaveText(ds.list.countOf(0, all));
  await page.waitForTimeout(1_000);
  await expect(countText(page)).toHaveText(ds.list.countOf(0, all));
  await expect(searchBox(page)).toHaveValue(term);
  const settled = lists.length;
  await page.waitForTimeout(1_500);
  expect(lists.length - settled, 'keine Anfrageschleife').toBe(0);
});

test('Kap. 6.4: „/“ fokussiert die Suche, außer beim Tippen und bei offenem Dialog @desktop', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(`Taste ${uid()}`);
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await expect(page.getByRole('heading', { level: 1, name: 'Rezepte' })).toBeVisible();
  await expect(searchBox(page)).not.toBeFocused();

  await page.keyboard.press('/');
  await expect(searchBox(page)).toBeFocused();
  // Inside the field "/" is a character like any other.
  await page.keyboard.type('a/b');
  await expect(searchBox(page)).toHaveValue('a/b');

  // With a dialog open the key belongs to the dialog.
  await searchBox(page).fill('');
  await page.getByRole('button', { name: ds.list.filter(0) }).click();
  const sheet = page.getByRole('dialog', { name: df.title });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('/');
  await expect(sheet).toBeVisible();
  await expect(searchBox(page)).not.toBeFocused();
});

test('Kap. 6.3: Enter sucht sofort ohne Debounce, schließt die Tastatur und lädt die Seite nicht neu @phone @desktop', async ({
  page,
  server,
}) => {
  const id = uid();
  const title = `Entersuppe ${id}`;
  const profile = await server.api.createProfile(`Enter ${id}`);
  await server.api.createRecipe(profile.id, { title });
  await useProfile(page, profile.id);
  await page.clock.install({ time: new Date('2026-09-25T12:00:00') });
  await page.goto(`${server.url}/rezepte`);
  await expect(countText(page)).toHaveText(/^[\d.]+ Rezepte?$/);
  await expect(page.getByRole('group', { name: ds.list.chips }).getByRole('button').nth(1)).toBeVisible();
  // The clock stands still from here: typing alone never reaches the end of the 150 ms debounce.
  await page.clock.pauseAt(new Date('2026-09-25T12:01:00'));
  await page.evaluate(() => {
    (window as unknown as { __samePage: boolean }).__samePage = true;
  });
  const searches = watchSearches(page);
  await searchBox(page).fill(title);
  await page.waitForTimeout(300);
  expect(searches.sent(), 'keine Suche vor Enter').toBe(0);

  const sent = page.waitForRequest(isSearch);
  await searchBox(page).press('Enter');
  expect(new URL((await sent).url()).searchParams.get('q')).toBe(title);
  await expect(recipeLink(page, title)).toBeVisible();
  await expect(countText(page)).toHaveText(/^1 von [\d.]+ Rezept(en)?$/);
  await expect(page).toHaveURL(new RegExp(`\\?q=Entersuppe(%20|\\+)${id}$`));
  // The on-screen keyboard closes (the field loses the focus); the text stays.
  await expect(searchBox(page)).not.toBeFocused();
  await expect(searchBox(page)).toHaveValue(title);
  // No form submission to the server: the same page, one search.
  expect(await page.evaluate(() => (window as unknown as { __samePage?: boolean }).__samePage)).toBe(true);
  expect(searches.sent()).toBe(1);
});

test('Kap. 6.3: das Suchfeld hat 16 px Schrift und bleibt beim Scrollen oben stehen @phone', async ({
  page,
  server,
}) => {
  const id = uid();
  const profile = await server.api.createProfile(`Fix ${id}`);
  for (let i = 1; i <= 12; i++) {
    await server.api.createRecipe(profile.id, { title: `Fixrezept ${id} ${i}` });
  }
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  const box = searchBox(page);
  await expect(box).toHaveAttribute('type', 'search');
  await expect(box).toHaveAttribute('enterkeyhint', 'search');
  const size = await box.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(size, 'Schriftgröße im Suchfeld (NF-15: kein Zoom in iOS)').toBeGreaterThanOrEqual(16);

  await page.evaluate(() => window.scrollBy(0, 2_000));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1_500);
  await expect(page.getByRole('heading', { level: 1, name: 'Rezepte' })).not.toBeInViewport();
  await expect(box).toBeInViewport({ ratio: 1 });
  const field = await box.boundingBox();
  expect(field?.y ?? -1, 'Suchfeld oben am Bildschirm').toBeGreaterThanOrEqual(0);
  expect(field?.y ?? 999, 'Suchfeld oben am Bildschirm').toBeLessThanOrEqual(24);
  const filter = page.getByRole('button', { name: ds.list.filter(0) });
  await expect(filter).toBeInViewport({ ratio: 1 });
  // Nothing of the list shows through the sticky row.
  const covered = await page.evaluate(() => {
    const row = document.querySelector('.search-row');
    if (!row) return 'keine Suchzeile';
    const r = row.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 4, r.top + 4);
    return hit && row.contains(hit) ? '' : (hit?.tagName ?? 'nichts');
  });
  expect(covered, 'die Suchzeile liegt über der Liste').toBe('');
});
