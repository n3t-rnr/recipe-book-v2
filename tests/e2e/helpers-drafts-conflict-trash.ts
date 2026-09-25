// Helpers of tests/e2e/drafts-conflict-trash.spec.ts: a second device (own browser context with the CSP and
// page-error guard of fixtures.ts), editor locators, toast lookup and small API reads.
import {
  type Browser,
  type BrowserContextOptions,
  devices,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import type { RecipeDetail, RecipeListResponse, TrashResponse } from '../../shared/types.ts';
import { type AppServer, useProfile } from './fixtures.ts';

let seq = 0;

/** Unique suffix for names on the worker's shared server, e.g. "pc0w1-3" (project, repeat, worker, counter). */
export function uid(info: {
  project: { name: string };
  repeatEachIndex: number;
  workerIndex: number;
}): string {
  const project = info.project.name
    .split('-')
    .map((part) => part[0] ?? '')
    .join('');
  seq += 1;
  return `${project}${info.repeatEachIndex}w${info.workerIndex}-${seq}`;
}

/**
 * Collects uncaught browser errors and CSP violations of a page the fixtures do not guard (a second tab
 * or device), like the automatic guard of fixtures.ts does for `page`.
 */
export async function watchProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`Fehler im Browser: ${error.message}`));
  await page.exposeFunction('__e2eReportCsp', (text: string) => problems.push(`CSP-Verstoß: ${text}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const w = window as unknown as { __e2eReportCsp?: (text: string) => void };
      w.__e2eReportCsp?.(`${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}`);
    });
  });
  return problems;
}

export type DeviceKind = 'phone' | 'tablet';

/** Device options for a second context in the same browser engine (tablet: iPad landscape as in the config). */
function deviceOptions(kind: DeviceKind, engine: string): BrowserContextOptions {
  const descriptor =
    kind === 'tablet'
      ? { ...devices['iPad (gen 7)'], viewport: { width: 1024, height: 768 } }
      : engine === 'webkit'
        ? devices['iPhone 14']
        : devices['Pixel 7'];
  const { defaultBrowserType: _engine, ...options } = descriptor;
  return { ...options, locale: 'de-DE', timezoneId: 'Europe/Berlin' };
}

export interface Device {
  page: Page;
  /** Fails on browser errors or CSP violations seen on the device, then closes its context. */
  close(): Promise<void>;
}

/** A second device with its own storage (another phone or tablet in the same LAN), profile remembered. */
export async function openDevice(browser: Browser, kind: DeviceKind, profileId: number): Promise<Device> {
  const context = await browser.newContext(deviceOptions(kind, browser.browserType().name()));
  const page = await context.newPage();
  const problems = await watchProblems(page);
  await useProfile(page, profileId);
  return {
    page,
    async close() {
      // Read the problems before closing: Playwright's WebKit inserts an inline stylesheet from
      // web-inspector://bootstrap.js while a context closes, which the app's CSP reports (not the app).
      const seen = [...problems];
      await context.close();
      expect(seen, `CSP-Verstöße und Fehler im Browser (zweites Gerät: ${kind})`).toEqual([]);
    },
  };
}

/** Editor fields by their visible labels (Kap. 6.3 "Editor"). */
export function editorOf(page: Page) {
  return {
    title: page.getByRole('textbox', { name: 'Titel', exact: true }),
    ingredient(n: number) {
      const row = page.getByRole('group', { name: `Zutat ${n}`, exact: true });
      return {
        amount: row.getByLabel('Menge', { exact: true }),
        unit: row.getByLabel('Einheit', { exact: true }),
        name: row.getByLabel('Zutat', { exact: true }),
      };
    },
    addIngredient: page.getByRole('button', { name: 'Zutat hinzufügen' }),
    save: page.getByRole('button', { name: 'Speichern', exact: true }),
    cancel: page.getByRole('button', { name: 'Abbrechen', exact: true }),
    back: page.getByRole('button', { name: 'Zurück', exact: true }),
  };
}

/** The toast with exactly this message (the live region of the toast host), for its action button. */
export function toastWith(page: Page, message: string): Locator {
  return page.locator('[aria-live="polite"]').filter({ has: page.getByText(message, { exact: true }) });
}

/** The h1 of the recipe detail. */
export function detailHeading(page: Page, title: string): Locator {
  return page.getByRole('heading', { level: 1, name: title, exact: true });
}

/** Opens "Weitere Aktionen" in the detail and chooses "In den Papierkorb". */
export async function moveToTrashInDetail(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Weitere Aktionen' });
  await sheet.getByRole('button', { name: 'In den Papierkorb' }).click();
}

/** localStorage entry of the page (drafts are stored under draft:new / draft:<id>, F-09). */
export function storageItem(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

/**
 * Resolves once the editor's back guard (a history entry pushed while there are unsaved changes, F-09 AK)
 * is on top, so a browser Back hits the guard like the Android back button or the iOS back gesture does.
 */
export async function waitForBackGuard(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (history.state as { overlay?: unknown } | null)?.overlay === true))
    .toBe(true);
}

/** Counts the page's history steps (popstate events) from the next load on; read with historySteps(). */
export async function countHistorySteps(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2eSteps: number };
    w.__e2eSteps = 0;
    addEventListener('popstate', () => {
      w.__e2eSteps += 1;
    });
  });
}

export function historySteps(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __e2eSteps?: number }).__e2eSteps ?? 0);
}

export async function getRecipe(
  server: AppServer,
  id: number,
  profileId: number,
): Promise<{ status: number; recipe: RecipeDetail | null; code: string | null }> {
  const res = await server.api.request('GET', `/api/v1/recipes/${id}`, { profileId });
  const body = (await res.json()) as { recipe?: RecipeDetail; error?: { code?: string } };
  return { status: res.status, recipe: body.recipe ?? null, code: body.error?.code ?? null };
}

export async function listRecipes(server: AppServer, profileId: number): Promise<RecipeListResponse> {
  const res = await server.api.request('GET', '/api/v1/recipes', { profileId });
  expect(res.status).toBe(200);
  return (await res.json()) as RecipeListResponse;
}

export async function trashItems(server: AppServer, profileId: number): Promise<TrashResponse['items']> {
  const res = await server.api.request('GET', '/api/v1/trash', { profileId });
  expect(res.status).toBe(200);
  return ((await res.json()) as TrashResponse).items;
}

export async function trashViaApi(server: AppServer, id: number, profileId: number): Promise<void> {
  const res = await server.api.request('DELETE', `/api/v1/recipes/${id}`, { profileId });
  expect(res.status, 'Rezept in den Papierkorb legen').toBe(204);
}
