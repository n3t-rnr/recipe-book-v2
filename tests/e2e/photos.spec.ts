// Checklist section C (photos, F-14 to F-16, F-29, F-09): c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12.
// Covered elsewhere and referenced instead of repeated: server rules in tests/api/images.test.ts (413, 415 with
// the HEIC hint, PDF as .jpg, EXIF rotation of a 12-MP portrait), the client helpers in tests/unit/upload.test.ts
// (20-MiB limit, photoPending) and the draft storage in tests/unit/editor-draft.test.ts.
// Emulated here: a held upload (page.route), a slow WLAN upwards in every engine (TCP proxy, slowUplink), flight
// mode (context.setOffline), a second tab and a second device (own browser context), dark mode (emulateMedia).
// Device-only parts stay manual: the real camera and OS picker, iOS converting HEIC library photos to JPEG, and
// what a real display shows.
import type { Locator, Page } from '@playwright/test';
import { LIMITS } from '../../shared/constants.ts';
import {
  heicProbe,
  PDF_AS_JPG,
  padJpeg,
  photoJpeg,
  portraitPhoto12mp,
  smallJpeg,
  webpImage,
} from '../helpers/images.ts';
import { type AppServer, expect, test, useProfile } from './fixtures.ts';
import {
  CHOOSE,
  draftPhotoCheck,
  type FilePayload,
  follow,
  holdUploads,
  isUpload,
  listImage,
  naturalSize,
  nextUpload,
  openOtherDevice,
  PREVIEW,
  pickPhoto,
  press,
  profileName,
  recipeIdFromUrl,
  recipeImageId,
  slowUplink,
  TAKE,
  unique,
  visibleSides,
  watchProblems,
} from './helpers-photos.ts';

const UPLOAD_FAILED = 'Hochladen fehlgeschlagen: ';
const HEIC_HINT =
  'Bitte als JPEG speichern – iPhone: Einstellungen > Kamera > Formate > Maximale Kompatibilität; Android: in der Kamera-App HEIF ausschalten';
/** --placeholder-1 … -4 of tokens.css as the browser reports them (F-16: colour = id mod 4 + 1). */
const PLACEHOLDER_RGB = [
  'rgb(243, 223, 162)',
  'rgb(126, 189, 194)',
  'rgb(232, 183, 169)',
  'rgb(220, 207, 194)',
];

let photo: Promise<Buffer> | null = null;

/** A 1.9-MP landscape JPEG (about 0.5 MB): quick to generate, still a real photo upload. */
async function jpeg(name = 'IMG_1234.jpg'): Promise<FilePayload> {
  photo ??= photoJpeg({ width: 1600, height: 1200, noise: 6 });
  return { name, mimeType: 'image/jpeg', buffer: await photo };
}

async function openNewRecipe(page: Page, server: AppServer): Promise<number> {
  const profile = await server.api.createProfile(profileName());
  await useProfile(page, profile.id);
  await page.goto(`${server.url}/rezepte/neu`);
  await expect(page.getByRole('heading', { level: 1, name: 'Neues Rezept' })).toBeVisible();
  return profile.id;
}

function titleBox(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Titel', exact: true });
}

function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Speichern', exact: true });
}

/** The recipe detail (the article with the recipe title as heading); on wide screens the list sits beside it. */
function detailOf(page: Page, title: string): Locator {
  return page
    .locator('article')
    .filter({ has: page.getByRole('heading', { level: 1, name: title, exact: true }) });
}

/** The recipe's card (phone, tablet portrait) or row (from 1024 px) in the list. */
function listEntry(page: Page, title: string): Locator {
  return page.locator('article').filter({ has: page.getByRole('link', { name: title, exact: true }) });
}

/** Placeholder image of the design (F-16): plate with ring, fork and knife and the title's first letter, no photo. */
async function expectPlaceholder(scope: Locator, title: string): Promise<void> {
  const art = scope.getByRole('img', { name: `Noch kein Foto: ${title}`, exact: true });
  await expect(art).toBeVisible();
  await expect(art.locator('.plate')).toHaveCount(1);
  await expect(art.locator('.ring')).toHaveCount(1);
  await expect(art.locator('.cutlery path')).toHaveCount(6);
  await expect(art.locator('.letter')).toHaveText(title.charAt(0).toLocaleUpperCase('de'));
  await expect(scope.locator('img')).toHaveCount(0);
}

/** The keyboard focus ring of base.css: 2 px solid in --color-focus (#231F20), only on :focus-visible. */
const VISIBLE_RING = { focusVisible: true, style: 'solid', width: '2px', color: 'rgb(35, 31, 32)' };

async function focusRing(locator: Locator): Promise<typeof VISIBLE_RING> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      focusVisible: el.matches(':focus-visible'),
      style: style.outlineStyle,
      width: style.outlineWidth,
      color: style.outlineColor,
    };
  });
}

async function backgroundOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

interface PlaceholderColours {
  list: string;
  detail: string;
  /** Dark mode: the plate carries the colour on a dark surface (docs/design/README.md). */
  darkPlate: string;
}

/** The placeholder colours of each recipe as one device shows them: list, detail, and the plate in dark mode. */
async function placeholderColours(
  page: Page,
  origin: string,
  recipes: readonly { id: number; title: string }[],
): Promise<PlaceholderColours[]> {
  const result: PlaceholderColours[] = [];
  for (const recipe of recipes) {
    await page.goto(`${origin}/rezepte`);
    const inList = listEntry(page, recipe.title).locator('.placeholder');
    await expect(inList).toBeVisible();
    const list = await backgroundOf(inList);

    await page.goto(`${origin}/rezepte/${recipe.id}`);
    const inDetail = detailOf(page, recipe.title).locator('.placeholder');
    await expect(inDetail).toBeVisible();
    const detail = await backgroundOf(inDetail);

    // Dark mode: the surface turns dark and the plate carries the colour instead.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => backgroundOf(inDetail), 'dunkle Fläche').not.toBe(detail);
    const darkPlate = await inDetail.locator('.plate').evaluate((el) => getComputedStyle(el).fill);
    await page.emulateMedia({ colorScheme: 'light' });
    result.push({ list, detail, darkPlate });
  }
  return result;
}

async function draftImageId(page: Page, key: string): Promise<number | null> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const draft = JSON.parse(raw) as { data?: { form?: { image?: { id?: number } | null } } };
    return draft.data?.form?.image?.id ?? null;
  }, key);
}

// Traces without DOM snapshots: the snapshotter fetches a blob: preview the browser cannot decode (HEIC, PDF
// in C4 and C6), and the CSP guard reports that fetch as a connect-src violation although the app never makes
// it (with snapshots off there is none). Screenshots and actions stay in the trace.
test.use({ trace: { mode: 'retain-on-failure', snapshots: false } });

test.describe('Fotos (Checkliste C)', () => {
  test('C1: Hochkantfoto über „Foto aufnehmen“ steht in Editor, Liste und Detail richtig herum @phone @tablet', async ({
    page,
    server,
  }) => {
    // 12-MP portrait with EXIF orientation 6 as phones store it: generating and processing it takes a while.
    test.slow();
    const buffer = await portraitPhoto12mp();
    const title = unique('Hochkant-Auflauf');
    await openNewRecipe(page, server);
    const held = await holdUploads(page);

    const chooser = await pickPhoto(page, TAKE, { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer });
    // The camera button opens a JPEG-only input with the rear camera (F-14); the camera itself is manual.
    expect(await chooser.element().getAttribute('accept')).toBe('image/jpeg');
    expect(await chooser.element().getAttribute('capture')).toBe('environment');
    expect(chooser.isMultiple()).toBe(false);
    await held.reached;

    // Editor, while uploading: the local file, turned upright by the browser.
    const preview = page.getByRole('img', { name: PREVIEW });
    await expect(preview).toHaveAttribute('src', /^blob:/);
    const local = await naturalSize(preview);
    expect(local.height).toBeGreaterThan(local.width);
    expect(await visibleSides(preview)).toEqual({ left: 'red', right: 'blue' });

    // Editor, after the upload: the server's variant m.
    const uploaded = nextUpload(page);
    held.release();
    const image = await uploaded;
    await expect(preview).toHaveAttribute('src', image.urls.m);
    const medium = await naturalSize(preview);
    expect(medium.height).toBeGreaterThan(medium.width);
    expect(await visibleSides(preview)).toEqual({ left: 'red', right: 'blue' });

    // Detail after saving.
    await titleBox(page).fill(title);
    await press(saveButton(page));
    await expect(page).toHaveURL(/\/rezepte\/\d+$/);
    const hero = page.getByRole('img', { name: `Foto: ${title}`, exact: true });
    await expect(hero).toHaveAttribute('src', image.urls.m);
    const detail = await naturalSize(hero);
    expect(detail.height).toBeGreaterThan(detail.width);
    expect(await visibleSides(hero)).toEqual({ left: 'red', right: 'blue' });

    // List: the card shows variant s (3:2 crop of the upright photo) or m, depending on the screen.
    await page.goto(`${server.url}/rezepte`);
    const card = listImage(page, title);
    await naturalSize(card);
    const shown = await card.evaluate((el: HTMLImageElement) => el.currentSrc);
    expect([image.urls.s, image.urls.m].map((u) => new URL(u, server.url).href)).toContain(shown);
    expect(await visibleSides(card)).toEqual({ left: 'red', right: 'blue' });
  });

  test('C2: Während des Uploads läuft der Fortschrittsbalken, Tippen geht weiter, Speichern wartet auf das Foto @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const title = unique('Warte-Suppe');
    const profileId = await openNewRecipe(page, server);
    const held = await holdUploads(page);
    const order: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/recipes')
        order.push('recipe saved');
    });
    page.on('response', (r) => {
      if (isUpload(r.request())) order.push('photo uploaded');
    });

    await pickPhoto(page, CHOOSE, await jpeg());
    await held.reached;
    const bar = page.getByRole('progressbar', { name: 'Fortschritt des Uploads' });
    await expect(bar).toBeVisible();
    await expect(page.getByText(/^(Wird hochgeladen … \d+\s%|Wird verarbeitet …)$/)).toBeVisible();

    // The form stays usable during the upload.
    await titleBox(page).pressSequentially(title);
    await expect(titleBox(page)).toHaveValue(title);
    await expect(bar).toBeVisible();

    // Speichern waits for the photo: busy, nothing sent, still in the editor.
    await press(saveButton(page));
    await expect(saveButton(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[aria-live="polite"]', { hasText: 'Warte auf das Foto …' })).toBeAttached();
    await expect(page).toHaveURL(/\/rezepte\/neu$/);
    expect(order).toEqual([]);

    const uploaded = nextUpload(page);
    held.release();
    const image = await uploaded;
    await expect(page).toHaveURL(/\/rezepte\/\d+$/);
    expect(order).toEqual(['photo uploaded', 'recipe saved']);
    await expect(page.getByRole('img', { name: `Foto: ${title}`, exact: true })).toHaveAttribute(
      'src',
      image.urls.m,
    );
    expect(await recipeImageId(server.api.request, profileId, recipeIdFromUrl(page))).toBe(image.imageId);
  });

  test('C2: Über langsames WLAN zählt der Balken hoch, danach „Wird verarbeitet …“; Speichern wartet @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const title = unique('Langsam-Suppe');
    const profile = await server.api.createProfile(profileName());
    await useProfile(page, profile.id);
    // About 1 MB/s upwards, like a weak WLAN: a 4-MB photo takes a few seconds (all engines, see slowUplink).
    const link = await slowUplink(server.port, 1_000_000);
    try {
      await page.goto(`${link.url}/rezepte/neu`);
      await expect(page.getByRole('heading', { level: 1, name: 'Neues Rezept' })).toBeVisible();
      // Every state of the progress panel, recorded in the page: polling from the test misses fast steps.
      await page.evaluate(() => {
        const seen: { text: string; value: string | null; fill: string }[] = [];
        (window as unknown as { __progress: typeof seen }).__progress = seen;
        new MutationObserver(() => {
          const bar = document.querySelector('[role="progressbar"]');
          if (!bar) return;
          const entry = {
            text: bar.previousElementSibling?.textContent ?? '',
            value: bar.getAttribute('aria-valuenow'),
            fill: bar.firstElementChild instanceof HTMLElement ? bar.firstElementChild.style.width : '',
          };
          const last = seen.at(-1);
          if (last?.text !== entry.text || last.value !== entry.value || last.fill !== entry.fill) {
            seen.push(entry);
          }
        }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      });
      const order: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/recipes')
          order.push('recipe saved');
      });
      page.on('response', (r) => {
        if (isUpload(r.request())) order.push('photo uploaded');
      });
      const base = await jpeg();
      const uploaded = nextUpload(page);
      await pickPhoto(page, TAKE, { ...base, buffer: padJpeg(base.buffer, 4 * 1024 * 1024) });

      const bar = page.getByRole('progressbar', { name: 'Fortschritt des Uploads' });
      await expect(bar).toBeVisible();
      await expect(page.getByText(/^Wird hochgeladen … \d+\u00a0%$/)).toBeVisible();
      await titleBox(page).pressSequentially(title);
      await expect(titleBox(page)).toHaveValue(title);
      // Speichern while the photo is still on its way: the recipe is sent only after the photo.
      await press(saveButton(page));

      const image = await uploaded;
      await expect(page).toHaveURL(/\/rezepte\/\d+$/);
      expect(order).toEqual(['photo uploaded', 'recipe saved']);
      await expect(page.getByRole('img', { name: `Foto: ${title}`, exact: true })).toHaveAttribute(
        'src',
        image.urls.m,
      );
      expect(await recipeImageId(server.api.request, profile.id, recipeIdFromUrl(page))).toBe(image.imageId);

      // Text, aria-valuenow and the visible fill of the bar show the same percentage, and it only rises.
      const states = await page.evaluate(
        () =>
          (window as unknown as { __progress: { text: string; value: string | null; fill: string }[] })
            .__progress,
      );
      const sending = states.filter((s) => s.text.startsWith('Wird hochgeladen'));
      for (const state of sending) expect(state.fill).toBe(`${state.value}%`);
      for (const state of sending) expect(state.text).toBe(`Wird hochgeladen … ${state.value}\u00a0%`);
      const values = sending.map((s) => Number(s.value));
      expect(values, 'Prozentwerte').toEqual([...values].sort((a, b) => a - b));
      expect(new Set(values.filter((v) => v > 0 && v < 100)).size, 'Zwischenstände').toBeGreaterThanOrEqual(
        3,
      );
      expect(states.at(-1)?.text).toBe('Wird verarbeitet …');
    } finally {
      await link.close();
    }
  });

  test('C3: „Bild auswählen“ lädt ein Bild hoch und zeigt es ohne HEIC-Hinweis @phone @tablet', async ({
    page,
    server,
  }) => {
    await openNewRecipe(page, server);
    const uploaded = nextUpload(page);
    const chooser = await pickPhoto(page, CHOOSE, await jpeg('IMG_0002.JPG'));
    // No HEIC in accept and no capture: iOS offers the photo library and converts HEIC to JPEG (manual on a
    // real iPhone), Android its gallery.
    expect(await chooser.element().getAttribute('accept')).toBe('image/jpeg,image/png,image/webp');
    expect(await chooser.element().getAttribute('capture')).toBeNull();

    const image = await uploaded;
    const preview = page.getByRole('img', { name: PREVIEW });
    await expect(preview).toHaveAttribute('src', image.urls.m);
    expect((await naturalSize(preview)).width).toBeGreaterThan(0);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByText(UPLOAD_FAILED)).toHaveCount(0);
    await expect(page.getByText('Bitte als JPEG speichern')).toHaveCount(0);
  });

  test('C4: HEIC-Datei am PC: „Hochladen fehlgeschlagen: Bitte als JPEG speichern …“ ohne „Erneut hochladen“ @desktop', async ({
    page,
    server,
  }) => {
    await openNewRecipe(page, server);
    // setFiles skips the accept filter, like "Alle Dateien" in the file dialog.
    await pickPhoto(page, CHOOSE, { name: 'IMG_4711.HEIC', mimeType: 'image/heic', buffer: heicProbe() });
    await expect(page.getByRole('alert').filter({ hasText: UPLOAD_FAILED + HEIC_HINT })).toHaveText(
      UPLOAD_FAILED + HEIC_HINT,
    );
    await expect(page.getByRole('button', { name: 'Erneut hochladen' })).toHaveCount(0);
  });

  test('C5: Eine Datei über 20 MB wird ohne Upload abgelehnt @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    await openNewRecipe(page, server);
    const big = padJpeg(await smallJpeg(), LIMITS.uploadBytes + 1);
    expect(big.length).toBeGreaterThan(LIMITS.uploadBytes);
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.method() !== 'HEAD') sent.push(`${r.method()} ${r.url()}`);
    });

    await pickPhoto(page, CHOOSE, { name: 'riesig.jpg', mimeType: 'image/jpeg', buffer: big });
    await expect(page.getByText('Bild zu groß (max. 20 MB)', { exact: true })).toBeVisible();
    await expect(page.getByText('Noch kein Foto', { exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    expect(sent).toEqual([]);
  });

  test('C6: Eine in .jpg umbenannte PDF am PC: „Nur JPEG, PNG oder WebP“ @desktop', async ({
    page,
    server,
  }) => {
    await openNewRecipe(page, server);
    await pickPhoto(page, CHOOSE, { name: 'Rezept.jpg', mimeType: 'image/jpeg', buffer: PDF_AS_JPG });
    await expect(page.getByRole('alert').filter({ hasText: UPLOAD_FAILED })).toHaveText(
      `${UPLOAD_FAILED}Nur JPEG, PNG oder WebP`,
    );
    await expect(page.getByRole('button', { name: 'Erneut hochladen' })).toHaveCount(0);
  });

  test('C7: Upload ohne Netz scheitert mit „Erneut hochladen“; wieder online speichert die App ohne das Foto @phone @tablet @desktop', async ({
    page,
    context,
    server,
  }) => {
    const title = unique('Offline-Eintopf');
    const profileId = await openNewRecipe(page, server);
    await titleBox(page).fill(title);

    await context.setOffline(true);
    await pickPhoto(page, TAKE, await jpeg());
    await expect(page.getByRole('alert').filter({ hasText: UPLOAD_FAILED })).toHaveText(
      `${UPLOAD_FAILED}Server nicht erreichbar – läuft der Rezepte-PC?`,
    );
    await expect(page.getByRole('button', { name: 'Erneut hochladen' })).toBeVisible();

    await context.setOffline(false);
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/recipes',
    );
    await press(saveButton(page));
    expect((await created).status()).toBe(201);
    await expect(page).toHaveURL(/\/rezepte\/\d+$/);
    await expectPlaceholder(detailOf(page, title), title);
    expect(await recipeImageId(server.api.request, profileId, recipeIdFromUrl(page))).toBeNull();
  });

  test('C7: Mit der Tastatur „Erneut hochladen“ auslösen: der Fokusrahmen bleibt sichtbar im Foto-Bereich @desktop', async ({
    page,
    context,
    server,
  }) => {
    await openNewRecipe(page, server);
    await context.setOffline(true);
    await pickPhoto(page, TAKE, await jpeg());
    const retry = page.getByRole('button', { name: 'Erneut hochladen' });
    const failed = page.getByRole('alert').filter({ hasText: UPLOAD_FAILED });
    const take = page.getByRole('group', { name: /^Foto/ }).getByRole('button', { name: TAKE, exact: true });
    await expect(retry).toBeVisible();
    const tabBackToRetry = async (): Promise<void> => {
      for (let i = 0; i < 6 && !(await retry.evaluate((el) => el === document.activeElement)); i++) {
        await page.keyboard.press('Shift+Tab');
      }
      await expect(retry).toBeFocused();
    };

    // Still offline (DevTools → Netzwerk → Offline): Shift+Tab from the title to "Erneut hochladen", Enter.
    // The button goes away with the new attempt; the focus ring moves to "Foto aufnehmen" in the photo
    // section and stays there when the attempt fails again.
    await titleBox(page).click();
    await tabBackToRetry();
    await page.keyboard.press('Enter');
    await expect(take).toBeFocused();
    await expect(failed).toHaveText(`${UPLOAD_FAILED}Server nicht erreichbar – läuft der Rezepte-PC?`);
    await expect(retry).toBeVisible();
    await expect(take).toBeFocused();
    await expect(take).toBeInViewport();
    expect(await focusRing(take)).toEqual(VISIBLE_RING);

    // Online again: the same keys send the photo, and the focus ring stays at "Foto aufnehmen".
    await context.setOffline(false);
    await tabBackToRetry();
    const uploaded = nextUpload(page);
    await page.keyboard.press('Enter');
    await expect(take).toBeFocused();
    expect(await focusRing(take)).toEqual(VISIBLE_RING);
    const image = await uploaded;
    await expect(page.getByRole('img', { name: PREVIEW })).toHaveAttribute('src', image.urls.m);
    await expect(failed).toHaveCount(0);
    await expect(retry).toHaveCount(0);
    await expect(take).toBeFocused();
    await expect(take).toBeInViewport();
  });

  test('C8: Foto ersetzen; nach dem Entfernen zeigen Liste und Detail das Platzhalterbild @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const title = unique('Tauschgratin');
    const profile = await server.api.createProfile(profileName());
    const first = await server.api.uploadImage(profile.id, await smallJpeg(900, 600));
    const recipe = await server.api.createRecipe(profile.id, { title, imageId: first.imageId });
    await useProfile(page, profile.id);

    // Replace.
    await page.goto(`${server.url}/rezepte/${recipe.id}/bearbeiten`);
    const preview = page.getByRole('img', { name: PREVIEW });
    await expect(preview).toHaveAttribute('src', first.urls.m);
    const uploaded = nextUpload(page);
    await pickPhoto(page, CHOOSE, { name: 'neu.webp', mimeType: 'image/webp', buffer: await webpImage() });
    const second = await uploaded;
    await expect(preview).toHaveAttribute('src', second.urls.m);
    await press(saveButton(page));
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    await expect(page.getByRole('img', { name: `Foto: ${title}`, exact: true })).toHaveAttribute(
      'src',
      second.urls.m,
    );
    expect(await recipeImageId(server.api.request, profile.id, recipe.id)).toBe(second.imageId);

    // Remove.
    await page.goto(`${server.url}/rezepte/${recipe.id}/bearbeiten`);
    await expect(preview).toHaveAttribute('src', second.urls.m);
    await press(page.getByRole('button', { name: 'Foto entfernen', exact: true }));
    await expect(page.getByText('Foto entfernt', { exact: true })).toBeVisible();
    await expect(page.getByText('Noch kein Foto', { exact: true })).toBeVisible();
    await press(saveButton(page));
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    await expectPlaceholder(detailOf(page, title), title);
    expect(await recipeImageId(server.api.request, profile.id, recipe.id)).toBeNull();

    await page.goto(`${server.url}/rezepte`);
    await expectPlaceholder(listEntry(page, title), title);
  });

  test('C9: Im Detail öffnet ein Tipp aufs Foto das Vollbild; es schließt per X, Tipp daneben und Zurück @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const title = unique('Vollbild-Tarte');
    const profile = await server.api.createProfile(profileName());
    const image = await server.api.uploadImage(profile.id, await smallJpeg(1500, 1000));
    const recipe = await server.api.createRecipe(profile.id, { title, imageId: image.imageId });
    await useProfile(page, profile.id);
    const large: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith(image.urls.l)) large.push(r.url());
    });

    // Opened from the list, as a user gets there: the list is the history entry before the detail.
    await page.goto(`${server.url}/rezepte`);
    await follow(listEntry(page, title).getByRole('link', { name: title, exact: true }));
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    await expect(page.getByRole('img', { name: `Foto: ${title}`, exact: true })).toHaveAttribute(
      'src',
      image.urls.m,
    );
    const zoom = page.getByRole('button', { name: 'Foto vergrößern' });
    const lightbox = page.getByRole('dialog', { name: title, exact: true });
    const full = lightbox.getByRole('img', { name: title, exact: true });
    const open = async (): Promise<void> => {
      await press(zoom);
      await expect(lightbox).toBeVisible();
      await naturalSize(full);
    };

    // Only the full-screen view loads variant l (F-29, NF-06).
    expect(large).toEqual([]);
    await open();
    await expect(full).toHaveAttribute('src', image.urls.l);
    expect(await naturalSize(full)).toEqual({ width: image.width, height: image.height });

    // X.
    await press(lightbox.getByRole('button', { name: 'Schließen', exact: true }));
    await expect(lightbox).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));

    // A tap beside the photo: the lower left corner of the full-screen view.
    await open();
    const box = await lightbox.boundingBox();
    const photoBox = await full.boundingBox();
    if (!box || !photoBox) throw new Error('Vollbild ohne Maße');
    const x = box.x + 4;
    const y = box.y + box.height - 4;
    expect(x < photoBox.x || y > photoBox.y + photoBox.height, 'Punkt neben dem Foto').toBe(true);
    if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await expect(lightbox).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));

    // Back (Android back button, iOS back gesture): closes the view and stays on the recipe.
    await open();
    await page.goBack();
    await expect(lightbox).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();

    // Every way of closing took the view's history entry with it: the next Back leaves for the list at once.
    await page.goBack();
    await expect(page).toHaveURL(/\/rezepte$/);
    await expect(listEntry(page, title)).toBeVisible();
  });

  test('C10: Entwurf mit Foto übersteht das Neuladen; „Wiederherstellen“ bringt das Foto zurück @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    await openNewRecipe(page, server);
    const uploaded = nextUpload(page);
    await pickPhoto(page, TAKE, await jpeg());
    const image = await uploaded;
    const preview = page.getByRole('img', { name: PREVIEW });
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(preview).toHaveAttribute('src', image.urls.m);
    // The autosave runs every 2 s.
    await expect.poll(() => draftImageId(page, 'draft:new')).toBe(image.imageId);

    await page.reload();
    const prompt = page.getByRole('dialog', { name: /^Entwurf von heute, \d{2}:\d{2} wiederherstellen\?$/ });
    await expect(prompt).toBeVisible();
    const checked = draftPhotoCheck(page, image.imageId);
    await press(prompt.getByRole('button', { name: 'Wiederherstellen', exact: true }));
    await expect(prompt).toHaveCount(0);
    await expect(preview).toHaveAttribute('src', image.urls.m);
    expect((await naturalSize(preview)).width).toBeGreaterThan(0);
    // The app asked the server whether the draft's photo still exists (F-09 AK), and it does: no hint.
    await checked;
    await expect(preview).toHaveAttribute('src', image.urls.m);
    await expect(page.getByText('Foto nicht mehr vorhanden', { exact: false })).toHaveCount(0);
  });

  test('C10: Entwurf mit Foto übersteht das Schließen des Tabs (bestehendes Rezept) @phone @tablet @desktop', async ({
    page,
    context,
    server,
  }) => {
    const title = unique('Tab-Braten');
    const profile = await server.api.createProfile(profileName());
    const recipe = await server.api.createRecipe(profile.id, { title });
    await useProfile(page, profile.id);
    await page.goto(`${server.url}/rezepte/${recipe.id}/bearbeiten`);
    await expect(titleBox(page)).toHaveValue(title);
    const uploaded = nextUpload(page);
    await pickPhoto(page, TAKE, await jpeg());
    const image = await uploaded;
    await expect(page.getByRole('img', { name: PREVIEW })).toHaveAttribute('src', image.urls.m);
    await expect.poll(() => draftImageId(page, `draft:${recipe.id}`)).toBe(image.imageId);
    await page.close();

    const again = await context.newPage();
    const problems = await watchProblems(again);
    await again.goto(`${server.url}/rezepte/${recipe.id}/bearbeiten`);
    const prompt = again.getByRole('dialog', { name: /^Entwurf von heute, \d{2}:\d{2} wiederherstellen\?$/ });
    await expect(prompt).toBeVisible();
    const checked = draftPhotoCheck(again, image.imageId);
    await press(prompt.getByRole('button', { name: 'Wiederherstellen', exact: true }));
    await expect(prompt).toHaveCount(0);
    const preview = again.getByRole('img', { name: PREVIEW });
    await expect(preview).toHaveAttribute('src', image.urls.m);
    expect((await naturalSize(preview)).width).toBeGreaterThan(0);
    await checked;
    await expect(again.getByText('Foto nicht mehr vorhanden', { exact: false })).toHaveCount(0);

    // The photo is really back in the form: saving gives the recipe this photo.
    await press(saveButton(again));
    await expect(again).toHaveURL(new RegExp(`/rezepte/${recipe.id}$`));
    await expect(again.getByRole('img', { name: `Foto: ${title}`, exact: true })).toHaveAttribute(
      'src',
      image.urls.m,
    );
    expect(await recipeImageId(server.api.request, profile.id, recipe.id)).toBe(image.imageId);
    expect(problems, 'CSP-Verstöße und Fehler im neuen Tab').toEqual([]);
  });

  test('C11: „Abbrechen“ während des Uploads fragt „Änderungen verwerfen?“ @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    await openNewRecipe(page, server);
    const held = await holdUploads(page);
    // Only a photo, nothing typed: the running upload alone must make the editor ask.
    const base = await jpeg();
    await pickPhoto(page, TAKE, { ...base, buffer: padJpeg(base.buffer, 8 * 1024 * 1024) });
    await held.reached;
    await expect(page.getByRole('progressbar', { name: 'Fortschritt des Uploads' })).toBeVisible();

    await press(page.getByRole('button', { name: 'Abbrechen', exact: true }));
    const ask = page.getByRole('alertdialog', { name: 'Änderungen verwerfen?' });
    await expect(ask).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Weiter bearbeiten', exact: true })).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Verwerfen', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/rezepte\/neu$/);

    // "Weiter bearbeiten" keeps the editor, and the upload completes.
    await press(ask.getByRole('button', { name: 'Weiter bearbeiten', exact: true }));
    await expect(ask).toHaveCount(0);
    const uploaded = nextUpload(page);
    held.release();
    const image = await uploaded;
    await expect(page.getByRole('img', { name: PREVIEW })).toHaveAttribute('src', image.urls.m);
    await expect(page).toHaveURL(/\/rezepte\/neu$/);
  });

  test('C12: „Foto hinzufügen“ im Detail öffnet den Editor mit Fokus auf „Foto aufnehmen“ @phone @tablet @desktop', async ({
    page,
    server,
  }) => {
    const title = unique('Ohne-Foto-Kuchen');
    const profile = await server.api.createProfile(profileName());
    const recipe = await server.api.createRecipe(profile.id, { title });
    await useProfile(page, profile.id);

    await page.goto(`${server.url}/rezepte/${recipe.id}`);
    const detail = detailOf(page, title);
    await expectPlaceholder(detail, title);
    await follow(detail.getByRole('link', { name: 'Foto hinzufügen', exact: true }));
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}/bearbeiten\\?foto=1$`));
    // "Foto aufnehmen" has the focus and is in view. After a tap or click the browsers draw no focus ring
    // (:focus-visible only follows keyboard use), so nothing looks "markiert" on a phone: see the next test.
    const take = page.getByRole('group', { name: /^Foto/ }).getByRole('button', { name: TAKE, exact: true });
    await expect(take).toBeFocused();
    await expect(take).toBeInViewport();
  });

  test('C12: Mit der Tastatur ist „Foto aufnehmen“ nach „Foto hinzufügen“ sichtbar markiert @desktop', async ({
    page,
    server,
  }) => {
    const title = unique('Tastatur-Kuchen');
    const profile = await server.api.createProfile(profileName());
    const recipe = await server.api.createRecipe(profile.id, { title });
    await useProfile(page, profile.id);

    await page.goto(`${server.url}/rezepte/${recipe.id}`);
    const add = detailOf(page, title).getByRole('link', { name: 'Foto hinzufügen', exact: true });
    await expect(add).toBeVisible();
    for (let i = 0; i < 30 && !(await add.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(add).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/rezepte/${recipe.id}/bearbeiten\\?foto=1$`));
    const take = page.getByRole('group', { name: /^Foto/ }).getByRole('button', { name: TAKE, exact: true });
    await expect(take).toBeFocused();
    await expect(take).toBeInViewport();
    expect(await focusRing(take)).toEqual(VISIBLE_RING);
  });

  test('C12: Das Platzhalterbild hat auf Handy und iPad dieselbe Farbe (aus der Rezept-ID) @phone @tablet', async ({
    page,
    browser,
    server,
  }) => {
    const profile = await server.api.createProfile(profileName());
    // Four recipes in a row: every placeholder colour once.
    const recipes = [];
    for (let i = 0; i < 4; i++) {
      recipes.push(await server.api.createRecipe(profile.id, { title: unique(`Platzhalter ${i + 1}`) }));
    }
    await useProfile(page, profile.id);
    // Phone and iPad side by side: the project's device and the other kind (openOtherDevice).
    const other = await openOtherDevice(browser, profile.id);
    try {
      const here = await placeholderColours(page, server.url, recipes);
      const there = await placeholderColours(other.page, server.url, recipes);
      const expected = recipes.map((recipe) => {
        const colour = PLACEHOLDER_RGB[recipe.id % 4];
        return { list: colour, detail: colour, darkPlate: colour };
      });
      expect(here, 'Farbe = --placeholder-(ID mod 4 + 1)').toEqual(expected);
      expect(there, 'dieselbe Farbe auf dem anderen Gerät').toEqual(here);
      expect(other.problems, 'CSP-Verstöße und Fehler auf dem anderen Gerät').toEqual([]);
    } finally {
      await other.close();
    }
  });
});
