// Manual checklist, area "Profile" (F-01 to F-04), automated in the browser against the production build.
// Covered checklist ids: a1, a2, a3, a4, a5, a6, a7, d9.
// Server rules behind these flows are tested at the API level (tests/api/profiles.test.ts, tests/api/recipes.test.ts)
// and the pure logic in tests/unit (initials, router redirects, profile store, footer texts); this spec checks
// what the user sees and taps. Device-only aspects stay manual: the on-screen keyboard (a1) and real iOS/Android.
import path from 'node:path';
import { type Browser, type BrowserContext, devices, type Locator, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { de, ERROR_TEXTS } from '../../client/src/i18n/de.ts';
import { deEditor } from '../../client/src/i18n/de-editor.ts';
import { ds } from '../../client/src/i18n/de-screens.ts';
import { dl } from '../../client/src/i18n/de-screens-lazy.ts';
import type { Profile, ProfilesResponse, RecipeDetail } from '../../shared/types.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

let counter = 0;

/** A profile or recipe name that no other test on the worker's shared server uses (max. 40 characters). */
function unique(base: string): string {
  counter += 1;
  return `${base} ${test.info().project.name} ${test.info().workerIndex}.${counter}`;
}

/**
 * Taps on touch devices (phone, iPad), clicks on the PC. Exception: links in WebKit are clicked, not tapped.
 * Playwright's WebKit on Windows sometimes builds the click of a tap with shiftKey=true from the OS modifier
 * state (reproduced: 1 in 50 taps; its touch and pointer events had shiftKey=false). The router rightly
 * leaves Shift+click to the browser, which opens the link in a new window, so the test would fail for a
 * reason a real iPhone never has. The router only listens to "click", so the path through the app is the same.
 */
async function press(target: Locator): Promise<void> {
  const { hasTouch, defaultBrowserType } = test.info().project.use;
  const tap =
    hasTouch &&
    !(defaultBrowserType === 'webkit' && (await target.evaluate((el) => el.closest('a') !== null)));
  if (tap) await target.tap();
  else await target.click();
}

/** The avatar button of the active profile (header on phones/tablet portrait, rail from 1024 px). */
function avatarButton(page: Page, name?: string): Locator {
  return page.getByRole('button', {
    name: name === undefined ? /^Profil wechseln, aktiv: / : de.profile.switchLabel(name),
    exact: name !== undefined,
  });
}

function profileSheet(page: Page): Locator {
  return page.getByRole('dialog', { name: de.profile.switchTitle });
}

async function listProfiles(server: AppServer): Promise<Profile[]> {
  const res = await server.api.request('GET', '/api/v1/profiles');
  expect(res.status).toBe(200);
  return ((await res.json()) as ProfilesResponse).profiles;
}

async function initialsOf(server: AppServer, id: number): Promise<string> {
  const found = (await listProfiles(server)).find((p) => p.id === id);
  if (!found) throw new Error(`Profil ${id} fehlt`);
  return found.initials;
}

function storedProfileId(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('profileId'));
}

/** Writes ratings and favorites straight into the server's database (their UI follows with M5). */
function addRatingsAndFavorites(
  server: AppServer,
  profileId: number,
  ratings: readonly number[],
  favorites: readonly number[],
): void {
  const db = new Database(path.join(server.dataDir, 'rezepte.sqlite'));
  try {
    db.pragma('busy_timeout = 5000');
    const rate = db.prepare('INSERT INTO ratings (profile_id, recipe_id, stars) VALUES (?, ?, 4)');
    const fav = db.prepare('INSERT INTO favorites (profile_id, recipe_id) VALUES (?, ?)');
    db.transaction(() => {
      for (const id of ratings) rate.run(profileId, id);
      for (const id of favorites) fav.run(profileId, id);
    })();
  } finally {
    db.close();
  }
}

/** Ratings and favorites of `profileId` still in the server's database. */
function countRatingsAndFavorites(
  server: AppServer,
  profileId: number,
): { ratings: number; favorites: number } {
  const db = new Database(path.join(server.dataDir, 'rezepte.sqlite'));
  try {
    db.pragma('busy_timeout = 5000');
    const count = (table: 'ratings' | 'favorites'): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE profile_id = ?`).get(profileId) as { n: number })
        .n;
    return { ratings: count('ratings'), favorites: count('favorites') };
  } finally {
    db.close();
  }
}

/**
 * A second device: an iPad in landscape with the test's locale. Like the fixture guard for `page`, it
 * collects uncaught browser errors and CSP violations; the test expects the list to stay empty.
 */
async function openTablet(
  browser: Browser,
): Promise<{ context: BrowserContext; tablet: Page; errors: string[] }> {
  const { defaultBrowserType: _ignored, ...ipad } = devices['iPad (gen 7)'];
  const context = await browser.newContext({
    ...ipad,
    viewport: { width: 1024, height: 768 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  const tablet = await context.newPage();
  const errors: string[] = [];
  tablet.on('pageerror', (error) => errors.push(`Tablet, Fehler im Browser: ${error.message}`));
  await tablet.exposeFunction('__e2eTabletCsp', (text: string) =>
    errors.push(`Tablet, CSP-Verstoß: ${text}`),
  );
  await tablet.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const w = window as unknown as { __e2eTabletCsp?: (text: string) => void };
      w.__e2eTabletCsp?.(`${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}`);
    });
  });
  return { context, tablet, errors };
}

// ---------------------------------------------------------------------------------------------------------
// a1, a7: first start with an empty database (F-02, F-33)
// ---------------------------------------------------------------------------------------------------------

test('a1: leere Datenbank – Namensfeld hat den Fokus, Enter legt das Profil an und öffnet die Liste @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  await page.goto(`${freshServer.url}/`);
  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.getByRole('heading', { name: de.titles.profile, level: 1 })).toBeVisible();
  await expect(page.getByText(dl.profilePick.leadEmpty)).toBeVisible();

  // The form stands there directly: no tiles, no "Abbrechen", the name field has the focus.
  const name = page.getByRole('textbox', { name: dl.profilePick.name });
  await expect(name).toBeFocused();
  // What the on-screen keyboard gets from the field: a text keyboard with "Fertig"/Enter that submits.
  await expect(name).toHaveAttribute('type', 'text');
  await expect(name).toHaveAttribute('enterkeyhint', 'done');
  await expect(name).toBeEditable();
  await expect(page.getByRole('button', { name: de.common.cancel })).toHaveCount(0);
  const submit = page.getByRole('button', { name: dl.profilePick.create });
  await expect(submit).toBeDisabled();

  // Enter on a blank name creates nothing.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/profil$/);
  expect(await listProfiles(freshServer)).toEqual([]);

  // On the phone the tester taps into the field once so the keyboard opens; the focus stays there.
  await press(name);
  await expect(name).toBeFocused();
  await page.keyboard.type('Anna');
  await expect(submit).toBeEnabled();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(page.getByRole('heading', { name: de.titles.recipes, level: 1 })).toBeVisible();
  await expect(avatarButton(page, 'Anna')).toHaveText('A');
  const profiles = await listProfiles(freshServer);
  expect(profiles.map((p) => p.name)).toEqual(['Anna']);
  expect(await storedProfileId(page)).toBe(String(profiles[0]?.id));
});

test('a1: Gerät merkt sich ein Profil einer früheren Datenbank – Hinweis über dem Formular, Namensfeld hat den Fokus, Enter öffnet die Liste @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  // The owner gets an empty database by pointing DATA_DIR at a new folder; his devices still remember
  // a profile id from before.
  await useProfile(page, 4711);
  await page.goto(`${freshServer.url}/`);
  await expect(page).toHaveURL(/\/profil\?next=(%2F|\/)rezepte$/);
  await expect(page.getByRole('heading', { name: de.titles.profile, level: 1 })).toBeVisible();
  const notice = page.getByRole('alert').filter({ hasText: de.profile.gone });
  await expect(notice).toBeVisible();
  await expect(page.getByText(dl.profilePick.leadEmpty)).toBeVisible();

  const name = page.getByRole('textbox', { name: dl.profilePick.name });
  await expect(name).toBeFocused();
  await press(name);
  await page.keyboard.type('Anna');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(page.getByRole('heading', { name: de.titles.recipes, level: 1 })).toBeVisible();
  await expect(avatarButton(page, 'Anna')).toHaveText('A');
  await expect(notice).toHaveCount(0);
  const profiles = await listProfiles(freshServer);
  expect(profiles.map((p) => p.name)).toEqual(['Anna']);
  expect(await storedProfileId(page)).toBe(String(profiles[0]?.id));
});

test('a7: gleich nach dem ersten Profil zeigt die leere Liste „Noch keine Rezepte“, „Erstes Rezept anlegen“ öffnet den Editor @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  await page.goto(`${freshServer.url}/`);
  await page.getByRole('textbox', { name: dl.profilePick.name }).fill('Jonas');
  await press(page.getByRole('button', { name: dl.profilePick.create }));

  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(page.getByRole('heading', { name: ds.list.emptyTitle })).toBeVisible();
  await expect(page.getByText(ds.list.emptyText)).toBeVisible();
  const action = page.getByRole('link', { name: ds.list.emptyAction });
  await expect(action).toBeVisible();

  await press(action);
  await expect(page).toHaveURL(/\/rezepte\/neu$/);
  await expect(page.getByRole('heading', { name: deEditor.titleNew, level: 1 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: new RegExp(`^${deEditor.title.label}`) })).toBeVisible();
});

// ---------------------------------------------------------------------------------------------------------
// a2, a3: initials and duplicate names (F-01, F-03)
// ---------------------------------------------------------------------------------------------------------

test('a2: „Anna“ und „Andreas“ anlegen – die Avatare zeigen „An“ und „Ad“ @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  await page.goto(`${freshServer.url}/`);
  await page.getByRole('textbox', { name: dl.profilePick.name }).fill('Anna');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/rezepte$/);
  // Alone, Anna has one letter.
  await expect(avatarButton(page, 'Anna')).toHaveText('A');

  // Second profile through avatar → "Neues Profil".
  await press(avatarButton(page, 'Anna'));
  await press(profileSheet(page).getByRole('link', { name: de.profile.newProfile }));
  await expect(page).toHaveURL(/\/profil\?neu=1$/);
  const name = page.getByRole('textbox', { name: dl.profilePick.name });
  await expect(name).toBeFocused();
  await name.fill('Andreas');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(avatarButton(page, 'Andreas')).toHaveText('Ad');

  // Both avatars side by side in the profile sheet.
  await press(avatarButton(page, 'Andreas'));
  const sheet = profileSheet(page);
  await expect(
    sheet.getByRole('button', { name: 'Anna', exact: true }).getByText('An', { exact: true }),
  ).toBeVisible();
  await expect(
    sheet.getByRole('button', { name: /^Andreas/ }).getByText('Ad', { exact: true }),
  ).toBeVisible();
  expect((await listProfiles(freshServer)).map((p) => [p.name, p.initials])).toEqual([
    ['Anna', 'An'],
    ['Andreas', 'Ad'],
  ]);

  // Back to Anna: her own avatar button now shows "An" instead of "A".
  await press(sheet.getByRole('button', { name: 'Anna', exact: true }));
  await expect(sheet).toBeHidden();
  await expect(avatarButton(page, 'Anna')).toHaveText('An');
});

test('a3: „anna“ ein zweites Mal anlegen zeigt „Name bereits vergeben“ @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const anna = await freshServer.api.createProfile('Anna');
  await useProfile(page, anna.id);
  await page.goto(`${freshServer.url}/rezepte`);

  await press(avatarButton(page, 'Anna'));
  await press(profileSheet(page).getByRole('link', { name: de.profile.newProfile }));
  const name = page.getByRole('textbox', { name: dl.profilePick.name });
  await expect(name).toBeFocused();
  await name.fill('anna');
  await page.keyboard.press('Enter');

  const alert = page.getByRole('alert').filter({ hasText: ERROR_TEXTS.NAME_EXISTS });
  await expect(alert).toBeVisible();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  // The tester stays on "Wer kocht?" with the form open; nothing was created.
  await expect(page).toHaveURL(/\/profil\?neu=1$/);
  await expect(page.getByRole('heading', { name: de.titles.profile, level: 1 })).toBeVisible();
  await expect(name).toHaveValue('anna');
  expect((await listProfiles(freshServer)).map((p) => p.name)).toEqual(['Anna']);
});

// ---------------------------------------------------------------------------------------------------------
// a4: switching with two taps (F-03)
// ---------------------------------------------------------------------------------------------------------

/** Checks where the avatar sits: top right in the screen header, or at the bottom of the left rail (≥ 1024 px). */
async function expectAvatarPlacement(page: Page, screenTitle: string | null): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('kein Viewport');
  const avatar = avatarButton(page);
  await expect(avatar).toHaveCount(1);
  await expect(avatar).toBeVisible();
  const box = await avatar.boundingBox();
  if (!box) throw new Error('Avatar ohne Box');

  if (viewport.width >= 1024) {
    const rail = page.getByRole('navigation', { name: de.nav.main });
    await expect(rail.getByRole('button', { name: /^Profil wechseln, aktiv: / })).toBeVisible();
    // Left edge, bottom of the rail (88 px wide, 16 px padding).
    expect(box.x + box.width).toBeLessThanOrEqual(88);
    expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 80);
  } else {
    if (screenTitle === null)
      throw new Error('Unterhalb von 1024 px braucht die Prüfung einen Bildschirmtitel');
    const header = page.locator('header', {
      has: page.getByRole('heading', { name: screenTitle, level: 1 }),
    });
    await expect(header.getByRole('button', { name: /^Profil wechseln, aktiv: / })).toBeVisible();
    // Top right: within 24 px of the right edge, above 80 px.
    expect(box.x + box.width).toBeGreaterThanOrEqual(viewport.width - 24);
    expect(box.y + box.height).toBeLessThanOrEqual(80);
  }
}

/** Exactly two taps: the avatar, then the tile of `to`. The sheet closes and the avatar shows `to`. */
async function switchWithTwoTaps(page: Page, server: AppServer, from: Profile, to: Profile): Promise<void> {
  // Tap 1: avatar.
  await press(avatarButton(page, from.name));
  const sheet = profileSheet(page);
  await expect(sheet).toBeVisible();
  // The active tile is marked (border, check badge and "(aktiv)" for screen readers).
  await expect(sheet.locator('[aria-current="true"]')).toContainText(from.name);
  // Tap 2: tile.
  await press(sheet.getByRole('button', { name: to.name, exact: true }));

  await expect(sheet).toBeHidden();
  await expect(avatarButton(page, to.name)).toHaveText(await initialsOf(server, to.id));
  expect(await storedProfileId(page)).toBe(String(to.id));
}

/** The switch really took effect: after a reload the list sends the new profile with its request. */
async function expectActiveAfterReload(page: Page, active: Profile): Promise<void> {
  await expect(page).toHaveURL(/\/rezepte$/);
  const request = page.waitForRequest(
    (r) => new URL(r.url()).pathname === '/api/v1/recipes' && r.method() === 'GET',
  );
  await page.reload();
  expect((await request).headers()['x-profile-id']).toBe(String(active.id));
  await expect(avatarButton(page, active.name)).toBeVisible();
}

/**
 * Checks the avatar's place on each screen and switches there with two taps (F-03 AK: from the list,
 * the detail, the favorites and the tags), alternating between `a` and `b`. Ends on the list; returns
 * the active profile.
 */
async function switchOnEveryScreen(
  page: Page,
  server: AppServer,
  screens: ReadonlyArray<{ route: string; title: string | null; heading: string }>,
  a: Profile,
  b: Profile,
): Promise<Profile> {
  let [from, to] = [a, b];
  for (const screen of screens) {
    await page.goto(`${server.url}${screen.route}`);
    await expect(page.getByRole('heading', { name: screen.heading, level: 1 })).toBeVisible();
    // Opening a new page keeps the profile of the last switch.
    await expect(avatarButton(page, from.name)).toBeVisible();
    await expectAvatarPlacement(page, screen.title);
    await switchWithTwoTaps(page, server, from, to);
    [from, to] = [to, from];
  }
  return from;
}

const MAIN_SCREENS = [
  { route: '/favoriten', title: de.titles.favorites, heading: de.titles.favorites },
  { route: '/tags', title: de.titles.tags, heading: de.titles.tags },
  { route: '/mehr', title: de.titles.more, heading: de.titles.more },
  { route: '/rezepte', title: de.titles.recipes, heading: de.titles.recipes },
] as const;

test('a4: Profil wechseln mit 2 Fingertipps – Avatar oben rechts bzw. unten in der Leiste links, dann eine Kachel @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const a = await server.api.createProfile(unique('Wechsel A'));
  const b = await server.api.createProfile(unique('Wechsel B'));
  const recipe = await server.api.createRecipe(a.id, { title: unique('Wechselsuppe') });
  await useProfile(page, a.id);

  // From 1024 px the rail (with the avatar) stays next to the detail too. Below 1024 px the detail has no
  // avatar: open owner decision, not tested here.
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  const detail = { route: `/rezepte/${recipe.id}`, title: null, heading: recipe.title };
  const active = await switchOnEveryScreen(
    page,
    server,
    wide ? [detail, ...MAIN_SCREENS] : MAIN_SCREENS,
    a,
    b,
  );
  await expectActiveAfterReload(page, active);
});

test('a4: iPad hochkant – Avatar oben rechts, Wechsel mit 2 Fingertipps @tablet', async ({
  page,
  server,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const a = await server.api.createProfile(unique('Hochkant A'));
  const b = await server.api.createProfile(unique('Hochkant B'));
  await useProfile(page, a.id);

  // Portrait: bottom navigation instead of the rail, the avatar in the screen header.
  await page.goto(`${server.url}/rezepte`);
  await expect(page.getByRole('navigation', { name: de.nav.main })).toBeVisible();
  const active = await switchOnEveryScreen(page, server, MAIN_SCREENS, a, b);
  await expectActiveAfterReload(page, active);
});

// ---------------------------------------------------------------------------------------------------------
// a5: the device remembers the profile (F-02)
// ---------------------------------------------------------------------------------------------------------

test('a5: in der Liste neu laden oder die Adresse neu öffnen – die App startet direkt in der Liste @phone @tablet @desktop', async ({
  page,
  context,
  server,
}) => {
  const me = await server.api.createProfile(unique('Merken'));
  await page.goto(`${server.url}/`);
  await expect(page).toHaveURL(/\/profil$/);
  await press(page.getByRole('button', { name: me.name, exact: true }));
  await expect(page).toHaveURL(/\/rezepte$/);
  const initials = await initialsOf(server, me.id);
  await expect(avatarButton(page, me.name)).toHaveText(initials);

  // Every URL the tab shows from now on (including history.replaceState redirects).
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });

  await page.reload();
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(page.getByRole('heading', { name: de.titles.recipes, level: 1 })).toBeVisible();
  await expect(avatarButton(page, me.name)).toHaveText(initials);

  // Open the address again, in this tab and in a new one.
  await page.goto(`${server.url}/`);
  await expect(page).toHaveURL(/\/rezepte$/);
  await expect(avatarButton(page, me.name)).toHaveText(initials);
  // The redirect "/" → "/rezepte" was recorded, so a detour over the profile choice would be too.
  expect(visited).toContain(`${server.url}/`);
  expect(visited.at(-1)).toMatch(/\/rezepte$/);
  expect(visited.filter((url) => url.includes('/profil'))).toEqual([]);

  const second = await context.newPage();
  await second.goto(`${server.url}/`);
  await expect(second).toHaveURL(/\/rezepte$/);
  await expect(second.getByRole('heading', { name: de.titles.recipes, level: 1 })).toBeVisible();
  await expect(avatarButton(second, me.name)).toHaveText(initials);
  await second.close();
});

// ---------------------------------------------------------------------------------------------------------
// a6: edit and delete the active profile under "Mehr" (F-04)
// ---------------------------------------------------------------------------------------------------------

function profileCard(page: Page): Locator {
  return page.getByRole('region', { name: dl.more.profile });
}

test('a6: unter Mehr Name und Farbe des aktiven Profils ändern und speichern @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const me = await server.api.createProfile(unique('Alt'), 'avatar-1');
  const renamed = unique('Neu');
  await useProfile(page, me.id);
  await page.goto(`${server.url}/mehr`);

  const card = profileCard(page);
  await expect(card.getByText(me.name, { exact: true })).toBeVisible();
  await expect(card.getByText(dl.more.counts(0, 0))).toBeVisible();

  await press(card.getByRole('button', { name: dl.more.edit }));
  const name = card.getByRole('textbox', { name: dl.profilePick.name });
  await expect(name).toHaveValue(me.name);
  await expect(card.getByRole('radio', { name: dl.profilePick.colorLabel(1) })).toBeChecked();
  await name.fill(renamed);

  const color4 = card.getByRole('radio', { name: dl.profilePick.colorLabel(4) });
  const swatch4 = card.locator('label', {
    has: page.getByRole('radio', { name: dl.profilePick.colorLabel(4) }),
  });
  await press(swatch4);
  await expect(color4).toBeChecked();
  const chosenColor = await swatch4
    .locator('span[aria-hidden="true"]')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);

  await press(card.getByRole('button', { name: de.common.save }));
  await expect(page.getByText(dl.more.saved)).toBeVisible();
  await expect(name).toHaveCount(0);
  await expect(card.getByText(renamed, { exact: true })).toBeVisible();
  // The card avatar and the avatar button show the new color and name.
  await expect(card.locator('span[aria-hidden="true"]').first()).toHaveCSS('background-color', chosenColor);
  await expect(avatarButton(page, renamed).locator('span[aria-hidden="true"]').first()).toHaveCSS(
    'background-color',
    chosenColor,
  );

  const saved = (await listProfiles(server)).find((p) => p.id === me.id);
  expect(saved).toMatchObject({ name: renamed, avatar: 'avatar-4' });
});

test('a6: Löschen unter Mehr nennt die Zahl der Bewertungen und Favoriten, die Rezepte bleiben @phone @tablet @desktop', async ({
  page,
  server,
}) => {
  const me = await server.api.createProfile(unique('Weg'));
  await server.api.createProfile(unique('Bleibt'));
  const first = await server.api.createRecipe(me.id, { title: unique('Erstes') });
  const second = await server.api.createRecipe(me.id, { title: unique('Zweites') });
  addRatingsAndFavorites(server, me.id, [first.id, second.id], [first.id]);
  expect(countRatingsAndFavorites(server, me.id)).toEqual({ ratings: 2, favorites: 1 });
  await useProfile(page, me.id);
  await page.goto(`${server.url}/mehr`);

  const card = profileCard(page);
  await expect(card.getByText(dl.more.counts(2, 1))).toBeVisible();
  await press(card.getByRole('button', { name: dl.more.delete }));

  const dialog = page.getByRole('alertdialog', { name: dl.more.deleteTitle(me.name) });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(dl.more.deleteText(2, 1));
  await press(dialog.getByRole('button', { name: dl.more.delete }));

  await expect(page.getByText(dl.more.deleted(me.name))).toBeVisible();
  // The active profile is gone: the device shows the profile choice.
  await expect(page).toHaveURL(/\/profil\?next=(%2F|\/)mehr$/);
  await expect(page.getByRole('heading', { name: de.titles.profile, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: me.name, exact: true })).toHaveCount(0);
  expect(await storedProfileId(page)).toBeNull();

  expect((await listProfiles(server)).some((p) => p.id === me.id)).toBe(false);
  // The named ratings and favorites are really gone, the recipes stay.
  expect(countRatingsAndFavorites(server, me.id)).toEqual({ ratings: 0, favorites: 0 });
  for (const recipe of [first, second]) {
    const res = await server.api.request('GET', `/api/v1/recipes/${recipe.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { recipe: RecipeDetail }).recipe.createdBy).toBeNull();
  }
});

test('a6: das letzte Profil lässt sich unter Mehr nicht löschen @phone @tablet @desktop', async ({
  page,
  freshServer,
}) => {
  const only = await freshServer.api.createProfile('Sebastian');
  await useProfile(page, only.id);
  await page.goto(`${freshServer.url}/mehr`);

  const card = profileCard(page);
  await expect(card.getByText(dl.more.counts(0, 0))).toBeVisible();
  await press(card.getByRole('button', { name: dl.more.delete }));
  const dialog = page.getByRole('alertdialog', { name: dl.more.deleteTitle('Sebastian') });
  // Before any test data both numbers are 0.
  await expect(dialog).toContainText(dl.more.deleteText(0, 0));
  await press(dialog.getByRole('button', { name: dl.more.delete }));

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Das letzte Profil kann nicht gelöscht werden')).toBeVisible();
  await expect(page).toHaveURL(/\/mehr$/);
  await expect(card.getByText('Sebastian', { exact: true })).toBeVisible();
  expect((await listProfiles(freshServer)).map((p) => p.name)).toEqual(['Sebastian']);
  expect(await storedProfileId(page)).toBe(String(only.id));
});

// ---------------------------------------------------------------------------------------------------------
// d9: profile deleted on another device (F-02, F-04, F-29)
// ---------------------------------------------------------------------------------------------------------

test('d9: auf dem Tablet gelöschtes Profil – das Handy zeigt beim nächsten Laden die Profilwahl mit Hinweis, Rezepte „unbekannt“ @phone', async ({
  page,
  browser,
  server,
}) => {
  const gone = await server.api.createProfile(unique('Handy'));
  const other = await server.api.createProfile(unique('Tablet'));
  const recipe = await server.api.createRecipe(gone.id, { title: unique('Handysuppe') });

  // Phone: the profile is active, the recipe shows in the list.
  await useProfile(page, gone.id);
  await page.goto(`${server.url}/rezepte`);
  await expect(page.getByRole('link', { name: recipe.title, exact: true })).toBeVisible();

  // Tablet: another profile is active there. "Mehr" only manages the active profile, so the tester first
  // switches to the phone's profile (rail avatar → tile), then deletes it.
  const { context, tablet, errors } = await openTablet(browser);
  try {
    await useProfile(tablet, other.id);
    await tablet.goto(`${server.url}/mehr`);
    const card = tablet.getByRole('region', { name: dl.more.profile });
    await expect(card.getByText(other.name, { exact: true })).toBeVisible();
    await tablet.getByRole('button', { name: de.profile.switchLabel(other.name), exact: true }).tap();
    await profileSheet(tablet).getByRole('button', { name: gone.name, exact: true }).tap();
    await expect(card.getByText(gone.name, { exact: true })).toBeVisible();
    await card.getByRole('button', { name: dl.more.delete }).tap();
    const dialog = tablet.getByRole('alertdialog', { name: dl.more.deleteTitle(gone.name) });
    await dialog.getByRole('button', { name: dl.more.delete }).tap();
    await expect(tablet.getByText(dl.more.deleted(gone.name))).toBeVisible();
    await expect(tablet).toHaveURL(/\/profil/);

    // Phone, next load: profile choice with the notice instead of an error.
    await page.reload();
    await expect(page).toHaveURL(/\/profil\?next=(%2F|\/)rezepte$/);
    await expect(page.getByRole('heading', { name: de.titles.profile, level: 1 })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: de.profile.gone })).toBeVisible();
    await expect(page.getByRole('button', { name: gone.name, exact: true })).toHaveCount(0);
    expect(await storedProfileId(page)).toBeNull();

    // Phone: another profile, then the recipe of the deleted profile says "unbekannt".
    await press(page.getByRole('button', { name: other.name, exact: true }));
    await expect(page).toHaveURL(/\/rezepte$/);
    await press(page.getByRole('link', { name: recipe.title, exact: true }));
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    await expect(page.getByText(new RegExp(`^${dl.detail.created(dl.person.unknown, '')}`))).toBeVisible();

    // Tablet: the same recipe also says "unbekannt".
    await tablet.getByRole('button', { name: other.name, exact: true }).tap();
    // The choice opens ?next= (Mehr); only then is the new profile stored.
    await expect(tablet).toHaveURL(/\/mehr$/);
    await expect(tablet.getByRole('region', { name: dl.more.profile })).toContainText(other.name);
    await tablet.goto(`${server.url}/rezepte/${recipe.id}`);
    await expect(tablet.getByText(new RegExp(`^${dl.detail.created(dl.person.unknown, '')}`))).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('d9: ohne Neuladen führt die nächste Anfrage des Handys zur Profilwahl mit „Profil nicht mehr vorhanden“ @phone', async ({
  page,
  server,
}) => {
  const gone = await server.api.createProfile(unique('Handy'));
  await server.api.createProfile(unique('Bleibt'));
  await useProfile(page, gone.id);
  await page.goto(`${server.url}/rezepte`);
  await expect(avatarButton(page, gone.name)).toBeVisible();

  // Another device deletes the profile.
  const res = await server.api.request('DELETE', `/api/v1/profiles/${gone.id}`);
  expect(res.status).toBe(204);

  await press(page.getByRole('button', { name: de.common.refresh }));
  await expect(page).toHaveURL(/\/profil\?next=(%2F|\/)rezepte$/);
  await expect(page.getByRole('alert').filter({ hasText: de.profile.gone })).toBeVisible();
  await expect(page.getByRole('button', { name: gone.name, exact: true })).toHaveCount(0);
});
