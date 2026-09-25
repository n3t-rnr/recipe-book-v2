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
