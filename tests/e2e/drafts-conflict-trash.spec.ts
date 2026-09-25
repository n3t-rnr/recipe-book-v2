// Checklist section D "Entwürfe, Konflikte, Papierkorb" (F-07, F-08, F-09, F-33, F-35, NF-09) in the browser.
// Covered checklist ids: d1, d2, d3, d4, d5, d6, d7, d8.
// Server rules behind these flows are covered by API tests and referenced, not repeated here:
// tests/api/recipes-conflict.test.ts (409 VERSION_CONFLICT, ?force=1, 410 IN_TRASH on PUT),
// tests/api/recipes.test.ts (createKey, GET 410 IN_TRASH, restore incl. image), tests/api/trash.test.ts.
// Device-only parts stay manual: the real iOS edge-swipe and the Android system back button (here a
// browser Back, which is what both trigger). "Server mit Strg+C stoppen" is the fixture's server.stop()
// (the device only sees a refused connection either way).
// d3 "Meine Version speichern" and d4 "nach „Wiederherstellen und speichern“" guard a fixed WebKit bug:
// the editor stayed open after saving from a dialog (the dialog's and the guard's history steps merged).
import type { Page } from '@playwright/test';
import { smallJpeg } from '../helpers/images.ts';
import { test as base, expect, useProfile } from './fixtures.ts';
import {
  countHistorySteps,
  type Device,
  detailHeading,
  editorOf,
  getRecipe,
  historySteps,
  listRecipes,
  moveToTrashInDetail,
  openDevice,
  storageItem,
  toastWith,
  trashItems,
  trashViaApi,
  uid,
  waitForBackGuard,
  watchProblems,
} from './helpers-drafts-conflict-trash.ts';

/** Phone (Anna) and tablet (Sebastian) on the same server: the project's own device plus a second one. */
interface TwoDevices {
  phone: Page;
  tablet: Page;
}

const test = base.extend<{ twoDevices: (anna: number, sebastian: number) => Promise<TwoDevices> }>({
  twoDevices: async ({ page, browser }, use, testInfo) => {
    const opened: Device[] = [];
    await use(async (anna, sebastian) => {
      // The tablet project is the tablet and adds a phone; the phone projects add a tablet (same engine).
      const onTablet = testInfo.project.name.startsWith('tablet');
      const other = await openDevice(browser, onTablet ? 'phone' : 'tablet', onTablet ? anna : sebastian);
      opened.push(other);
      await useProfile(page, onTablet ? sebastian : anna);
      return onTablet ? { phone: other.page, tablet: page } : { phone: page, tablet: other.page };
    });
    for (const device of opened) await device.close();
  },
});

const DAY_MS = 86_400_000;
/** "Entwurf von heute, 14:05 wiederherstellen?" (de-editor.ts draft.title; "gestern" only around midnight). */
const DRAFT_PROMPT = /^Entwurf von (heute|gestern), \d{2}:\d{2} wiederherstellen\?$/;

/** Fills title and two ingredients of an open editor the way a user types them. */
async function typeTitleAndTwoIngredients(page: Page, title: string): Promise<void> {
  const editor = editorOf(page);
  await editor.title.fill(title);
  const first = editor.ingredient(1);
  await first.amount.fill('200');
  await first.unit.fill('g');
  await first.name.fill('Rote Linsen');
  // A new recipe starts with one empty row; "+ Zutat" adds the second.
  await editor.addIngredient.click();
  await editor.ingredient(2).name.fill('Karotten');
}

async function expectTitleAndTwoIngredients(page: Page, title: string): Promise<void> {
  const editor = editorOf(page);
  await expect(editor.title).toHaveValue(title);
  await expect(editor.ingredient(1).amount).toHaveValue('200');
  await expect(editor.ingredient(1).unit).toHaveValue('g');
  await expect(editor.ingredient(1).name).toHaveValue('Rote Linsen');
  await expect(editor.ingredient(2).name).toHaveValue('Karotten');
}

// ------------------------------------------------------------------------------------------------ d1

test.describe('d1: Entwurf nach geschlossenem Tab wiederherstellen (F-09)', () => {
  test('neues Rezept: Titel und 2 Zutaten, Tab zu, Editor wieder öffnen → „Entwurf … wiederherstellen?“ @phone @tablet @desktop', async ({
    page,
    context,
    server,
  }) => {
    const id = uid(test.info());
    const profile = await server.api.createProfile(`Anna ${id}`);
    const title = `Linsensuppe ${id}`;
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte`);
    await page.getByRole('link', { name: 'Neues Rezept', exact: true }).click();
    await expect(page).toHaveURL(/\/rezepte\/neu$/);
    await typeTitleAndTwoIngredients(page, title);
    // Autosave runs every 2 s (F-09); wait for it instead of sleeping.
    await expect.poll(() => storageItem(page, 'draft:new'), { timeout: 6_000 }).toContain('Karotten');

    // Close the browser tab; the device (context) keeps its localStorage and the remembered profile.
    const tab = await context.newPage();
    await page.close();
    const problems = await watchProblems(tab);
    await tab.goto(`${server.url}/rezepte`);
    await tab.getByRole('link', { name: 'Neues Rezept', exact: true }).click();

    const prompt = tab.getByRole('dialog', { name: DRAFT_PROMPT });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('Deine letzten Eingaben wurden automatisch gesichert.');
    await expect(prompt.getByRole('button', { name: 'Verwerfen' })).toBeVisible();
    await prompt.getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect(prompt).toBeHidden();
    await expectTitleAndTwoIngredients(tab, title);

    // F-09 AK: after a successful save the draft is gone.
    await editorOf(tab).save.click();
    await expect(detailHeading(tab, title)).toBeVisible();
    await expect(tab).toHaveURL(/\/rezepte\/\d+$/);
    expect(await storageItem(tab, 'draft:new')).toBeNull();
    expect(problems, 'CSP-Verstöße und Fehler im Browser (neuer Tab)').toEqual([]);
  });

  test('bestehendes Rezept: Änderung, Tab zu, Editor wieder öffnen → Dialog; „Verwerfen“ zeigt den gespeicherten Stand @phone @tablet @desktop', async ({
    page,
    context,
    server,
  }) => {
    const id = uid(test.info());
    const profile = await server.api.createProfile(`Anna ${id}`);
    const recipe = await server.api.createRecipe(profile.id, {
      title: `Gulasch ${id}`,
      ingredients: [{ amount: 500, unit: 'g', name: 'Rindfleisch' }],
    });
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}/bearbeiten`);
    const editor = editorOf(page);
    await expect(editor.title).toHaveValue(recipe.title);
    await editor.title.fill(`${recipe.title} mit Paprika`);
    await expect
      .poll(() => storageItem(page, `draft:${recipe.id}`), { timeout: 6_000 })
      .toContain(`${recipe.title} mit Paprika`);

    const tab = await context.newPage();
    await page.close();
    const problems = await watchProblems(tab);
    await tab.goto(`${server.url}/rezepte/${recipe.id}/bearbeiten`);
    const prompt = tab.getByRole('dialog', { name: DRAFT_PROMPT });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(prompt).toBeHidden();
    await expect(editorOf(tab).title).toHaveValue(recipe.title);
    expect(await storageItem(tab, `draft:${recipe.id}`)).toBeNull();
    expect(problems, 'CSP-Verstöße und Fehler im Browser (neuer Tab)').toEqual([]);
  });

  test('Tab sofort nach der Eingabe schließen (vor dem 2-s-Autosave): der Entwurf ist trotzdem da @phone @tablet @desktop', async ({
    page,
    context,
    server,
  }) => {
    const id = uid(test.info());
    const profile = await server.api.createProfile(`Anna ${id}`);
    const title = `Erbsensuppe ${id}`;
    await page.clock.install();
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte/neu`);
    await expect(editorOf(page).title).toBeVisible();
    // Stop the page's timers: the 2 s interval cannot save, only closing the tab (pagehide/visibilitychange).
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
    await typeTitleAndTwoIngredients(page, title);
    expect(await storageItem(page, 'draft:new'), 'noch kein Autosave vor dem Schließen').toBeNull();

    const tab = await context.newPage();
    await page.close();
    const problems = await watchProblems(tab);
    await tab.goto(`${server.url}/rezepte`);
    await tab.getByRole('link', { name: 'Neues Rezept', exact: true }).click();
    const prompt = tab.getByRole('dialog', { name: DRAFT_PROMPT });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Wiederherstellen' }).click();
    await expectTitleAndTwoIngredients(tab, title);
    expect(problems, 'CSP-Verstöße und Fehler im Browser (neuer Tab)').toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ d2

test.describe('d2: Abbrechen oder Zurück mit ungespeicherten Änderungen (F-09, F-35)', () => {
  test('„Abbrechen“ fragt „Änderungen verwerfen?“; „Weiter bearbeiten“ behält die Eingabe, „Verwerfen“ verlässt den Editor @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const id = uid(test.info());
    const profile = await server.api.createProfile(`Anna ${id}`);
    const recipe = await server.api.createRecipe(profile.id, { title: `Kartoffelsalat ${id}` });
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}`);
    await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
    const editor = editorOf(page);
    await expect(editor.title).toHaveValue(recipe.title);
    await editor.title.fill(`${recipe.title} mit Gurke`);
    // The draft exists, so "Verwerfen" below has something to discard.
    await expect
      .poll(() => storageItem(page, `draft:${recipe.id}`), { timeout: 6_000 })
      .toContain(`${recipe.title} mit Gurke`);

    await editor.cancel.click();
    const ask = page.getByRole('alertdialog', { name: 'Änderungen verwerfen?' });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('Deine Eingaben gehen verloren.');
    // The safe choice comes first and has the focus.
    const keep = ask.getByRole('button', { name: 'Weiter bearbeiten' });
    await expect(keep).toBeFocused();
    await keep.click();
    await expect(ask).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}/bearbeiten$`));
    await expect(editor.title).toHaveValue(`${recipe.title} mit Gurke`);

    // "Zurück" top left asks the same.
    await editor.back.click();
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    await expect(detailHeading(page, recipe.title)).toBeVisible();
    expect((await getRecipe(server, recipe.id, profile.id)).recipe?.title).toBe(recipe.title);
    expect(await storageItem(page, `draft:${recipe.id}`)).toBeNull();
    // Discarded means gone: the editor opens with the saved state and offers no draft.
    await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
    await expect(editor.title).toHaveValue(recipe.title);
    await expect(page.getByRole('dialog', { name: DRAFT_PROMPT })).toHaveCount(0);
  });

  test('Zurück-Geste (Browser-Zurück) mit Änderungen fragt „Änderungen verwerfen?“ und bleibt im Editor @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const id = uid(test.info());
    const profile = await server.api.createProfile(`Anna ${id}`);
    const recipe = await server.api.createRecipe(profile.id, { title: `Nudelauflauf ${id}` });
    await countHistorySteps(page);
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}`);
    await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
    const editor = editorOf(page);
    await expect(editor.title).toHaveValue(recipe.title);
    await editor.title.fill(`${recipe.title} mit Brokkoli`);
    await waitForBackGuard(page);

    // The Android back button and the iOS back gesture both go one history entry back.
    await page.goBack();
    const ask = page.getByRole('alertdialog', { name: 'Änderungen verwerfen?' });
    await expect(ask).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}/bearbeiten$`));

    // "Weiter bearbeiten" keeps the input, and the next back gesture asks again (no silent data loss).
    const steps = await historySteps(page);
    await ask.getByRole('button', { name: 'Weiter bearbeiten' }).click();
    await expect(ask).toBeHidden();
    await expect(editor.title).toHaveValue(`${recipe.title} mit Brokkoli`);
    // The closed dialog removes its own history entry first; then the guard is back on top.
    await expect.poll(() => historySteps(page)).toBe(steps + 1);
    await waitForBackGuard(page);
    await page.goBack();
    await expect(ask).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}/bearbeiten$`));
    await ask.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    await expect(detailHeading(page, recipe.title)).toBeVisible();
    expect((await getRecipe(server, recipe.id, profile.id)).recipe?.title).toBe(recipe.title);
  });

  test('ohne echte Änderung (nur leere Zeile, gleicher Titel) verlässt „Abbrechen“ den Editor ohne Rückfrage @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const id = uid(test.info());
    const profile = await server.api.createProfile(`Anna ${id}`);
    const recipe = await server.api.createRecipe(profile.id, { title: `Milchreis ${id}` });
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}`);
    await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
    const editor = editorOf(page);
    await expect(editor.title).toHaveValue(recipe.title);
    await editor.addIngredient.click();
    await editor.title.fill(recipe.title);

    await editor.cancel.click();
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    await expect(detailHeading(page, recipe.title)).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});

// ------------------------------------------------------------------------------------------------ d3, d4

test.describe('d3: Konflikt zwischen Handy und Tablet (F-07)', () => {
  /** Both devices open the editor; the phone saves a new title, then the tablet saves a changed ingredient. */
  async function provokeConflict(
    phone: Page,
    tablet: Page,
    url: string,
    recipeId: number,
    title: string,
  ): Promise<void> {
    await phone.goto(`${url}/rezepte/${recipeId}/bearbeiten`);
    await tablet.goto(`${url}/rezepte/${recipeId}/bearbeiten`);
    await expect(editorOf(phone).title).toHaveValue(title);
    await expect(editorOf(tablet).ingredient(1).name).toHaveValue('Rindfleisch');

    await editorOf(phone).title.fill(`${title} vom Handy`);
    await editorOf(phone).save.click();
    await expect(detailHeading(phone, `${title} vom Handy`)).toBeVisible();

    await editorOf(tablet).ingredient(1).name.fill('Schweinefleisch');
    await editorOf(tablet).save.click();
  }

  test('„Neu laden“ zeigt die Serverfassung, markiert meine Zutaten und „Meine Änderung übernehmen“ holt sie zurück @phone @tablet', async ({
    twoDevices,
    server,
  }) => {
    const id = uid(test.info());
    const anna = await server.api.createProfile(`Anna ${id}`);
    const sebastian = await server.api.createProfile(`Sebastian ${id}`, 'avatar-2');
    const recipe = await server.api.createRecipe(sebastian.id, {
      title: `Gulasch ${id}`,
      ingredients: [{ amount: 500, unit: 'g', name: 'Rindfleisch' }],
    });
    const { phone, tablet } = await twoDevices(anna.id, sebastian.id);
    await provokeConflict(phone, tablet, server.url, recipe.id, recipe.title);

    const conflict = tablet.getByRole('dialog', { name: `Inzwischen von ${anna.name} geändert` });
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText(
      `${anna.name} hat das Rezept gespeichert, während du bearbeitet hast. Deine Eingaben bleiben erhalten.`,
    );
    await expect(conflict.getByRole('button', { name: 'Meine Version speichern' })).toBeVisible();
    await conflict.getByRole('button', { name: 'Neu laden' }).click();
    await expect(conflict).toBeHidden();

    const editor = editorOf(tablet);
    await expect(
      toastWith(tablet, 'Aktuelle Fassung geladen – deine Änderungen sind markiert.'),
    ).toBeVisible();
    await expect(editor.title).toHaveValue(`${recipe.title} vom Handy`);
    await expect(editor.ingredient(1).name).toHaveValue('Rindfleisch');
    // Only the field the tablet changed is marked, under "Zutaten".
    const mark = tablet.getByRole('region', { name: 'Zutaten' }).getByRole('note');
    await expect(mark).toContainText('Du hattest das geändert: 1 Zutat');
    await expect(tablet.getByRole('note')).toHaveCount(1);
    // F-07 AK: until saving, the local draft keeps the own input.
    await expect.poll(() => storageItem(tablet, `draft:${recipe.id}`)).toContain('Schweinefleisch');

    await mark.getByRole('button', { name: 'Meine Änderung übernehmen' }).click();
    await expect(editor.ingredient(1).name).toHaveValue('Schweinefleisch');
    await expect(tablet.getByRole('note')).toHaveCount(0);
    await editor.save.click();
    await expect(detailHeading(tablet, `${recipe.title} vom Handy`)).toBeVisible();

    const saved = (await getRecipe(server, recipe.id, sebastian.id)).recipe;
    expect(saved?.title).toBe(`${recipe.title} vom Handy`);
    expect(saved?.ingredients.map((i) => i.name)).toEqual(['Schweinefleisch']);
    expect(saved?.version).toBe(3);
    expect(saved?.updatedBy?.name).toBe(sebastian.name);
  });

  test('„Meine Version speichern“: die Fassung des Tablets überschreibt die des Handys @phone @tablet', async ({
    twoDevices,
    server,
  }) => {
    const id = uid(test.info());
    const anna = await server.api.createProfile(`Anna ${id}`);
    const sebastian = await server.api.createProfile(`Sebastian ${id}`, 'avatar-2');
    const recipe = await server.api.createRecipe(sebastian.id, {
      title: `Schnitzel ${id}`,
      ingredients: [{ amount: 500, unit: 'g', name: 'Rindfleisch' }],
    });
    const { phone, tablet } = await twoDevices(anna.id, sebastian.id);
    await provokeConflict(phone, tablet, server.url, recipe.id, recipe.title);

    const conflict = tablet.getByRole('dialog', { name: `Inzwischen von ${anna.name} geändert` });
    await expect(conflict).toBeVisible();
    // The forced PUT answers at once (local server): the dialog's history step and the release of the
    // back guard must not overlap, or WebKit merges them and the editor stays open (see d4).
    await conflict.getByRole('button', { name: 'Meine Version speichern' }).click();
    await expect(detailHeading(tablet, recipe.title)).toBeVisible();
    await expect(tablet).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    await expectOwnEntry(tablet, 0);

    const saved = (await getRecipe(server, recipe.id, sebastian.id)).recipe;
    expect(saved?.title, 'der Titel des Handys ist überschrieben').toBe(recipe.title);
    expect(saved?.ingredients.map((i) => i.name)).toEqual(['Schweinefleisch']);
    expect(saved?.version).toBe(3);
    await phone.reload();
    await expect(detailHeading(phone, recipe.title)).toBeVisible();
  });
});

test.describe('d4: Löschen auf Gerät A, während Gerät B bearbeitet (F-07)', () => {
  /** B has the editor open with a changed title; A moves the recipe to the trash; B taps "Speichern". */
  async function trashWhileEditing(
    deviceA: Page,
    deviceB: Page,
    url: string,
    recipeId: number,
    title: string,
  ): Promise<void> {
    await deviceB.goto(`${url}/rezepte/${recipeId}/bearbeiten`);
    const editor = editorOf(deviceB);
    await expect(editor.title).toHaveValue(title);
    await editor.title.fill(`${title} nach Omas Art`);

    await deviceA.goto(`${url}/rezepte/${recipeId}`);
    await expect(detailHeading(deviceA, title)).toBeVisible();
    await moveToTrashInDetail(deviceA);
    await expect(toastWith(deviceA, 'Rezept gelöscht')).toBeVisible();

    await editor.save.click();
  }

  test('B speichert → „Von … in den Papierkorb gelegt – wiederherstellen und speichern?“, Eingaben bleiben, Bestätigen stellt wieder her und speichert @phone @tablet', async ({
    twoDevices,
    server,
  }) => {
    const id = uid(test.info());
    const anna = await server.api.createProfile(`Anna ${id}`);
    const sebastian = await server.api.createProfile(`Sebastian ${id}`, 'avatar-2');
    const recipe = await server.api.createRecipe(sebastian.id, { title: `Rinderrouladen ${id}` });
    const { phone: deviceA, tablet: deviceB } = await twoDevices(anna.id, sebastian.id);
    await trashWhileEditing(deviceA, deviceB, server.url, recipe.id, recipe.title);

    const ask = deviceB.getByRole('dialog', {
      name: `Von ${anna.name} in den Papierkorb gelegt – wiederherstellen und speichern?`,
    });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('Deine Eingaben bleiben erhalten.');
    // "Abbrechen" keeps everything; the recipe stays in the trash.
    await ask.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(ask).toBeHidden();
    const editor = editorOf(deviceB);
    await expect(editor.title).toHaveValue(`${recipe.title} nach Omas Art`);
    expect((await getRecipe(server, recipe.id, sebastian.id)).code).toBe('IN_TRASH');

    await editor.save.click();
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Wiederherstellen und speichern' }).click();
    await expect(ask).toBeHidden();
    await expect
      .poll(async () => (await getRecipe(server, recipe.id, sebastian.id)).recipe?.title ?? null)
      .toBe(`${recipe.title} nach Omas Art`);
    const saved = (await getRecipe(server, recipe.id, sebastian.id)).recipe;
    expect(saved?.version, 'Löschen und Wiederherstellen ändern die Version nicht').toBe(2);
    expect((await trashItems(server, sebastian.id)).map((i) => i.id)).not.toContain(recipe.id);
  });

  test('nach „Wiederherstellen und speichern“ schließt der Editor und zeigt das gespeicherte Rezept @phone @tablet', async ({
    twoDevices,
    server,
  }) => {
    // Guards a fixed WebKit bug: restoreAndSave closed the dialog and saved at once; the dialog's history
    // step and the release of the back guard (two history.back() about 20 ms apart) merged into one
    // popstate, the router waited forever and the editor stayed open. Dialog actions that save now close
    // through closeDialog, and finishSaved waits for that step (saveMine in d3 and saveAsNew alike).
    const id = uid(test.info());
    const anna = await server.api.createProfile(`Anna ${id}`);
    const sebastian = await server.api.createProfile(`Sebastian ${id}`, 'avatar-2');
    const recipe = await server.api.createRecipe(sebastian.id, { title: `Sauerbraten ${id}` });
    const { phone: deviceA, tablet: deviceB } = await twoDevices(anna.id, sebastian.id);
    await trashWhileEditing(deviceA, deviceB, server.url, recipe.id, recipe.title);

    const ask = deviceB.getByRole('dialog', {
      name: /in den Papierkorb gelegt – wiederherstellen und speichern\?$/,
    });
    await ask.getByRole('button', { name: 'Wiederherstellen und speichern' }).click();
    await expect(detailHeading(deviceB, `${recipe.title} nach Omas Art`)).toBeVisible();
    await expect(deviceB).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    // Neither the dialog's nor the back guard's entry is left, and in-app links work again.
    await expectOwnEntry(deviceB, 0);
    await deviceB.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
    await expect(editorOf(deviceB).title).toHaveValue(`${recipe.title} nach Omas Art`);
  });

  test('vom Detail geöffnet: nach „Wiederherstellen und speichern“ geht der Editor zum Detail zurück, statt es ein zweites Mal zu stapeln @phone @tablet', async ({
    page,
    server,
  }) => {
    // F-34: saving goes back to the detail it came from. That needs the dialog's history step to be
    // through before the editor releases its back guard and asks the router where Back leads.
    const id = uid(test.info());
    const profile = await server.api.createProfile(`Sebastian ${id}`);
    const recipe = await server.api.createRecipe(profile.id, { title: `Königsberger Klopse ${id}` });
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}`);
    await expect(detailHeading(page, recipe.title)).toBeVisible();
    await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
    const editor = editorOf(page);
    await expect(editor.title).toHaveValue(recipe.title);
    await editor.title.fill(`${recipe.title} mit Kapern`);
    // Another device moves the recipe to the trash meanwhile.
    await trashViaApi(server, recipe.id, profile.id);
    await editor.save.click();

    const ask = page.getByRole('dialog', {
      name: /in den Papierkorb gelegt – wiederherstellen und speichern\?$/,
    });
    await ask.getByRole('button', { name: 'Wiederherstellen und speichern' }).click();
    await expect(detailHeading(page, `${recipe.title} mit Kapern`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    // Back on the detail's own entry (position 0), not a second detail on top of it.
    await expectOwnEntry(page, 0);
  });

  test('endgültig gelöscht: „Als neues Rezept speichern“ legt es neu an und zeigt es @phone @tablet', async ({
    page,
    server,
  }) => {
    const id = uid(test.info());
    const profile = await server.api.createProfile(`Sebastian ${id}`);
    const recipe = await server.api.createRecipe(profile.id, { title: `Himmel und Erde ${id}` });
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}/bearbeiten`);
    const editor = editorOf(page);
    await expect(editor.title).toHaveValue(recipe.title);
    await editor.title.fill(`${recipe.title} mit Blutwurst`);
    // Another device deletes it for good meanwhile (trash, then "Endgültig löschen").
    await trashViaApi(server, recipe.id, profile.id);
    const purged = await server.api.request('DELETE', `/api/v1/trash/${recipe.id}`, {
      profileId: profile.id,
    });
    expect(purged.status, 'Rezept endgültig löschen').toBe(204);
    await editor.save.click();

    const gone = page.getByRole('dialog', { name: 'Rezept nicht mehr vorhanden' });
    await gone.getByRole('button', { name: 'Als neues Rezept speichern' }).click();
    await expect(detailHeading(page, `${recipe.title} mit Blutwurst`)).toBeVisible();
    await expect(page).toHaveURL(/\/rezepte\/\d+$/);
    const newId = Number(new URL(page.url()).pathname.split('/').at(-1));
    expect(newId).not.toBe(recipe.id);
    expect((await getRecipe(server, newId, profile.id)).recipe?.title).toBe(`${recipe.title} mit Blutwurst`);
    await expectOwnEntry(page, 0);
  });
});

/** The current history entry is the page's own one at position `idx`: no dialog or guard entry is left. */
async function expectOwnEntry(page: Page, idx: number): Promise<void> {
  const state = await page.evaluate(() => history.state as { idx?: unknown; overlay?: unknown } | null);
  expect(state?.idx).toBe(idx);
  expect(state?.overlay).toBeUndefined();
}

// ------------------------------------------------------------------------------------------------ d5

test.describe('d5: Löschen im Detail mit „Rückgängig“ (F-08)', () => {
  test('„Weitere Aktionen“ → „In den Papierkorb“ löscht ohne Rückfrage; der Toast bietet 8 s lang „Rückgängig“ @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const id = uid(test.info());
    const profile = await server.api.createProfile(`Anna ${id}`);
    const recipe = await server.api.createRecipe(profile.id, { title: `Zwiebelkuchen ${id}` });
    await page.clock.install();
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}`);
    await expect(detailHeading(page, recipe.title)).toBeVisible();
    // Freeze the page's clock: the toast's 8 s run only with runFor below.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);

    await moveToTrashInDetail(page);
    // The toast timer pauses under a mouse pointer (Toast.svelte); keep the pointer away from it.
    await page.mouse.move(1, 1);
    const toast = toastWith(page, 'Rezept gelöscht');
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Rückgängig' })).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect((await getRecipe(server, recipe.id, profile.id)).code).toBe('IN_TRASH');

    await page.clock.runFor(7_800);
    await expect(toast).toBeVisible();
    await page.clock.runFor(400);
    await expect(toast).toBeHidden();
  });

  test('„Rückgängig“ bringt ein Rezept mit Foto samt Foto zurück @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const id = uid(test.info());
    const profile = await server.api.createProfile(`Anna ${id}`);
    const upload = await server.api.uploadImage(profile.id, await smallJpeg(900, 600));
    const recipe = await server.api.createRecipe(profile.id, {
      title: `Flammkuchen ${id}`,
      imageId: upload.imageId,
    });
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte`);
    const listLink = page.getByRole('link', { name: recipe.title, exact: true });
    await listLink.click();
    await expect(detailHeading(page, recipe.title)).toBeVisible();
    const photo = page.getByRole('img', { name: `Foto: ${recipe.title}` });
    await expect(photo).toBeVisible();

    await moveToTrashInDetail(page);
    await page.mouse.move(1, 1);
    const toast = toastWith(page, 'Rezept gelöscht');
    await expect(toast).toBeVisible();
    await expect(page).toHaveURL(/\/rezepte$/);
    await expect(listLink).toHaveCount(0);

    await toast.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(toast).toBeHidden();
    await expect(listLink).toBeVisible();
    const restored = (await getRecipe(server, recipe.id, profile.id)).recipe;
    expect(restored?.image?.id).toBe(upload.imageId);

    await listLink.click();
    await expect(detailHeading(page, recipe.title)).toBeVisible();
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------------ d6

test.describe('d6: Mehr → Papierkorb (F-08)', () => {
  test('zeigt wer und wann, „noch 30 Tage“; „Wiederherstellen“ wirkt sofort, „Endgültig löschen“ fragt vorher @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const id = uid(test.info());
    const anna = await server.api.createProfile(`Anna ${id}`);
    const keep = await server.api.createRecipe(anna.id, { title: `Apfelkuchen ${id}` });
    const drop = await server.api.createRecipe(anna.id, { title: `Birnenkuchen ${id}` });
    await trashViaApi(server, keep.id, anna.id);
    await trashViaApi(server, drop.id, anna.id);
    await useProfile(page, anna.id);
    await page.goto(`${server.url}/rezepte`);
    await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Mehr' })
      .click();
    await page.getByRole('link', { name: /^Papierkorb/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Papierkorb' })).toBeVisible();

    const item = (title: string) =>
      page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(item(keep.title)).toContainText(`Gelöscht von ${anna.name} heute`);
    await expect(item(keep.title)).toContainText('noch 30 Tage');
    await expect(item(drop.title)).toContainText(`Gelöscht von ${anna.name} heute`);

    // "Wiederherstellen" acts at once, without a question.
    await item(keep.title).getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect(item(keep.title)).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect((await getRecipe(server, keep.id, anna.id)).status).toBe(200);
    const restored = toastWith(page, `„${keep.title}“ wiederhergestellt`);
    await restored.getByRole('button', { name: 'Öffnen' }).click();
    await expect(detailHeading(page, keep.title)).toBeVisible();
    await page.goBack();
    await expect(item(drop.title)).toBeVisible();

    // "Endgültig löschen" asks first, names the recipe and starts on "Abbrechen".
    await item(drop.title).getByRole('button', { name: 'Endgültig löschen' }).click();
    const confirm = page.getByRole('alertdialog', { name: `„${drop.title}“ endgültig löschen?` });
    await expect(confirm).toContainText('Das Rezept lässt sich danach nicht mehr wiederherstellen.');
    await expect(confirm.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(confirm).toBeHidden();
    await expect(item(drop.title)).toBeVisible();
    expect((await getRecipe(server, drop.id, anna.id)).code).toBe('IN_TRASH');

    await item(drop.title).getByRole('button', { name: 'Endgültig löschen' }).click();
    await confirm.getByRole('button', { name: 'Endgültig löschen' }).click();
    await expect(item(drop.title)).toHaveCount(0);
    await expect(toastWith(page, `„${drop.title}“ endgültig gelöscht`)).toBeVisible();
    expect((await getRecipe(server, drop.id, anna.id)).status).toBe(404);
  });

  test('ein vor 3 Tagen gelöschtes Rezept zeigt „vor 3 Tagen“ und die richtigen Resttage @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const id = uid(test.info());
    const anna = await server.api.createProfile(`Anna ${id}`);
    const recipe = await server.api.createRecipe(anna.id, { title: `Quarkauflauf ${id}` });
    await trashViaApi(server, recipe.id, anna.id);
    const entry = (await trashItems(server, anna.id)).find((i) => i.id === recipe.id);
    if (!entry) throw new Error('Rezept fehlt im Papierkorb');

    // The device's clock runs 3 calendar days later (around noon in Berlin) than the deletion.
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date(entry.deletedAt))
      .split('-')
      .map(Number);
    const later = Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + 3, 11, 0);
    const daysLeft = Math.ceil((Date.parse(entry.purgeAt) - later) / DAY_MS);
    await page.clock.install({ time: later });
    await useProfile(page, anna.id);
    await page.goto(`${server.url}/mehr/papierkorb`);

    const item = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: recipe.title, exact: true }) });
    await expect(item).toContainText(`Gelöscht von ${anna.name} vor 3 Tagen`);
    await expect(item).toContainText(`noch ${daysLeft} Tage`);
  });
});

// ------------------------------------------------------------------------------------------------ d7

test.describe('d7: Link auf ein gelöschtes Rezept (F-33)', () => {
  test('das Detail zeigt „Im Papierkorb (gelöscht von …)“ mit „Wiederherstellen“ @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const id = uid(test.info());
    const anna = await server.api.createProfile(`Anna ${id}`);
    const recipe = await server.api.createRecipe(anna.id, { title: `Pilzpfanne ${id}` });
    await trashViaApi(server, recipe.id, anna.id);
    await useProfile(page, anna.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}`);

    await expect(
      page.getByRole('heading', { name: `Im Papierkorb (gelöscht von ${anna.name} heute)`, exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Rezept nicht gefunden')).toHaveCount(0);
    await page.getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect(detailHeading(page, recipe.title)).toBeVisible();
    await expect(toastWith(page, 'Rezept wiederhergestellt')).toBeVisible();
    expect((await getRecipe(server, recipe.id, anna.id)).status).toBe(200);
  });

  test('der Editor-Link zeigt denselben Hinweis; „Wiederherstellen“ öffnet das Formular @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const id = uid(test.info());
    const anna = await server.api.createProfile(`Anna ${id}`);
    const recipe = await server.api.createRecipe(anna.id, { title: `Bohneneintopf ${id}` });
    await trashViaApi(server, recipe.id, anna.id);
    await useProfile(page, anna.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}/bearbeiten`);

    await expect(
      page.getByRole('heading', { name: `Im Papierkorb (gelöscht von ${anna.name} heute)`, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect(editorOf(page).title).toHaveValue(recipe.title);
    expect((await getRecipe(server, recipe.id, anna.id)).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------ d8

test.describe('d8: Speichern bei gestopptem Server (F-09, NF-09)', () => {
  test('„Speichern fehlgeschlagen“ mit „Erneut versuchen“, Eingaben bleiben; nach dem Serverstart genau ein Rezept @phone @tablet @desktop', async ({
    page,
    freshServer,
  }) => {
    const anna = await freshServer.api.createProfile('Anna');
    const title = 'Linsensuppe mit Speck';
    await useProfile(page, anna.id);
    await page.goto(`${freshServer.url}/rezepte`);
    await page.getByRole('link', { name: 'Neues Rezept', exact: true }).click();
    await typeTitleAndTwoIngredients(page, title);

    await freshServer.stop();
    await editorOf(page).save.click();
    const failed = toastWith(page, 'Speichern fehlgeschlagen');
    await expect(failed).toBeVisible();
    const retry = failed.getByRole('button', { name: 'Erneut versuchen' });
    await expect(retry).toBeVisible();
    await expect(page).toHaveURL(/\/rezepte\/neu$/);
    await expectTitleAndTwoIngredients(page, title);

    // The toast timer pauses while its button has the focus, so the restart may take longer than 8 s.
    await retry.focus();
    await freshServer.restart();
    await retry.click();
    await expect(detailHeading(page, title)).toBeVisible();
    await expect(page).toHaveURL(/\/rezepte\/\d+$/);

    await page.goto(`${freshServer.url}/rezepte`);
    await expect(page.getByText('1 Rezept', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(1);
    const list = await listRecipes(freshServer, anna.id);
    expect(list.total).toBe(1);
    expect(list.items.map((r) => r.title)).toEqual([title]);
  });

  test('geht die Antwort verloren, legt erneutes „Speichern“ das Rezept trotzdem nur einmal an @phone @tablet @desktop', async ({
    page,
    freshServer,
  }) => {
    const anna = await freshServer.api.createProfile('Anna');
    const title = 'Kürbissuppe';
    await useProfile(page, anna.id);
    await page.goto(`${freshServer.url}/rezepte/neu`);
    await typeTitleAndTwoIngredients(page, title);

    // The server stores the recipe, but the answer never reaches the device (WLAN drops).
    await page.route('**/api/v1/recipes', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fetch();
      return route.abort('connectionreset');
    });
    await editorOf(page).save.click();
    await expect(toastWith(page, 'Speichern fehlgeschlagen')).toBeVisible();
    expect((await listRecipes(freshServer, anna.id)).total).toBe(1);
    await expectTitleAndTwoIngredients(page, title);

    await page.unroute('**/api/v1/recipes');
    await editorOf(page).save.click();
    await expect(detailHeading(page, title)).toBeVisible();
    const list = await listRecipes(freshServer, anna.id);
    expect(list.total).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/rezepte/${list.items[0]?.id}$`));
  });
});
