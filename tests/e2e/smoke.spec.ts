import { ds } from '../../client/src/i18n/de-screens.ts';
import { expect, test, useProfile } from './fixtures.ts';

test('leere Datenbank startet in der Profilwahl @phone @tablet @desktop', async ({ page, freshServer }) => {
  await page.goto(`${freshServer.url}/`);
  await expect(page.getByRole('heading', { name: 'Wer kocht?' })).toBeVisible();
});

test('ein angelegtes Rezept erscheint in der Liste @phone @tablet @desktop', async ({ page, server }) => {
  const profile = await server.api.createProfile(`Smoke ${test.info().project.name}`);
  const recipe = await server.api.createRecipe(profile.id, {
    title: `Smoke-Suppe ${test.info().project.name}`,
  });
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await expect(page.getByText(recipe.title).first()).toBeVisible();
});

// NF-29 smoke flow for M4: search, then filter by a tag chip (details: search.spec.ts, filters.spec.ts).
test('suchen und filtern @phone @tablet @desktop', async ({ page, freshServer }) => {
  const profile = await freshServer.api.createProfile('Smoke');
  await freshServer.api.createRecipe(profile.id, { title: 'Kürbissuppe', tags: ['Suppe', 'Vegetarisch'] });
  await freshServer.api.createRecipe(profile.id, { title: 'Gulaschsuppe', tags: ['Suppe'] });
  await freshServer.api.createRecipe(profile.id, { title: 'Apfelkuchen', tags: ['Backen'] });
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte`);
  const list = page.getByRole('main').getByRole('list').first();
  const count = page.locator('main p.count');
  await expect(count).toHaveText('3 Rezepte');

  await page.getByRole('searchbox', { name: ds.list.search, exact: true }).fill('suppe');
  await expect(count).toHaveText('2 von 3 Rezepten');
  await expect(list.getByRole('link')).toHaveCount(2);
  await expect(list.getByRole('link', { name: 'Kürbissuppe' })).toBeVisible();
  await expect(list.getByRole('link', { name: 'Gulaschsuppe' })).toBeVisible();

  await page
    .getByRole('group', { name: ds.list.chips })
    .getByRole('button', { name: 'Vegetarisch', exact: true })
    .click();
  await expect(count).toHaveText('1 von 3 Rezepten');
  await expect(list.getByRole('link')).toHaveText(['Kürbissuppe']);
  await expect(page).toHaveURL(/\/rezepte\?q=suppe&tags=\d+$/);
});
