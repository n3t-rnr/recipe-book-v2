// Timeouts (NF-09 AK: requests give up after 10 s and offer „Erneut versuchen“; Kap. 6.6 row
// „Zeitüberschreitung (10 s) | Toast „Das dauert zu lange“ | „Erneut versuchen““).
// A WLAN that swallows a request: page.route holds it without an answer, and the page clock (page.clock)
// passes the 10 s of lib/api.ts at once. Then the requests get through again and „Erneut versuchen“ in the
// toast must repeat exactly the failed one.
// - list: „Aktualisieren“ (also a retry that times out again), the last list stays, no offline banner
// - detail: „In den Papierkorb“ and the toast's „Rückgängig“; trash: „Wiederherstellen“; Mehr: delete a
//   profile; Status: „Aktualisieren“
// - tags (M4): while GET /tags hangs the chip row shows only „Alle Tags …“ (its height kept); the filter
//   sheet shows skeleton chips, then the error with „Erneut versuchen“; „Aktualisieren“ and the
//   reconnection load the tags again (F-24, F-33, NF-09 AK4, amendment 2)
// Lower level: tests/unit/state-toast.test.ts (toast.error offers the retry only for TIMEOUT and NETWORK),
// tests/unit/state-tags.test.ts (tag store: stale, errors, late answers).
import type { Locator, Page, Request, Route } from '@playwright/test';
import { ds } from '../../client/src/i18n/de-screens.ts';
import { df } from '../../client/src/i18n/de-screens-filter.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';

const TIMEOUT_TEXT = 'Das dauert zu lange';
const LIST = '/api/v1/recipes';
const TAGS = '/api/v1/tags';

/**
 * Holds every `method` request to `pathname` without an answer until release(); the app gives up after
 * its 10 s. Held requests stay unanswered (the page aborted them), later ones get through.
 */
async function hold(page: Page, method: string, pathname: string): Promise<{ release: () => Promise<void> }> {
  const matches = (url: URL): boolean => url.pathname === pathname;
  const handler = (route: Route): Promise<void> | undefined =>
    route.request().method() === method ? undefined : route.fallback();
  await page.route(matches, handler);
  return { release: () => page.unroute(matches, handler) };
}

/** Resolves once the page sent a `method` request to `pathname`: the 10 s timer of lib/api.ts runs. */
function sent(page: Page, method: string, pathname: string): Promise<Request> {
  return page.waitForRequest((req) => req.method() === method && new URL(req.url()).pathname === pathname);
}

/** The toast host (aria-live) while it shows `message`. */
function toastWith(page: Page, message: string): Locator {
  return page.locator('[aria-live="polite"]').filter({ has: page.getByText(message, { exact: true }) });
}

function recipeLink(page: Page, title: string): Locator {
  return page.getByRole('link', { name: title, exact: true });
}

async function recipeStatus(server: AppServer, profileId: number, id: number): Promise<number> {
  return (await server.api.request('GET', `/api/v1/recipes/${id}`, { profileId })).status;
}

test('Liste: „Aktualisieren“ ohne Antwort zeigt nach 10 s „Das dauert zu lange“ mit „Erneut versuchen“, das die Liste neu lädt @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const profile = await freshServer.api.createProfile('Zeit');
  const before = await freshServer.api.createRecipe(profile.id, { title: 'Vor der Zeitüberschreitung' });
  await page.clock.install();
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte`);
  await expect(recipeLink(page, before.title)).toBeVisible();
  await expect(page.getByText('1 Rezept', { exact: true })).toBeVisible();
  // Changed meanwhile (another device): only a reload that gets through shows it.
  const after = await freshServer.api.createRecipe(profile.id, { title: 'Nach der Zeitüberschreitung' });

  const held = await hold(page, 'GET', LIST);
  let request = sent(page, 'GET', LIST);
  await page.getByRole('button', { name: 'Aktualisieren' }).click();
  await request;
  const toast = toastWith(page, TIMEOUT_TEXT);
  await page.clock.fastForward(8_000);
  await expect(toast, 'vor Ablauf der 10 s noch kein Toast').toHaveCount(0);
  await page.clock.fastForward(2_000);
  await expect(toast).toBeVisible();
  const retry = toast.getByRole('button', { name: 'Erneut versuchen' });
  await expect(retry).toBeEnabled();
  // Slow, not offline: no banner, and the last list stays visible (F-33).
  await expect(page.getByRole('alert').filter({ hasText: 'Server nicht erreichbar' })).toHaveCount(0);
  await expect(recipeLink(page, before.title)).toBeVisible();
  await expect(recipeLink(page, after.title)).toHaveCount(0);
  await expect(page.getByText('1 Rezept', { exact: true })).toBeVisible();

  // The retry is a request of its own with the same 10 s: while the WLAN still swallows it, the toast
  // waits with a disabled button and then offers „Erneut versuchen“ again.
  request = sent(page, 'GET', LIST);
  await retry.click();
  await request;
  await expect(retry).toBeDisabled();
  await page.clock.fastForward(10_000);
  await expect(toast).toHaveCount(1);
  await expect(retry).toBeEnabled();
  await expect(recipeLink(page, after.title)).toHaveCount(0);

  await held.release();
  await retry.click();
  await expect(recipeLink(page, after.title)).toBeVisible();
  await expect(recipeLink(page, before.title)).toBeVisible();
  await expect(page.getByText('2 Rezepte', { exact: true })).toBeVisible();
  await expect(toast).toHaveCount(0);
});

test('Detail: „In den Papierkorb“ ohne Antwort bietet nach 10 s „Erneut versuchen“; der zweite Versuch löscht @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const profile = await freshServer.api.createProfile('Zeit');
  const recipe = await freshServer.api.createRecipe(profile.id, { title: 'Zwiebelkuchen' });
  const target = `/api/v1/recipes/${recipe.id}`;
  await page.clock.install();
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte/${recipe.id}`);
  const heading = page.getByRole('heading', { level: 1, name: recipe.title, exact: true });
  await expect(heading).toBeVisible();

  const held = await hold(page, 'DELETE', target);
  const request = sent(page, 'DELETE', target);
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page
    .getByRole('dialog', { name: 'Weitere Aktionen' })
    .getByRole('button', { name: 'In den Papierkorb' })
    .click();
  await request;
  await page.clock.fastForward(10_000);
  const toast = toastWith(page, TIMEOUT_TEXT);
  await expect(toast).toBeVisible();
  // Nothing happened: the recipe stays open and on the server.
  await expect(heading).toBeVisible();
  expect(await recipeStatus(freshServer, profile.id, recipe.id)).toBe(200);

  await held.release();
  await toast.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(toastWith(page, 'Rezept gelöscht')).toBeVisible();
  await expect(toast).toHaveCount(0);
  await expect(page).toHaveURL(`${freshServer.url}/rezepte`);
  expect(await recipeStatus(freshServer, profile.id, recipe.id)).toBe(410);
});

test('Detail: „Rückgängig“ ohne Antwort bietet nach 10 s „Erneut versuchen“; der zweite Versuch stellt wieder her @phone @desktop', async ({
  page,
  freshServer,
}) => {
  const profile = await freshServer.api.createProfile('Zeit');
  const recipe = await freshServer.api.createRecipe(profile.id, { title: 'Linsensuppe' });
  const target = `/api/v1/recipes/${recipe.id}/restore`;
  await page.clock.install();
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte/${recipe.id}`);
  await expect(page.getByRole('heading', { level: 1, name: recipe.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page
    .getByRole('dialog', { name: 'Weitere Aktionen' })
    .getByRole('button', { name: 'In den Papierkorb' })
    .click();
  const deleted = toastWith(page, 'Rezept gelöscht');
  await expect(deleted).toBeVisible();
  // The detail waits up to 400 ms (page clock) for the closed menu to leave the history, then goes back.
  await page.clock.runFor(500);
  await expect(page).toHaveURL(`${freshServer.url}/rezepte`);

  // „Rückgängig“ is a request too: without an answer it must offer „Erneut versuchen“ (NF-09).
  const held = await hold(page, 'POST', target);
  const request = sent(page, 'POST', target);
  await deleted.getByRole('button', { name: 'Rückgängig' }).click();
  await request;
  await page.clock.fastForward(10_000);
  const toast = toastWith(page, TIMEOUT_TEXT);
  await expect(toast).toBeVisible();
  expect(await recipeStatus(freshServer, profile.id, recipe.id)).toBe(410);

  await held.release();
  await toast.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(toast).toHaveCount(0);
  expect(await recipeStatus(freshServer, profile.id, recipe.id)).toBe(200);
  // The new data revision reloads the list, which shows the recipe again.
  await expect(recipeLink(page, recipe.title)).toBeVisible();
});

test('Papierkorb: „Wiederherstellen“ ohne Antwort bietet nach 10 s „Erneut versuchen“; der zweite Versuch stellt wieder her @phone @desktop', async ({
  page,
  freshServer,
}) => {
  const profile = await freshServer.api.createProfile('Zeit');
  const recipe = await freshServer.api.createRecipe(profile.id, { title: 'Apfelstrudel' });
  const deleted = await freshServer.api.request('DELETE', `/api/v1/recipes/${recipe.id}`, {
    profileId: profile.id,
  });
  expect(deleted.ok).toBe(true);
  const target = `/api/v1/recipes/${recipe.id}/restore`;
  await page.clock.install();
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/mehr/papierkorb`);
  const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: recipe.title }) });
  await expect(item).toBeVisible();

  const held = await hold(page, 'POST', target);
  const request = sent(page, 'POST', target);
  await item.getByRole('button', { name: 'Wiederherstellen' }).click();
  await request;
  await page.clock.fastForward(10_000);
  const toast = toastWith(page, TIMEOUT_TEXT);
  await expect(toast).toBeVisible();
  await expect(item).toBeVisible();
  expect(await recipeStatus(freshServer, profile.id, recipe.id)).toBe(410);

  await held.release();
  await toast.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(toastWith(page, `„${recipe.title}“ wiederhergestellt`)).toBeVisible();
  await expect(item).toHaveCount(0);
  expect(await recipeStatus(freshServer, profile.id, recipe.id)).toBe(200);
});

test('Mehr: „Profil löschen“ ohne Antwort bietet nach 10 s „Erneut versuchen“; der zweite Versuch löscht @phone @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await freshServer.api.createProfile('Ben');
  const target = `/api/v1/profiles/${anna.id}`;
  await page.clock.install();
  await useProfile(page, anna.id);
  await page.goto(`${freshServer.url}/mehr`);
  await expect(page.getByText('Anna', { exact: true })).toBeVisible();

  const held = await hold(page, 'DELETE', target);
  const request = sent(page, 'DELETE', target);
  await page.getByRole('button', { name: 'Profil löschen' }).click();
  await page
    .getByRole('alertdialog', { name: 'Profil „Anna“ löschen?' })
    .getByRole('button', { name: 'Profil löschen' })
    .click();
  await request;
  await page.clock.fastForward(10_000);
  const toast = toastWith(page, TIMEOUT_TEXT);
  await expect(toast).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const profiles = async (): Promise<string[]> => {
    const res = await freshServer.api.request('GET', '/api/v1/profiles');
    return ((await res.json()) as { profiles: Array<{ name: string }> }).profiles.map((p) => p.name);
  };
  expect(await profiles()).toEqual(['Anna', 'Ben']);

  await held.release();
  await toast.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(toastWith(page, 'Profil „Anna“ gelöscht')).toBeVisible();
  expect(await profiles()).toEqual(['Ben']);
});

test('Status: „Aktualisieren“ ohne Antwort zeigt nach 10 s „Das dauert zu lange“ mit „Erneut versuchen“ @phone @desktop', async ({
  page,
  server,
}) => {
  const health = '/api/v1/health';
  await page.clock.install();
  await page.goto(`${server.url}/mehr/status`);
  const version = page.getByText('Version', { exact: true });
  await expect(version).toBeVisible();

  const held = await hold(page, 'GET', health);
  const request = sent(page, 'GET', health);
  await page.getByRole('button', { name: 'Aktualisieren' }).click();
  await request;
  await page.clock.fastForward(10_000);
  const toast = toastWith(page, TIMEOUT_TEXT);
  await expect(toast).toBeVisible();
  // The last state stays visible.
  await expect(version).toBeVisible();

  await held.release();
  const answered = page.waitForResponse((res) => new URL(res.url()).pathname === health && res.ok());
  await toast.getByRole('button', { name: 'Erneut versuchen' }).click();
  await answered;
  await expect(toast).toHaveCount(0);
  await expect(version).toBeVisible();
});

// --- M4: the tag list of the chip row and the filter sheet

function chips(page: Page): Locator {
  return page.getByRole('group', { name: ds.list.chips }).getByRole('button');
}

/** A profile with a recipe tagged „Suppe“ (the fresh server also has the 10 start tags). */
async function listWithTags(page: Page, server: AppServer): Promise<void> {
  const profile = await server.api.createProfile('Zeit');
  await server.api.createRecipe(profile.id, { title: 'Linsensuppe', tags: ['Suppe'] });
  await useProfile(page, profile.id);
}

test('Tags: hängt GET /tags, zeigt die Chip-Reihe nur „Alle Tags …“; nach der Wiederverbindung erscheinen die Tags @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  await listWithTags(page, freshServer);
  await page.clock.install();
  const held = await hold(page, 'GET', TAGS);
  const request = sent(page, 'GET', TAGS);
  await page.goto(`${freshServer.url}/rezepte`);
  await request;
  await expect(recipeLink(page, 'Linsensuppe')).toBeVisible();
  await expect(chips(page)).toHaveText([ds.list.allTags]);
  // The row keeps the height of a chip row, so the tags push nothing down when they come (NF-06).
  const row = page.getByRole('group', { name: ds.list.chips });
  expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(58);
  const countTop = await page.locator('main p.count').evaluate((el) => el.getBoundingClientRect().top);
  // The app gives up after its 10 s; the chip row stays as it is.
  await page.clock.fastForward(10_000);
  await expect(chips(page)).toHaveText([ds.list.allTags]);
  await held.release();

  // Then the server is unreachable („Aktualisieren“ fails, its tag request too) …
  await page.route('**/api/v1/**', (route) => route.abort('connectionrefused'));
  await page.getByRole('button', { name: 'Aktualisieren' }).click();
  const banner = page.getByRole('alert').filter({ hasText: 'Server nicht erreichbar' });
  await expect(banner).toBeVisible();
  await expect(chips(page)).toHaveText([ds.list.allTags]);
  await page.unroute('**/api/v1/**');

  // … and answers again: the reconnection loads the tags (NF-09 AK4).
  await banner.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(banner).toHaveCount(0);
  await expect(chips(page).first()).toHaveText('Suppe');
  await expect(chips(page)).toHaveCount(11);
  await expect(chips(page).last()).toHaveText(ds.list.allTags);
  expect(await page.locator('main p.count').evaluate((el) => el.getBoundingClientRect().top)).toBe(countTop);
});

test('Tags: ohne Antwort zeigt das Filter-Sheet erst Platzhalter, nach 10 s den Fehler mit „Erneut versuchen“, das die Tags lädt @phone @desktop', async ({
  page,
  freshServer,
}) => {
  await listWithTags(page, freshServer);
  await page.clock.install();
  const held = await hold(page, 'GET', TAGS);
  let request = sent(page, 'GET', TAGS);
  await page.goto(`${freshServer.url}/rezepte`);
  await request;
  await expect(recipeLink(page, 'Linsensuppe')).toBeVisible();

  await page.getByRole('button', { name: ds.list.filter(0), exact: true }).click();
  const sheet = page.getByRole('dialog', { name: df.title });
  await expect(sheet).toBeVisible();
  // Loading: chip-sized placeholders, announced as loading.
  await expect(sheet.getByRole('status')).toHaveText('Lädt …');
  await expect(sheet.locator('[aria-busy="true"]')).toBeVisible();
  await page.clock.fastForward(10_000);
  await expect(sheet.getByText(TIMEOUT_TEXT)).toBeVisible();
  const retry = sheet.getByRole('button', { name: 'Erneut versuchen' });
  await expect(retry).toBeVisible();
  // The rest of the sheet works meanwhile.
  await expect(sheet.getByRole('radio', { name: 'Neueste' })).toHaveAttribute('aria-checked', 'true');

  await held.release();
  request = sent(page, 'GET', TAGS);
  await retry.click();
  await request;
  await expect(sheet.getByRole('button', { name: 'Suppe 1', exact: true })).toBeVisible();
  await expect(sheet.getByText(TIMEOUT_TEXT)).toHaveCount(0);
  await sheet.getByRole('button', { name: df.close }).click();
  await expect(chips(page).first()).toHaveText('Suppe');
});

test('Tags: nach einer Zeitüberschreitung lädt „Aktualisieren“ die Tags der Chip-Reihe neu @phone @desktop', async ({
  page,
  freshServer,
}) => {
  await listWithTags(page, freshServer);
  await page.clock.install();
  const held = await hold(page, 'GET', TAGS);
  const request = sent(page, 'GET', TAGS);
  await page.goto(`${freshServer.url}/rezepte`);
  await request;
  await expect(recipeLink(page, 'Linsensuppe')).toBeVisible();
  await page.clock.fastForward(10_000);
  await expect(chips(page)).toHaveText([ds.list.allTags]);
  // The list is there, so the failed tag list shows no toast of its own.
  await expect(toastWith(page, TIMEOUT_TEXT)).toHaveCount(0);

  await held.release();
  await page.getByRole('button', { name: 'Aktualisieren' }).click();
  await expect(chips(page).first()).toHaveText('Suppe');
  await expect(chips(page)).toHaveCount(11);
});
