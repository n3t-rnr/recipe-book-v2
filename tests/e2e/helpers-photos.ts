// Helpers of tests/e2e/photos.spec.ts (checklist section C, photos): file choice through the editor's
// buttons, holding an upload on the wire, a slow uplink, reading what a photo looks like on screen.
import net from 'node:net';
import {
  type Browser,
  devices,
  type FileChooser,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import { expect, test, useProfile } from './fixtures.ts';

export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const TAKE = 'Foto aufnehmen';
export const CHOOSE = 'Bild auswählen';
export const PREVIEW = 'Vorschau des Fotos';

let counter = 0;

/** A name no other test of this worker uses (tests of a worker share one server). */
export function unique(label: string): string {
  counter += 1;
  return `${label} ${test.info().project.name} w${test.info().workerIndex}-${counter}`;
}

/** Short profile names (max. 40 characters). */
export function profileName(): string {
  counter += 1;
  return `Foto ${test.info().workerIndex}-${counter}`;
}

/** Touch devices tap, the PC clicks. */
export async function press(locator: Locator): Promise<void> {
  if (test.info().project.use.hasTouch) await locator.tap();
  else await locator.click();
}

/**
 * Follows a link. Clicked on every device: the router only listens to click, which a real tap also fires.
 * An earlier run saw the emulated WebKit tap on a link give no click now and then (about 1 in 10 under
 * load); a later check with 46 taps on "Foto hinzufügen" did not reproduce it, but a click keeps the tests
 * free of that emulation risk without testing less of the app.
 */
export async function follow(link: Locator): Promise<void> {
  await link.click();
}

/**
 * Presses one of the editor's photo buttons, as a user would, and hands the file to the file chooser
 * the browser opens (no real camera or OS picker in the emulation). Returns the chooser for its input.
 */
export async function pickPhoto(page: Page, button: string, file: FilePayload): Promise<FileChooser> {
  const opened = page.waitForEvent('filechooser');
  await press(page.getByRole('button', { name: button, exact: true }));
  const chooser = await opened;
  await chooser.setFiles(file);
  return chooser;
}

export interface HeldUploads {
  /** Resolves once the browser sent POST /api/v1/images. */
  reached: Promise<void>;
  /** Lets the held upload through to the server. */
  release(): void;
}

/** Holds every photo upload on the wire until release(), so "during the upload" is a stable state. */
export async function holdUploads(page: Page): Promise<HeldUploads> {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived = (): void => {};
  const reached = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route('**/api/v1/images', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    arrived();
    await gate;
    await route.continue();
  });
  return { reached, release };
}

export interface SlowLink {
  /** Origin of the app behind the slow link, e.g. http://127.0.0.1:51234. */
  url: string;
  close(): Promise<void>;
}

/**
 * A slow WLAN upwards in every engine (Chromium's network emulation has no WebKit counterpart): a TCP
 * proxy in front of the server that passes the browser's bytes on at about `bytesPerSecond` and the
 * answers at full speed. The browser only reports upload progress for what the socket took, so the bar
 * advances with the proxy. The server accepts every IP literal as host (NF-21), so the app simply runs
 * from the proxy's port.
 */
export async function slowUplink(targetPort: number, bytesPerSecond: number): Promise<SlowLink> {
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket): void => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  };
  const proxy = net.createServer((client) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    track(client);
    track(upstream);
    const drop = (): void => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', drop);
    upstream.on('error', drop);
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.pipe(client);
    // Each chunk from the browser is passed on, then reading pauses for as long as the chunk takes at the
    // given rate; TCP flow control holds the browser back meanwhile.
    client.on('data', (chunk: Buffer) => {
      client.pause();
      upstream.write(chunk);
      setTimeout(() => client.resume(), (chunk.length / bytesPerSecond) * 1000);
    });
    client.on('end', () => upstream.end());
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', () => resolve());
  });
  const address = proxy.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        proxy.close(() => resolve());
      }),
  };
}

export function isUpload(request: Request): boolean {
  return request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/images';
}

/** The answer of the next photo upload: the image id and variant URLs the server assigned. */
export async function nextUpload(
  page: Page,
): Promise<{ imageId: number; urls: { s: string; m: string; l: string } }> {
  const res = await page.waitForResponse((r) => isUpload(r.request()));
  expect(res.status(), 'POST /api/v1/images').toBe(201);
  return (await res.json()) as { imageId: number; urls: { s: string; m: string; l: string } };
}

/** Waits until an <img> has loaded and returns its natural (EXIF-oriented) size. */
export async function naturalSize(img: Locator): Promise<{ width: number; height: number }> {
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
      message: 'Bild geladen',
    })
    .toBe(true);
  return img.evaluate((el: HTMLImageElement) => ({ width: el.naturalWidth, height: el.naturalHeight }));
}

type Side = 'red' | 'blue' | 'other';

/**
 * The colours at the left and right edge (half height) of a photo as the browser draws it, EXIF orientation
 * applied. The test photos are red on the left and blue on the right when upright (tests/helpers/images.ts);
 * every view crops a portrait photo only at the top and bottom (object-fit: cover, frames wider than 3:4),
 * so these edges are the ones on screen. A photo that ignored its orientation shows other colours there.
 * Drawn through a canvas: Playwright's element screenshots inject a <style> in WebKit, which the CSP guard
 * reports as a violation.
 */
export async function visibleSides(img: Locator): Promise<{ left: Side; right: Side }> {
  const [left, right] = await img.evaluate((el: HTMLImageElement) => {
    const width = 64;
    const height = Math.max(2, Math.round((width * el.naturalHeight) / el.naturalWidth));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [null, null];
    ctx.drawImage(el, 0, 0, width, height);
    const at = (x: number): number[] => Array.from(ctx.getImageData(x, Math.floor(height / 2), 1, 1).data);
    return [at(2), at(width - 3)];
  });
  const side = (px: number[] | null): Side => {
    const [r = 0, , b = 0] = px ?? [];
    return r > b + 60 ? 'red' : b > r + 60 ? 'blue' : 'other';
  };
  return { left: side(left ?? null), right: side(right ?? null) };
}

/** The <img> of a recipe's card or row in the list (its alt is empty: the title stands next to it). */
export function listImage(page: Page, title: string): Locator {
  return page
    .locator('article')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) })
    .locator('img');
}

/** Reads a recipe through the API. */
export async function recipeImageId(
  request: (method: string, path: string, options?: { profileId?: number }) => Promise<Response>,
  profileId: number,
  recipeId: number,
): Promise<number | null> {
  const res = await request('GET', `/api/v1/recipes/${recipeId}`, { profileId });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { recipe: { image: { id: number } | null } };
  return body.recipe.image?.id ?? null;
}

/**
 * Resolves once the app has asked the server about a restored draft's photo (GET /api/v1/images/:id,
 * F-09 AK), the answer said it still exists, and the page had two frames to act on it. Call it before
 * tapping "Wiederherstellen".
 */
export async function draftPhotoCheck(page: Page, imageId: number): Promise<void> {
  const res = await page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/v1/images/${imageId}`,
  );
  expect(res.status(), `GET /api/v1/images/${imageId}`).toBe(200);
  await res.finished();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * Collects uncaught errors and CSP violations of a page the fixture guard does not watch (a second tab or
 * device). Read the list before closing a WebKit context: while it closes, Playwright's WebKit injects an
 * inline stylesheet that the app's CSP reports, which is not the app.
 */
export async function watchProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`Fehler im Browser: ${error.message}`));
  await page.exposeFunction('__photosReportCsp', (text: string) => problems.push(`CSP-Verstoß: ${text}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const w = window as unknown as { __photosReportCsp?: (text: string) => void };
      w.__photosReportCsp?.(`${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}`);
    });
  });
  return problems;
}

export interface OtherDevice {
  page: Page;
  problems: string[];
  close(): Promise<void>;
}

/**
 * The other kind of device in the same test, with its own storage and the profile remembered: an iPad in
 * landscape next to the phone projects, an iPhone next to the tablet project (same engine as the project).
 */
export async function openOtherDevice(browser: Browser, profileId: number): Promise<OtherDevice> {
  const onTablet = test.info().project.name.startsWith('tablet');
  const { defaultBrowserType: _ignored, ...device } = onTablet
    ? devices['iPhone 14']
    : devices['iPad (gen 7)'];
  const context = await browser.newContext({
    ...device,
    ...(onTablet ? {} : { viewport: { width: 1024, height: 768 } }),
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  const page = await context.newPage();
  const problems = await watchProblems(page);
  await useProfile(page, profileId);
  return { page, problems, close: () => context.close() };
}

/** The id of the recipe shown at /rezepte/:id. */
export function recipeIdFromUrl(page: Page): number {
  const match = /\/rezepte\/(\d+)(?:$|[/?#])/.exec(new URL(page.url()).pathname);
  expect(match, `Rezept-URL: ${page.url()}`).not.toBeNull();
  return Number(match?.[1]);
}
