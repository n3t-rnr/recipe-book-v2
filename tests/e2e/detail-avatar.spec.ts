// Profile switch from the recipe detail (F-03 AK "aus Liste, Detail, …"; owner decision 25.09.2026):
// phones and tablets in portrait show the avatar over the photo, from 1024 px it stays in the rail.
import type { Page } from '@playwright/test';
import { expect, test, useProfile } from './fixtures.ts';

let counter = 0;

/** Two profiles with unique names in the shared worker server, one recipe, profile `first` active. */
async function setup(page: Page, server: import('./fixtures.ts').AppServer) {
  const tag = `${test.info().project.name}-${test.info().workerIndex}-${counter++}`;
  const first = await server.api.createProfile(`Erika ${tag}`);
  const second = await server.api.createProfile(`Bruno ${tag}`);
  const recipe = await server.api.createRecipe(first.id, { title: `Avatar-Test ${tag}` });
  await useProfile(page, first.id);
  return { first, second, recipe };
}

const switchButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Profil wechseln, aktiv: ${name}` });

test('Profil im Rezept mit 2 Fingertipps wechseln (Handy) @phone', async ({ page, server }) => {
  const { first, second, recipe } = await setup(page, server);
  await page.goto(`${server.url}/rezepte/${recipe.id}`);
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();

  await switchButton(page, first.name).click();
  await page.getByRole('button', { name: second.name }).click();

  await expect(switchButton(page, second.name)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('profileId'))).toBe(String(second.id));
});

test('Profil im Rezept mit 2 Fingertipps wechseln (iPad hochkant) @tablet', async ({ page, server }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const { first, second, recipe } = await setup(page, server);
  await page.goto(`${server.url}/rezepte/${recipe.id}`);
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();

  await switchButton(page, first.name).click();
  await page.getByRole('button', { name: second.name }).click();

  await expect(switchButton(page, second.name)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('profileId'))).toBe(String(second.id));
});

test('Avatar über dem Foto sitzt oben rechts und ist mindestens 44 px groß @phone', async ({
  page,
  server,
}) => {
  const { first, recipe } = await setup(page, server);
  await page.goto(`${server.url}/rezepte/${recipe.id}`);
  const box = await switchButton(page, first.name).boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeGreaterThan(viewport.width - 80);
  expect(box.y).toBeLessThan(80);
});

test('ab 1024 px bleibt der Avatar in der Leiste, nicht im Rezept @tablet @desktop', async ({
  page,
  server,
}) => {
  const { first, recipe } = await setup(page, server);
  await page.goto(`${server.url}/rezepte/${recipe.id}`);
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();
  // Exactly one avatar button on the page: the one in the rail.
  await expect(switchButton(page, first.name)).toHaveCount(1);
  await expect(page.locator('article').getByRole('button', { name: /^Profil wechseln/ })).toHaveCount(0);
});

test('auch ein Rezept im Papierkorb bietet den Profilwechsel @phone', async ({ page, server }) => {
  const { first, recipe } = await setup(page, server);
  const res = await server.api.request('DELETE', `/api/v1/recipes/${recipe.id}`, { profileId: first.id });
  expect(res.status).toBe(204);
  await page.goto(`${server.url}/rezepte/${recipe.id}`);
  await expect(page.getByText(/Im Papierkorb/)).toBeVisible();
  await expect(switchButton(page, first.name)).toBeVisible();
});
