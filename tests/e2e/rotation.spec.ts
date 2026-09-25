// Turning the tablet (NF-08, chapter 6.8 "Drehen: Zustand bleibt, Layout wechselt"). Checklist: e5.
// - Landscape (1024×768): list left, detail right; tapping a recipe changes only the detail column.
// - Landscape → portrait → landscape on a recipe far down: the recipe stays open, list and detail stand
//   where they stood.
// - Landscape ↔ portrait on /rezepte: rows (landscape) and two-column cards (portrait) differ in height;
//   the first visible recipe stays in view, a list at the very top stays at the top.
// - The last recipe at the very end of the list: the list stands exactly where it stood (while turning, the
//   columns briefly get the portrait height; without max-height 0 the browser cut the position by ~250 px).
// - A recipe opened in portrait is marked and in view in the list column after turning back.
// - 12.9" iPad Pro: portrait is 1024 px wide, so both columns stay and keep their positions.
// - Only turning carries a scroll position over, not a navigation to a one-pane route.
// Turning = page.setViewportSize (Playwright cannot turn a real iPad; the app only reacts to the width,
// NF-08). freshServer: the list order depends only on this test's recipes. 60 recipes = two pages.
import type { Locator, Page } from '@playwright/test';
import { LIMITS } from '../../shared/constants.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';

const LANDSCAPE = { width: 1024, height: 768 };
const PORTRAIT = { width: 768, height: 1024 };
const RECIPES = 60;
const FIRST_PAGE = Math.min(RECIPES, LIMITS.pageSize);

/** Recipes with long ingredient lists and steps, so that list and detail scroll. */
async function seed(server: AppServer): Promise<number> {
  const profile = await server.api.createProfile('Drehtest');
  const ingredients = Array.from({ length: 14 }, (_, i) => ({
    amount: i + 1,
    unit: 'g',
    name: `Zutat ${i + 1}`,
  }));
  const steps = Array.from({ length: 8 }, (_, i) => ({
    text: `Schritt ${i + 1}: Alles gut verrühren, abschmecken und in Ruhe weiter köcheln lassen, bis es duftet.`,
  }));
  for (let i = 1; i <= RECIPES; i++) {
    await server.api.createRecipe(profile.id, {
      title: `Drehrezept ${String(i).padStart(2, '0')}`,
      ingredients,
      steps,
    });
  }
  return profile.id;
}

function panes(page: Page): { list: Locator; detail: Locator } {
  return {
    list: page.getByRole('region', { name: 'Rezepte', exact: true }),
    detail: page.getByRole('region', { name: 'Rezept', exact: true }),
  };
}

function scrollTop(el: Locator): Promise<number> {
  return el.evaluate((node) => node.scrollTop);
}

function windowScroll(page: Page): Promise<number> {
  return page.evaluate(() => Math.round(window.scrollY));
}

/** Lets two animation frames pass: pending scroll restores of the router run once per frame. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

/** Whether the element lies completely inside the visible part of the list column. */
function fullyInListColumn(el: Locator): Promise<boolean> {
  return el.evaluate((node) => {
    const pane = node.closest('section')?.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return pane !== undefined && box.top >= pane.top && box.bottom <= pane.bottom;
  });
}

/** Title of the first recipe whose top edge is visible: in the list column (quer) or in the window. */
function firstVisibleRecipe(page: Page): Promise<string> {
  return page.evaluate(() => {
    const pane = document.querySelector('main section[aria-label="Rezepte"]');
    const top = pane ? pane.getBoundingClientRect().top : 0;
    for (const item of document.querySelectorAll('main li')) {
      const link = item.querySelector('a[href^="/rezepte/"]');
      if (link && item.getBoundingClientRect().top >= top - 1) return link.textContent?.trim() ?? '';
    }
    return '';
  });
}

test('quer: Rezept weit unten antippen ändert nur das Detail; Drehen behält Rezept, Liste und Detailposition @tablet', async ({
  page,
  freshServer,
}) => {
  await useProfile(page, await seed(freshServer));
  await page.setViewportSize(LANDSCAPE);
  await page.goto(`${freshServer.url}/rezepte`);
  const { list, detail } = panes(page);
  await expect(list).toBeVisible();
  await expect(detail).toBeVisible();
  const [listBox, detailBox] = [await list.boundingBox(), await detail.boundingBox()];
  expect(listBox && detailBox && listBox.x + listBox.width <= detailBox.x + 1).toBe(true);
  await expect(list.getByRole('listitem')).toHaveCount(FIRST_PAGE);

  // A recipe far down: scroll the list column to it, then tap it.
  const link = list.getByRole('listitem').nth(30).getByRole('link');
  await link.scrollIntoViewIfNeeded();
  const listTop = await scrollTop(list);
  expect(listTop).toBeGreaterThan(1000);
  // Near the end of the list column its next page loads (observer root = list column).
  await expect(list.getByRole('listitem')).toHaveCount(RECIPES);
  const title = (await link.textContent())?.trim() ?? '';
  await link.click();

  await expect(page).toHaveURL(/\/rezepte\/\d+$/);
  const url = page.url();
  await expect(detail.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(link).toHaveAttribute('aria-current', 'page');
  // Only the detail column changed: the list column did not move.
  expect(Math.abs((await scrollTop(list)) - listTop)).toBeLessThanOrEqual(1);
  await expect(link).toBeInViewport();

  // Reading position in the detail column.
  await detail.evaluate((node) => node.scrollTo(0, 300));
  await expect.poll(() => scrollTop(detail)).toBe(300);

  // Portrait: one column with the same recipe; the reading position comes along.
  await page.setViewportSize(PORTRAIT);
  await expect(list).toHaveCount(0);
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeAttached();
  await expect.poll(() => windowScroll(page)).toBe(300);

  // Back to landscape: same recipe; the list column stands where it stood, the detail as well.
  await page.setViewportSize(LANDSCAPE);
  await expect(list).toBeVisible();
  await expect(page).toHaveURL(url);
  await expect(detail.getByRole('heading', { level: 1, name: title })).toBeAttached();
  await expect.poll(async () => Math.abs((await scrollTop(list)) - listTop)).toBeLessThanOrEqual(1);
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(link).toBeInViewport();
  await expect.poll(() => scrollTop(detail)).toBe(300);
});

test('quer: das letzte Rezept ganz unten öffnen, hochkant und wieder quer drehen: die Liste steht genau wie vorher @tablet', async ({
  page,
  freshServer,
}) => {
  await useProfile(page, await seed(freshServer));
  await page.setViewportSize(LANDSCAPE);
  await page.goto(`${freshServer.url}/rezepte`);
  const { list, detail } = panes(page);
  await expect(list.getByRole('listitem')).toHaveCount(FIRST_PAGE);

  // Scroll the list column to its very end (the second page loads on the way).
  await list.getByRole('listitem').last().scrollIntoViewIfNeeded();
  await expect(list.getByRole('listitem')).toHaveCount(RECIPES);
  await expect
    .poll(async () => {
      await list.evaluate((node) => node.scrollTo(0, node.scrollHeight));
      return list.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
    })
    .toBeLessThanOrEqual(1);
  const link = list.getByRole('listitem').last().getByRole('link');
  const title = (await link.textContent())?.trim() ?? '';
  await link.click();
  await expect(detail.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const listTop = await scrollTop(list);
  expect(listTop).toBeGreaterThan(1000);

  await page.setViewportSize(PORTRAIT);
  await expect(list).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeAttached();
  await page.setViewportSize(LANDSCAPE);
  await expect(list).toBeVisible();
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect.poll(async () => Math.abs((await scrollTop(list)) - listTop)).toBeLessThanOrEqual(1);
  expect(await fullyInListColumn(link)).toBe(true);
});

test('hochkant ein anderes Rezept öffnen, dann quer drehen: die Liste zeigt dieses Rezept markiert @tablet', async ({
  page,
  freshServer,
}) => {
  await useProfile(page, await seed(freshServer));
  await page.setViewportSize(LANDSCAPE);
  await page.goto(`${freshServer.url}/rezepte`);
  const { list, detail } = panes(page);
  const far = list.getByRole('listitem').nth(30).getByRole('link');
  await far.scrollIntoViewIfNeeded();
  await far.click();
  await expect(detail.getByRole('heading', { level: 1 })).toBeVisible();

  // Portrait: back to the list (it starts at the top there), open a recipe near the top.
  await page.setViewportSize(PORTRAIT);
  await expect(list).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/rezepte$/);
  const near = page.getByRole('listitem').nth(1).getByRole('link');
  const nearTitle = (await near.textContent())?.trim() ?? '';
  await near.click();
  await expect(page.getByRole('heading', { level: 1, name: nearTitle })).toBeVisible();

  // Landscape: this recipe is the marked row, in view (not the list position of the first recipe).
  await page.setViewportSize(LANDSCAPE);
  const nearRow = list.getByRole('link', { name: nearTitle, exact: true });
  await expect(nearRow).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => fullyInListColumn(nearRow)).toBe(true);

  // Once more with a recipe far down that was opened in portrait.
  await page.setViewportSize(PORTRAIT);
  await page.goBack();
  await expect(page).toHaveURL(/\/rezepte$/);
  const later = page.getByRole('listitem').nth(44).getByRole('link');
  await later.scrollIntoViewIfNeeded();
  const laterTitle = (await later.textContent())?.trim() ?? '';
  await later.click();
  await expect(page.getByRole('heading', { level: 1, name: laterTitle })).toBeVisible();
  await page.setViewportSize(LANDSCAPE);
  const laterRow = list.getByRole('link', { name: laterTitle, exact: true });
  await expect(laterRow).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => fullyInListColumn(laterRow)).toBe(true);
});

test('iPad Pro 12,9″: hochkant (1024 px breit) bleiben Liste und Detail nebeneinander und stehen, wo sie standen @tablet', async ({
  page,
  freshServer,
}) => {
  await useProfile(page, await seed(freshServer));
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto(`${freshServer.url}/rezepte`);
  const { list, detail } = panes(page);
  const link = list.getByRole('listitem').nth(30).getByRole('link');
  await link.scrollIntoViewIfNeeded();
  await link.click();
  const title = (await link.textContent())?.trim() ?? '';
  await expect(detail.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await detail.evaluate((node) => node.scrollTo(0, 150));
  await expect.poll(() => scrollTop(detail)).toBe(150);
  const listTop = await scrollTop(list);
  expect(listTop).toBeGreaterThan(1000);
  const url = page.url();

  await page.setViewportSize({ width: 1024, height: 1366 });
  await nextFrames(page);
  await expect(list).toBeVisible();
  await expect(detail.getByRole('heading', { level: 1, name: title })).toBeAttached();
  await expect(page).toHaveURL(url);
  expect(Math.abs((await scrollTop(list)) - listTop)).toBeLessThanOrEqual(1);
  // The narrower detail column reflows; the browser keeps the content in place, so only "not back at the top".
  expect(await scrollTop(detail)).toBeGreaterThan(0);
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(link).toBeInViewport();
});

test('Rezeptliste: beim Drehen bleibt das erste sichtbare Rezept im Blick @tablet', async ({
  page,
  freshServer,
}) => {
  await useProfile(page, await seed(freshServer));
  await page.setViewportSize(LANDSCAPE);
  await page.goto(`${freshServer.url}/rezepte`);
  const { list } = panes(page);
  await expect(list.getByRole('listitem')).toHaveCount(FIRST_PAGE);

  // Landscape → portrait: compact rows in the list column become two-column cards in the window.
  await list.getByRole('listitem').nth(18).getByRole('link').scrollIntoViewIfNeeded();
  const firstLandscape = await firstVisibleRecipe(page);
  expect(firstLandscape).toMatch(/^Drehrezept \d\d$/);
  await page.setViewportSize(PORTRAIT);
  await expect(list).toHaveCount(0);
  await expect(page.getByRole('link', { name: firstLandscape, exact: true })).toBeInViewport();

  // Portrait → landscape after scrolling further down in the cards.
  await page.getByRole('listitem').nth(26).getByRole('link').scrollIntoViewIfNeeded();
  const firstPortrait = await firstVisibleRecipe(page);
  expect(firstPortrait).not.toBe(firstLandscape);
  await page.setViewportSize(LANDSCAPE);
  await expect(list).toBeVisible();
  await expect(list.getByRole('link', { name: firstPortrait, exact: true })).toBeInViewport();
});

test('Rezeptliste ganz oben: nach dem Drehen bleiben Überschrift und erstes Rezept sichtbar @tablet', async ({
  page,
  freshServer,
}) => {
  await useProfile(page, await seed(freshServer));
  await page.setViewportSize(PORTRAIT);
  await page.goto(`${freshServer.url}/rezepte`);
  await expect(page.getByRole('listitem')).toHaveCount(FIRST_PAGE);
  const first = await firstVisibleRecipe(page);

  await page.setViewportSize(LANDSCAPE);
  const { list } = panes(page);
  await expect(list).toBeVisible();
  await expect(list.getByRole('heading', { level: 1, name: 'Rezepte' })).toBeInViewport();
  await expect(list.getByRole('link', { name: first, exact: true })).toBeInViewport();
  await nextFrames(page);
  expect(await scrollTop(list)).toBe(0);

  await page.setViewportSize(PORTRAIT);
  await expect(list).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Rezepte' })).toBeInViewport();
  await nextFrames(page);
  expect(await windowScroll(page)).toBe(0);
});

test('quer: „Bearbeiten“ öffnet den Editor oben, auch wenn die Liste weit gescrollt ist @tablet', async ({
  page,
  freshServer,
}) => {
  await useProfile(page, await seed(freshServer));
  await page.setViewportSize(LANDSCAPE);
  await page.goto(`${freshServer.url}/rezepte`);
  const { list, detail } = panes(page);
  const link = list.getByRole('listitem').nth(30).getByRole('link');
  await link.scrollIntoViewIfNeeded();
  expect(await scrollTop(list)).toBeGreaterThan(1000);
  await link.click();
  await detail.getByRole('link', { name: 'Bearbeiten' }).click();

  await expect(page).toHaveURL(/\/rezepte\/\d+\/bearbeiten$/);
  const titleField = page.getByRole('textbox', { name: 'Titel' });
  await expect(titleField).toHaveValue(/^Drehrezept \d\d$/);
  // The router starts a new page at the top; the list column's offset must not move the editor.
  await nextFrames(page);
  await expect(titleField).toBeInViewport();
  await expect.poll(() => windowScroll(page)).toBe(0);
});
