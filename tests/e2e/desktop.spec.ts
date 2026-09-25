// Manual test checklist, section F ("Am PC"), automated on desktop-chromium (1440 × 900):
//   f1  image variants per view (list -s, detail -m, full screen -l), the immutable cache header of /media
//       and the browser cache after a reload (1440 px, and 1024 px wide and low at 200 % Windows scaling)
//   f2  Mehr → Status: "Bildverarbeitung: Bereit" (and "Nicht verfügbar" when the server says so), "Bilder"
//       counts a photo chosen in the editor and discarded, no sizes before M6
//   f3  Mehr → Anderes Gerät verbinden: addresses, the QR code on screen compared module by module with the
//       reference encoding of the first address (light and dark), and a phone opening that address uses the app
//       (a real phone camera and the real WLAN/firewall path stay manual)
//   f4  every processed image writes one "image processed" line to <DATA_DIR>/logs/app.log with durationMs
//       (≤ 2000 for a 12-MP photo), rssMb and maxRssMb, found by the checklist's Select-String command
//       (field details: tests/api/images.test.ts)
//   f6  creating a recipe with the keyboard only: Tab reaches everything with a visible focus ring, Enter
//       moves to the next field (tag field: adds the tag, last ingredient: new row, text areas: line break),
//       Ctrl+Enter saves; Escape closes the profile sheet, the menu sheet, dialogs and full screen

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { devices, type Locator, type Page } from '@playwright/test';
import qrcode from 'qrcode-generator';
import sharp from 'sharp';
import { de } from '../../client/src/i18n/de.ts';
import { deEditor } from '../../client/src/i18n/de-editor.ts';
import { dl } from '../../client/src/i18n/de-screens-lazy.ts';
import type { RecipeResponse } from '../../shared/types.ts';
import { portraitPhoto12mp, smallJpeg } from '../helpers/images.ts';
import { type AppServer, expect, startServer, test, useProfile } from './fixtures.ts';

const IMMUTABLE = 'public, max-age=31536000, immutable';

let counter = 0;

/** Names stay unique on the worker's shared server, also across --repeat-each runs. */
function unique(label: string): string {
  const info = test.info();
  counter += 1;
  return `${label} ${info.project.name} w${info.workerIndex}r${info.repeatEachIndex}n${counter}`;
}

/** Parsed JSON lines of <DATA_DIR>/logs/app.log (NF-25). */
function logEntries(dataDir: string): Array<Record<string, unknown>> {
  const file = path.join(dataDir, 'logs', 'app.log');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Paths of all /media requests that reached the server (one "request" log line each). */
function mediaHits(dataDir: string): string[] {
  return logEntries(dataDir)
    .filter((e) => e.msg === 'request' && typeof e.path === 'string' && e.path.startsWith('/media/'))
    .map((e) => String(e.path));
}

async function expectImageLoaded(img: Locator): Promise<void> {
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0))
    .toBe(true);
}

async function recipeFromApi(
  server: AppServer,
  profileId: number,
  id: number,
): Promise<RecipeResponse['recipe']> {
  const res = await server.api.request('GET', `/api/v1/recipes/${id}`, { profileId });
  expect(res.status).toBe(200);
  return ((await res.json()) as RecipeResponse).recipe;
}

// ---------------------------------------------------------------------------------------------- f1

/**
 * f1: records which /media files the browser asks for in each step and which reach the server (request
 * log lines of a server with LOG_LEVEL=info), so "nach F5 aus dem Cache" is measured on the server side.
 */
async function checkImageVariants(page: Page): Promise<void> {
  test.slow();
  const srv = await startServer({ LOG_LEVEL: 'info' });
  try {
    const profile = await srv.api.createProfile(unique('Bilder'));
    const recipes = [];
    for (const n of [1, 2, 3]) {
      // 1500 × 1000: m (1200 w) is larger than s (720 w), so the list rows get a real s/m srcset.
      const image = await srv.api.uploadImage(profile.id, await smallJpeg(1500, 1000));
      recipes.push(
        await srv.api.createRecipe(profile.id, { title: unique(`Bildrezept ${n}`), imageId: image.imageId }),
      );
    }
    const images = recipes.map((r) => {
      if (!r.image) throw new Error('Rezept ohne Bild angelegt');
      return r.image.urls;
    });
    const first = recipes[0];
    const firstUrls = images[0];
    if (!first || !firstUrls) throw new Error('keine Testrezepte');

    const requested: string[] = [];
    const cacheHeaders = new Map<string, string | undefined>();
    page.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (pathname.startsWith('/media/')) requested.push(pathname);
    });
    page.on('response', (res) => {
      const { pathname } = new URL(res.url());
      if (pathname.startsWith('/media/')) cacheHeaders.set(pathname, res.headers()['cache-control']);
    });
    const newSince = (from: number): string[] => [...new Set(requested.slice(from))].sort();

    await useProfile(page, profile.id);
    await page.goto(`${srv.url}/rezepte`);
    // From 1024 px the list shows rows (CompactRow, 112 px images) next to the detail column. The rows
    // offer s and m; the browser picks s. The row images are decorative (alt ""), so no img role.
    const rowImages = page.getByRole('region', { name: de.nav.recipes, exact: true }).locator('img');
    await expect(rowImages).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expectImageLoaded(rowImages.nth(i));
      await expect(rowImages.nth(i)).toHaveAttribute('sizes', '112px');
      await expect(rowImages.nth(i)).toHaveAttribute(
        'srcset',
        /-s\.webp 720w, \/media\/[0-9a-f]{16}-m\.webp 1200w$/,
      );
    }
    expect(newSince(0), 'Liste lädt nur -s').toEqual(images.map((u) => u.s).sort());
    expect(requested.filter((p) => !p.endsWith('-s.webp'))).toEqual([]);

    // Open a recipe: the detail column loads -m only.
    let mark = requested.length;
    await page.getByRole('link', { name: first.title }).click();
    await expect(page).toHaveURL(new RegExp(`/rezepte/${first.id}$`));
    const detailPhoto = page.getByRole('img', { name: de.recipe.photo(first.title) });
    await expectImageLoaded(detailPhoto);
    expect(await detailPhoto.getAttribute('src')).toBe(firstUrls.m);
    expect(await detailPhoto.getAttribute('srcset')).toBeNull();
    expect(
      newSince(mark).filter((p) => !p.endsWith('-s.webp')),
      'Detail lädt -m',
    ).toEqual([firstUrls.m]);

    // Full screen: variant -l.
    mark = requested.length;
    await page.getByRole('button', { name: dl.detail.zoom }).click();
    const lightbox = page.getByRole('dialog', { name: first.title });
    const fullPhoto = lightbox.getByRole('img', { name: first.title });
    await expectImageLoaded(fullPhoto);
    expect(newSince(mark).filter((p) => !p.endsWith('-s.webp') && !p.endsWith('-m.webp'))).toEqual([
      firstUrls.l,
    ]);
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();

    // No other view loaded -l, and the server saw exactly these files once each.
    expect(requested.filter((p) => p.endsWith('-l.webp'))).toEqual([firstUrls.l]);
    const expectedHits = [...images.map((u) => u.s), firstUrls.m, firstUrls.l].sort();
    expect(mediaHits(srv.dataDir).sort()).toEqual(expectedHits);
    // Every /media answer may be cached for a year and never revalidated (NF-06).
    expect([...cacheHeaders.keys()].sort()).toEqual(expectedHits);
    for (const [file, value] of cacheHeaders) expect(value, file).toBe(IMMUTABLE);

    // F5: all images are shown again, but no /media request reaches the server.
    await page.reload();
    await expect(rowImages).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expectImageLoaded(rowImages.nth(i));
    await expectImageLoaded(page.getByRole('img', { name: de.recipe.photo(first.title) }));
    expect(
      mediaHits(srv.dataDir).sort(),
      'nach dem Neuladen kommen die Bilder aus dem Browser-Cache',
    ).toEqual(expectedHits);
  } finally {
    await page.goto('about:blank');
    await srv.dispose();
  }
}

test('f1: Liste lädt nur -s, Detail -m, Vollbild -l; nach dem Neuladen kommen die Bilder aus dem Cache @desktop', async ({
  page,
}) => {
  await checkImageVariants(page);
});

// The checklist's smallest case: DevTools docked at the bottom leaves a low window that is still 1024 px
// wide (rows, not cards), here with 200 % Windows scaling on top.
test.describe('bei 200 % Windows-Skalierung, 1024 px breit mit DevTools unten', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1024, height: 560 } });

  test('f1: auch bei 200 % Skalierung und 1024 px Breite lädt die Liste nur -s, das Detail -m und das Vollbild -l @desktop', async ({
    page,
  }) => {
    await checkImageVariants(page);
  });
});

// ---------------------------------------------------------------------------------------------- f2

/** The value next to `label` in a section of the status page. */
function statusValue(page: Page, section: string, label: string): Locator {
  return page
    .getByRole('region', { name: section })
    .locator('div')
    .filter({ has: page.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }) })
    .getByRole('definition');
}

test('f2: Mehr → Status zeigt „Bildverarbeitung: Bereit“ und zählt auch nicht gespeicherte Uploads @desktop', async ({
  page,
  freshServer,
}) => {
  const profile = await freshServer.api.createProfile('Status');
  const saved = await freshServer.api.uploadImage(profile.id, await smallJpeg(900, 600));
  await freshServer.api.createRecipe(profile.id, { title: 'Mit Foto', imageId: saved.imageId });

  // A photo chosen in the editor, then the editor is left with "Verwerfen": the upload is never saved
  // and stays as an unassigned image for 7 days (F-16).
  await useProfile(page, profile.id);
  await page.goto(`${freshServer.url}/rezepte/neu`);
  await page
    .locator('input[type="file"]:not([capture])')
    .setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await smallJpeg(600, 400) });
  await expect(page.getByText(deEditor.photo.uploaded, { exact: true })).toBeAttached({ timeout: 15_000 });
  await expect(page.getByRole('img', { name: deEditor.photo.preview })).toBeVisible();
  await page.getByRole('navigation', { name: de.nav.main }).getByRole('link', { name: de.nav.more }).click();
  const discard = page.getByRole('alertdialog', { name: deEditor.discard.title });
  await discard.getByRole('button', { name: deEditor.discard.confirm }).click();
  await expect(page).toHaveURL(/\/mehr$/);
  await page.getByRole('link', { name: new RegExp(`^${de.titles.status}`) }).click();
  await expect(page).toHaveURL(/\/mehr\/status$/);
  await expect(page.getByRole('heading', { level: 1, name: de.titles.status })).toBeVisible();

  await expect(statusValue(page, dl.status.server, dl.status.images)).toHaveText(dl.status.imageStates.ok);
  await expect(statusValue(page, dl.status.data, dl.status.imageCount)).toHaveText('2');
  await expect(statusValue(page, dl.status.data, dl.status.recipes)).toHaveText('1');
  // Only counts: the sizes of the images follow with F-42 in M6.
  await expect(page.getByRole('region', { name: dl.status.data }).getByRole('term')).toHaveText([
    dl.status.recipes,
    dl.status.trash,
    dl.status.imageCount,
    dl.status.profiles,
    dl.status.tags,
  ]);
  await expect(page.getByRole('main')).not.toContainText(/\d\s?(KB|MB|GB)/);

  // Another unsaved upload shows up after "Aktualisieren".
  await freshServer.api.uploadImage(profile.id, await smallJpeg(600, 400));
  await page.getByRole('button', { name: de.common.refresh }).click();
  await expect(statusValue(page, dl.status.data, dl.status.imageCount)).toHaveText('3');
  const health = (await (await freshServer.api.request('GET', '/api/v1/health')).json()) as {
    counts: { images: number };
  };
  expect(health.counts.images).toBe(3);

  // "Bereit" follows the server: without sharp (NF-24) the same row says "Nicht verfügbar"
  // (server side: tests/api/ops.test.ts › is degraded while image processing is unavailable).
  await page.route('**/api/v1/health', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: { ...body, ok: false, status: 'degraded', images: 'unavailable' },
    });
  });
  await page.getByRole('button', { name: de.common.refresh }).click();
  await expect(statusValue(page, dl.status.server, dl.status.images)).toHaveText(
    dl.status.imageStates.unavailable,
  );
  await expect(statusValue(page, dl.status.server, dl.status.state)).toHaveText(dl.status.states.degraded);
});

// ---------------------------------------------------------------------------------------------- f3

interface ServerInfo {
  urls: Array<{ url: string; kind: string }>;
  qrUrl: string;
  qrSvg: string;
}

/**
 * What a camera sees: samples the rendered QR image (a screenshot of the <img>) at the center of every
 * module and compares it with the reference encoding of `url` (qrcode-generator, level M, the library
 * the server uses) including the 4-module white quiet zone. Dark modules must be near black, light ones
 * near white, whatever the page's color scheme. Module centers cut off by the rounded corners of the
 * image (only the outermost quiet-zone corner) are skipped.
 */
async function expectQrEncodes(qr: Locator, url: string): Promise<void> {
  const reference = qrcode(0, 'M');
  reference.addData(url);
  reference.make();
  const count = reference.getModuleCount();
  const size = count + 8;
  const { data, info } = await sharp(await qr.screenshot())
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cssWidth = await qr.evaluate((el) => el.getBoundingClientRect().width);
  const radius =
    (await qr.evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius))) *
    (info.width / cssWidth);
  /** Distance of a coordinate into a corner zone of the rounded rectangle (0 outside the zones). */
  const inset = (c: number, extent: number): number =>
    c < radius ? radius - c : c > extent - radius ? c - (extent - radius) : 0;
  const wrong: string[] = [];
  let sampled = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = ((x + 0.5) * info.width) / size;
      const cy = ((y + 0.5) * info.height) / size;
      const dx = inset(cx, info.width);
      const dy = inset(cy, info.height);
      if (dx > 0 && dy > 0 && Math.hypot(dx, dy) > radius - 1.5) continue;
      const i = (Math.floor(cy) * info.width + Math.floor(cx)) * info.channels;
      const lum = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
      const inCode = x >= 4 && y >= 4 && x < count + 4 && y < count + 4;
      const dark = inCode && reference.isDark(y - 4, x - 4);
      sampled += 1;
      if (dark ? lum > 40 : lum < 215) wrong.push(`${x},${y}: ${Math.round(lum)}`);
    }
  }
  expect(sampled).toBeGreaterThan(size * size - 8);
  expect(wrong, `QR-Module abweichend von ${url}`).toEqual([]);
}

test('f3: Anderes Gerät verbinden zeigt die Adressen und den QR-Code; dessen Adresse öffnet die App @desktop', async ({
  page,
  freshServer: server,
  browser,
}) => {
  const profile = await server.api.createProfile('Verbinden');
  const recipe = await server.api.createRecipe(profile.id, { title: 'Handykuchen' });
  const info = (await (await server.api.request('GET', '/api/v1/server-info')).json()) as ServerInfo;
  expect(info.urls.length).toBeGreaterThan(0);
  expect(info.qrUrl).toBe(info.urls[0]?.url);

  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await page.getByRole('navigation', { name: de.nav.main }).getByRole('link', { name: de.nav.more }).click();
  await page.getByRole('link', { name: new RegExp(`^${de.titles.connect}`) }).click();
  await expect(page).toHaveURL(/\/mehr\/verbinden$/);
  await expect(page.getByRole('heading', { level: 1, name: de.titles.connect })).toBeVisible();

  // Every address as a link with the server's port, in the server's order.
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: /^http:\/\// })).toHaveText(info.urls.map((u) => u.url));
  for (const entry of info.urls) {
    expect(new URL(entry.url).port).toBe(String(server.port));
    await expect(main.getByRole('link', { name: entry.url, exact: true })).toHaveAttribute('href', entry.url);
  }

  // The QR code: the server's SVG for the first address, black on white, 240 px, loaded.
  const qr = main.getByRole('img', { name: dl.connect.qrCaption(info.qrUrl) });
  await expectImageLoaded(qr);
  const box = await qr.boundingBox();
  expect([box?.width, box?.height]).toEqual([240, 240]);
  const src = (await qr.getAttribute('src')) ?? '';
  expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
  const svg = decodeURIComponent(src.slice(src.indexOf(',') + 1));
  expect(svg).toBe(info.qrSvg);
  expect(svg).toContain(`aria-label="QR-Code: ${info.qrUrl}"`);
  expect(svg).toContain('fill="#FFFFFF"');
  expect(svg).toContain('fill="#000000"');
  await expect(main.getByText(dl.connect.qrCaption(info.qrUrl), { exact: true })).toBeVisible();
  // The pixels on screen are exactly the QR code of that address, black on white in both schemes.
  await expectQrEncodes(qr, info.qrUrl);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const [r = 255, g = 255, b = 255] = (
          getComputedStyle(document.body).backgroundColor.match(/\d+/g) ?? []
        ).map(Number);
        return 0.299 * r + 0.587 * g + 0.114 * b;
      }),
    )
    .toBeLessThan(80);
  await expectQrEncodes(qr, info.qrUrl);

  // A phone opens the QR address (what the camera app does after scanning). The test server listens on
  // 127.0.0.1 only, so the phone's requests to the LAN address are passed on to it. A new device has no
  // profile yet and lands in the profile choice; from there the app works as usual.
  const phone = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE' });
  try {
    const target = new URL(info.qrUrl);
    await phone.route(
      (url) => url.origin === target.origin,
      async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: `${server.url}${url.pathname}${url.search}` });
        await route.fulfill({ response });
      },
    );
    const phonePage = await phone.newPage();
    const errors: string[] = [];
    phonePage.on('pageerror', (error) => errors.push(error.message));
    await phonePage.goto(info.qrUrl);
    await expect(phonePage).toHaveURL(new RegExp(`^${target.origin}/`));
    await expect(phonePage.getByRole('heading', { name: de.titles.profile })).toBeVisible();
    await phonePage.getByRole('button', { name: new RegExp(profile.name) }).click();
    await expect(phonePage.getByRole('heading', { level: 1, name: de.titles.recipes })).toBeVisible();
    await expect(phonePage.getByText(recipe.title, { exact: true })).toBeVisible();
    await expect(phonePage).toHaveURL(new RegExp(`^${target.origin}/`));
    expect(errors).toEqual([]);
  } finally {
    await phone.close();
  }
});

// ---------------------------------------------------------------------------------------------- f4

test('f4: jedes verarbeitete Bild schreibt eine Logzeile „image processed“ mit durationMs ≤ 2000, rssMb und maxRssMb @desktop', async ({
  page,
}) => {
  test.slow();
  // Like `pnpm start`: the default LOG_LEVEL info and the file logger in <DATA_DIR>/logs/app.log.
  const srv = await startServer({ LOG_LEVEL: 'info' });
  try {
    const profile = await srv.api.createProfile(unique('Log'));
    const photo = await portraitPhoto12mp();

    // One photo through the editor, as on the PC: "Bild auswählen" opens the gallery input.
    await useProfile(page, profile.id);
    await page.goto(`${srv.url}/rezepte/neu`);
    const gallery = page.locator('input[type="file"]:not([capture])');
    await expect(gallery).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    await gallery.setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: photo });
    // The editor announces the finished upload; the progress bar is gone then.
    await expect(page.getByText(deEditor.photo.uploaded, { exact: true })).toBeAttached({ timeout: 30_000 });
    await expect(page.getByRole('progressbar')).toBeHidden();
    await expect(page.getByRole('img', { name: deEditor.photo.preview })).toBeVisible();
    // A second one straight through the API.
    await srv.api.uploadImage(profile.id, photo);

    // The pattern of the checklist command: Select-String -Pattern '"image processed"'.
    const file = path.join(srv.dataDir, 'logs', 'app.log');
    await expect
      .poll(() =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .filter((line) => line.includes('"image processed"')),
      )
      .toHaveLength(2);
    const lines = logEntries(srv.dataDir).filter((e) => e.msg === 'image processed');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({
        level: 'info',
        inputBytes: photo.length,
        width: 1536,
        height: 2048,
        durationMs: expect.any(Number),
        waitMs: expect.any(Number),
        rssMb: expect.any(Number),
        maxRssMb: expect.any(Number),
      });
      // F-15 AK: at most 2 s per 12-MP photo on the server PC (here: the PC running the tests).
      test.info().annotations.push({ type: 'durationMs', description: String(line.durationMs) });
      expect(Number(line.durationMs), 'durationMs').toBeLessThanOrEqual(2000);
      expect(Number(line.rssMb)).toBeGreaterThan(0);
      expect(Number(line.rssMb)).toBeLessThanOrEqual(Number(line.maxRssMb) + 1);
    }

    // The checklist command itself, run like in the project folder (DATA_DIR "data" there, a temp folder
    // here). ForEach-Object Line only prints the matched lines without the file prefix; stderr (progress
    // records of a first PowerShell start) is captured instead of cluttering the test output.
    if (process.platform === 'win32') {
      const logPath = `${path.basename(srv.dataDir)}\\logs\\app.log`;
      const command = `$ProgressPreference = 'SilentlyContinue'; Select-String -Path ${logPath} -Pattern '"image processed"' | Select-Object -Last 5 | ForEach-Object Line`;
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(command, 'utf16le').toString('base64'),
        ],
        {
          cwd: path.dirname(srv.dataDir),
          encoding: 'utf8',
          timeout: 30_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const found = output
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(found.map((e) => e.msg)).toEqual(['image processed', 'image processed']);
      for (const entry of found) expect(Number(entry.durationMs)).toBeLessThanOrEqual(2000);
    }
  } finally {
    await page.goto('about:blank');
    await srv.dispose();
  }
});

// ---------------------------------------------------------------------------------------------- f6

interface FocusState {
  /** Short description of the focused element for failure messages. */
  what: string;
  /** Problem with the focus indicator, or null. */
  problem: string | null;
}

/**
 * The focused element must show a focus ring (a solid outline of at least 2 px on itself or, for
 * composite controls like the tag box or a list row, on a close ancestor) and must not be hidden: in
 * the viewport and not covered by a fixed bar at its center.
 */
async function focusState(page: Page): Promise<FocusState> {
  return await page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return { what: 'body', problem: 'kein Fokus' };
    const name = (el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.textContent ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 50);
    const what = `<${el.tagName.toLowerCase()}> „${name}“`;
    let ring: Element | null = null;
    let current: Element | null = el;
    for (let depth = 0; current && depth < 4 && !ring; depth++, current = current.parentElement) {
      const style = getComputedStyle(current);
      const visible =
        style.outlineStyle !== 'none' &&
        Number.parseFloat(style.outlineWidth) >= 2 &&
        style.outlineColor !== 'rgba(0, 0, 0, 0)' &&
        style.outlineColor !== 'transparent';
      if (visible) ring = current;
    }
    if (!ring) return { what, problem: 'kein sichtbarer Fokusrahmen' };
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      return { what, problem: 'außerhalb des sichtbaren Bereichs' };
    }
    const hit = document.elementFromPoint(x, y);
    if (hit && !el.contains(hit) && !hit.contains(el) && !ring.contains(hit)) {
      return { what, problem: `verdeckt von <${hit.tagName.toLowerCase()} class="${hit.className}">` };
    }
    return { what, problem: null };
  });
}

/**
 * Presses Tab until `target` has the focus, checking the focus ring at every stop. Past the last control
 * the focus leaves the page (a real browser moves it to its address bar, headless Chromium to the
 * document): that stop is skipped.
 */
async function tabTo(page: Page, target: Locator, problems: string[], max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const state = await focusState(page);
    if (state.problem && state.what !== 'body') problems.push(`${state.what}: ${state.problem}`);
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Tab erreicht ${target} nicht nach ${max} Schritten`);
}

async function expectRing(page: Page, problems: string[]): Promise<void> {
  const state = await focusState(page);
  if (state.problem) problems.push(`${state.what}: ${state.problem}`);
}

test('f6: Rezept nur mit der Tastatur anlegen – Tab mit sichtbarem Fokus, Enter springt weiter, Strg+Enter speichert @desktop', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(unique('Tastatur'));
  const title = unique('Tastaturkuchen');
  const problems: string[] = [];
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte`);
  await expect(page.getByRole('heading', { level: 1, name: de.titles.recipes })).toBeVisible();

  // Navigation rail → "Neues Rezept" with Tab and Enter.
  await tabTo(page, page.getByRole('link', { name: de.nav.newRecipe }), problems);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/rezepte\/neu$/);
  const titleField = page.getByRole('textbox', { name: deEditor.title.label });
  await expect(titleField).toBeFocused();
  await expectRing(page, problems);

  // Enter moves on instead of submitting.
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  const tagField = page.getByRole('textbox', { name: deEditor.tags.label });
  await expect(tagField).toBeFocused();
  await expectRing(page, problems);
  // In the tag field Enter adds the tag (F-17) and stays there.
  await page.keyboard.type('Kuchen');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: deEditor.tags.remove('Kuchen') })).toBeVisible();
  await expect(tagField).toBeFocused();

  // "Weitere Angaben" (open in the two-column editor): Enter walks through the fields.
  await tabTo(page, page.getByRole('textbox', { name: deEditor.more.servings, exact: true }), problems);
  await page.keyboard.type('12');
  const more = page.getByRole('region', { name: deEditor.more.heading });
  // Fields with suggestions (datalist) are comboboxes.
  const order = [
    { role: 'combobox', name: deEditor.more.servingsUnit, text: null },
    { role: 'textbox', name: deEditor.more.prep, text: '20' },
    { role: 'textbox', name: deEditor.more.cook, text: '45' },
    { role: 'textbox', name: deEditor.more.source, text: 'Omas Heft' },
    { role: 'textbox', name: deEditor.more.description, text: 'Saftig.' },
  ] as const;
  for (const field of order) {
    await page.keyboard.press('Enter');
    await expect(more.getByRole(field.role, { name: field.name, exact: true })).toBeFocused();
    await expectRing(page, problems);
    if (field.text) await page.keyboard.type(field.text);
  }
  // Multi-line fields keep Enter for a line break.
  await page.keyboard.press('Enter');
  await expect(more.getByRole('textbox', { name: deEditor.more.description, exact: true })).toBeFocused();
  await page.keyboard.type('Mit Zimt.');

  // Ingredients: Menge → Einheit → Zutat with Enter; Enter in the last name adds a row (F-10 AK).
  const firstRow = page.getByRole('group', { name: deEditor.ingredients.row(1) });
  await tabTo(page, firstRow.getByRole('textbox', { name: deEditor.ingredients.amount }), problems);
  await page.keyboard.type('200');
  await page.keyboard.press('Enter');
  await expect(firstRow.getByRole('combobox', { name: deEditor.ingredients.unit })).toBeFocused();
  await page.keyboard.type('g');
  await page.keyboard.press('Enter');
  await expect(firstRow.getByRole('textbox', { name: deEditor.ingredients.name })).toBeFocused();
  await page.keyboard.type('Mehl');
  await page.keyboard.press('Enter');
  const secondRow = page.getByRole('group', { name: deEditor.ingredients.row(2) });
  await expect(secondRow.getByRole('textbox', { name: deEditor.ingredients.amount })).toBeFocused();
  await expectRing(page, problems);
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Prise');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Salz');

  // Step 1 by Tab, then Ctrl+Enter saves from the textarea.
  const step = page.getByRole('textbox', { name: deEditor.steps.step(1) });
  await tabTo(page, step, problems);
  await page.keyboard.type('Alles verrühren.');
  await page.keyboard.press('Enter');
  await expect(step).toBeFocused();
  await page.keyboard.type('Backen.');
  await page.keyboard.press('Control+Enter');

  await expect(page).toHaveURL(/\/rezepte\/\d+$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  expect(problems, 'Fokus bei jedem Schritt sichtbar').toEqual([]);

  const id = Number(new URL(page.url()).pathname.split('/').pop());
  const saved = await recipeFromApi(server, profile.id, id);
  expect(saved).toMatchObject({
    title,
    servings: 12,
    servingsUnit: 'Portionen',
    prepMinutes: 20,
    cookMinutes: 45,
    source: 'Omas Heft',
    description: 'Saftig.\nMit Zimt.',
    tags: [expect.objectContaining({ name: 'Kuchen' })],
    ingredients: [
      expect.objectContaining({ amount: 200, unit: 'g', name: 'Mehl' }),
      expect.objectContaining({ amount: 1, unit: 'Prise', name: 'Salz' }),
    ],
    steps: [expect.objectContaining({ text: 'Alles verrühren.\nBacken.' })],
  });
});

test('f6: im Editor erreicht Tab jedes Bedienelement, jedes mit sichtbarem Fokusrahmen @desktop', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(unique('Tab'));
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte/neu`);
  const titleField = page.getByRole('textbox', { name: deEditor.title.label });
  await expect(titleField).toBeFocused();
  // With a title "Speichern" is enabled and part of the tab order, too.
  await page.keyboard.type(unique('Tabrunde'));

  // All visible, enabled controls of the page, numbered in DOM order.
  const expected = await page.evaluate(() => {
    const selector =
      'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])';
    const names: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.tabIndex < 0 || !el.checkVisibility() || el.closest('[inert], dialog:not([open])')) continue;
      el.dataset.e2eTab = String(names.length);
      names.push(
        `<${el.tagName.toLowerCase()}> „${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ')}“`,
      );
    }
    return names;
  });
  expect(expected.length).toBeGreaterThan(20);

  const reached = new Set<string>();
  const problems: string[] = [];
  for (let i = 0; i < expected.length + 5; i++) {
    await page.keyboard.press('Tab');
    const index = await page.evaluate(() =>
      document.activeElement instanceof HTMLElement ? (document.activeElement.dataset.e2eTab ?? null) : null,
    );
    if (index === null) continue;
    reached.add(index);
    const state = await focusState(page);
    if (state.problem) problems.push(`${state.what}: ${state.problem}`);
  }
  const missing = expected.filter((_, i) => !reached.has(String(i)));
  expect(missing, 'per Tab nicht erreichbar').toEqual([]);
  expect(problems, 'Fokus bei jedem Tab-Schritt sichtbar').toEqual([]);
});

test('f6: Escape schließt Profil-Sheet, Menü-Sheet, Vollbild und den Dialog „Änderungen verwerfen?“ @desktop', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(unique('Escape'));
  const image = await server.api.uploadImage(profile.id, await smallJpeg(900, 600));
  const recipe = await server.api.createRecipe(profile.id, {
    title: unique('Escape-Suppe'),
    imageId: image.imageId,
  });
  const problems: string[] = [];
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte/${recipe.id}`);
  await expect(page.getByRole('heading', { level: 1, name: recipe.title })).toBeVisible();

  // Profile sheet from the avatar in the navigation rail.
  const avatar = page.getByRole('button', { name: de.profile.switchLabel(profile.name) });
  await tabTo(page, avatar, problems);
  await page.keyboard.press('Enter');
  const profileSheet = page.getByRole('dialog', { name: de.profile.switchTitle });
  await expect(profileSheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(profileSheet).toBeHidden();
  await expect(avatar).toBeFocused();

  // Full screen photo.
  const zoom = page.getByRole('button', { name: dl.detail.zoom });
  await tabTo(page, zoom, problems);
  await page.keyboard.press('Enter');
  const lightbox = page.getByRole('dialog', { name: recipe.title });
  await expect(lightbox.getByRole('img', { name: recipe.title })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();
  await expect(zoom).toBeFocused();

  // "Weitere Aktionen" sheet of the detail.
  const menu = page.getByRole('button', { name: de.common.moreActions });
  await tabTo(page, menu, problems);
  await page.keyboard.press('Enter');
  const menuSheet = page.getByRole('dialog', { name: de.common.moreActions });
  await expect(menuSheet.getByRole('button', { name: dl.detail.toTrash })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menuSheet).toBeHidden();
  await expect(menu).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));

  // Editor: a change, then "Abbrechen" asks "Änderungen verwerfen?"; Escape keeps editing.
  await tabTo(page, page.getByRole('link', { name: de.common.edit }), problems);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}/bearbeiten$`));
  const titleField = page.getByRole('textbox', { name: deEditor.title.label });
  await expect(titleField).toHaveValue(recipe.title);
  await tabTo(page, titleField, problems);
  await page.keyboard.press('End');
  await page.keyboard.type(' neu');
  const cancel = page.getByRole('button', { name: deEditor.cancel, exact: true });
  await tabTo(page, cancel, problems);
  await page.keyboard.press('Enter');
  const discard = page.getByRole('alertdialog', { name: deEditor.discard.title });
  await expect(discard).toBeVisible();
  await expect(discard.getByRole('button', { name: deEditor.discard.keep })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(discard).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}/bearbeiten$`));
  await expect(titleField).toHaveValue(`${recipe.title} neu`);
  await expect(cancel).toBeFocused();
  expect(problems, 'Fokus bei jedem Schritt sichtbar').toEqual([]);
});

interface CtrlEnterOptions {
  /** Typed into `field` before Ctrl+Enter. */
  text?: string;
  /** Runs after the title is typed, before `field` gets the focus. */
  prepare?: (page: Page) => Promise<void>;
}

/**
 * Opens a new recipe, types a title, focuses `field` (optionally typing `text` there), presses Ctrl+Enter
 * and expects the saved recipe: the detail page with its title and the recipe from the API.
 */
async function ctrlEnterSaves(
  page: Page,
  server: AppServer,
  profileId: number,
  field: (page: Page) => Locator,
  options: CtrlEnterOptions = {},
): Promise<RecipeResponse['recipe']> {
  await page.goto(`${server.url}/rezepte/neu`);
  const titleField = page.getByRole('textbox', { name: deEditor.title.label });
  await expect(titleField).toBeFocused();
  const title = unique('Strg-Enter');
  await page.keyboard.type(title);
  await options.prepare?.(page);
  const target = field(page);
  await target.focus();
  await expect(target).toBeFocused();
  if (options.text) await page.keyboard.type(options.text);
  await page.keyboard.press('Control+Enter');
  await expect(page).toHaveURL(/\/rezepte\/\d+$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const saved = await recipeFromApi(server, profileId, Number(new URL(page.url()).pathname.split('/').pop()));
  expect(saved.title).toBe(title);
  return saved;
}

const lastRow = (page: Page): Locator => page.getByRole('group', { name: deEditor.ingredients.row(1) });

test('f6: Strg+Enter speichert aus Titel, Menge, Einheit, Weiteren Angaben und Schritt @desktop', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(unique('Strg'));
  await useProfile(page, profile.id);
  const fields: Array<(p: Page) => Locator> = [
    (p) => p.getByRole('textbox', { name: deEditor.title.label }),
    (p) => lastRow(p).getByRole('textbox', { name: deEditor.ingredients.amount }),
    (p) => lastRow(p).getByRole('combobox', { name: deEditor.ingredients.unit }),
    (p) => p.getByRole('textbox', { name: deEditor.more.servings, exact: true }),
    (p) => p.getByRole('textbox', { name: deEditor.more.source }),
    (p) => p.getByRole('textbox', { name: deEditor.more.description }),
    (p) => p.getByRole('textbox', { name: deEditor.steps.step(1) }),
  ];
  for (const field of fields) await ctrlEnterSaves(page, server, profile.id, field);
});

// Regression: the tag field once treated every Enter (also Ctrl+Enter) as "add tag" and called
// preventDefault, so the form's Ctrl+Enter handler skipped the event and nothing was saved. Now Ctrl/Cmd+Enter
// falls through and saving commits the typed tag.
test('f6: Strg+Enter speichert auch im Tag-Feld, samt dem gerade getippten Tag @desktop', async ({
  page,
  server,
}) => {
  const profile = await server.api.createProfile(unique('StrgTag'));
  await useProfile(page, profile.id);
  const saved = await ctrlEnterSaves(
    page,
    server,
    profile.id,
    (p) => p.getByRole('textbox', { name: deEditor.tags.label }),
    { text: 'Kuchen' },
  );
  expect(saved.tags.map((t) => t.name)).toEqual(['Kuchen']);
});

// Regression: Enter in name or note of the last ingredient adds a row; Ctrl/Cmd+Enter once did so as well
// (and called preventDefault) instead of saving.
test('f6: Strg+Enter speichert auch im Feld „Zutat“ der letzten Zutat @desktop', async ({ page, server }) => {
  const profile = await server.api.createProfile(unique('StrgZutat'));
  await useProfile(page, profile.id);
  const saved = await ctrlEnterSaves(
    page,
    server,
    profile.id,
    (p) => lastRow(p).getByRole('textbox', { name: deEditor.ingredients.name }),
    { text: 'Mehl' },
  );
  expect(saved.ingredients).toEqual([expect.objectContaining({ name: 'Mehl' })]);
});

// Regression: as above, in the note of the last ingredient.
test('f6: Strg+Enter speichert auch im Feld „Notiz“ der letzten Zutat @desktop', async ({ page, server }) => {
  const profile = await server.api.createProfile(unique('StrgNotiz'));
  await useProfile(page, profile.id);
  const saved = await ctrlEnterSaves(
    page,
    server,
    profile.id,
    (p) => lastRow(p).getByRole('textbox', { name: deEditor.ingredients.note }),
    {
      prepare: (p) => lastRow(p).getByRole('textbox', { name: deEditor.ingredients.name }).fill('Mehl'),
      text: 'gesiebt',
    },
  );
  expect(saved.ingredients).toEqual([expect.objectContaining({ name: 'Mehl', note: 'gesiebt' })]);
});
