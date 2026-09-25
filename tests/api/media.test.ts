import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalize } from '../../shared/normalize.ts';
import type { ImageUploadResponse } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';
import { smallJpeg } from '../helpers/images.ts';

const ORIGIN = 'http://localhost:8080';
const KEY = '0123456789abcdef';
const IMMUTABLE = 'public, max-age=31536000, immutable';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.cleanup();
});

async function get(urlPath: string, method = 'GET'): Promise<Response> {
  return await ctx.app.request(`${ORIGIN}${urlPath}`, { method, headers: { Host: 'localhost:8080' } });
}

function writeImage(name: string, content: string | Buffer, dir = ctx.deps.paths.images): Buffer {
  const data = Buffer.from(content);
  fs.writeFileSync(path.join(dir, name), data);
  return data;
}

describe('GET/HEAD /media/:file (Kap. 7.5, NF-06)', () => {
  it('streams a variant as image/webp with an immutable cache', async () => {
    const data = writeImage(`${KEY}-s.webp`, Buffer.from('RIFF\0\0\0\0WEBPVP8 fake-image-bytes', 'latin1'));
    const res = await get(`/media/${KEY}-s.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE);
    expect(res.headers.get('Content-Length')).toBe(String(data.length));
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(data);
  });

  it('answers HEAD with the headers only', async () => {
    const data = writeImage(`${KEY}-l.webp`, 'l'.repeat(1234));
    const res = await get(`/media/${KEY}-l.webp`, 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(res.headers.get('Content-Length')).toBe(String(data.length));
    expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE);
    expect(await res.text()).toBe('');
  });

  it('delivers the three variants of an upload', async () => {
    const profileId = Number(
      ctx.deps.db.prepare('INSERT INTO profiles(name, name_key) VALUES (?, ?)').run('Ben', normalize('Ben'))
        .lastInsertRowid,
    );
    const uploaded = await ctx.app.request(`${ORIGIN}/api/v1/images`, {
      method: 'POST',
      headers: { ...CLIENT_HEADERS, 'Content-Type': 'image/jpeg', 'X-Profile-Id': String(profileId) },
      body: await smallJpeg(1500, 1000),
    });
    expect(uploaded.status).toBe(201);
    const { urls } = (await uploaded.json()) as ImageUploadResponse;
    const expected = { s: [720, 480], m: [1200, 800], l: [1500, 1000] };
    for (const variant of ['s', 'm', 'l'] as const) {
      const res = await get(urls[variant]);
      expect(res.status, variant).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE);
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      expect([meta.format, meta.width, meta.height], variant).toEqual(['webp', ...expected[variant]]);
    }
  });
});

describe('/media path protection (NF-21)', () => {
  beforeEach(() => {
    // Something worth stealing next to images/, and a valid variant inside it.
    fs.writeFileSync(path.join(ctx.deps.paths.dataDir, 'rezepte.sqlite'), 'SQLite format 3\0');
    writeImage(`${KEY}-s.webp`, 'bild');
  });

  async function expectNotFound(urlPath: string, method = 'GET'): Promise<void> {
    const res = await get(urlPath, method);
    expect(res.status, urlPath).toBe(404);
    if (method === 'GET') {
      expect(res.headers.get('Content-Type'), urlPath).toMatch(/^text\/plain/);
      expect(await res.text(), urlPath).toBe('Nicht gefunden');
    }
  }

  it('refuses traversal in every spelling', async () => {
    for (const urlPath of [
      '/media/../rezepte.sqlite',
      '/media/..%2Frezepte.sqlite',
      '/media/..%2frezepte.sqlite',
      '/media/%2e%2e%2frezepte.sqlite',
      '/media/%2E%2E/rezepte.sqlite',
      '/media/..%5Crezepte.sqlite',
      '/media/..\\rezepte.sqlite',
      `/media/..%2Fimages%2F${KEY}-s.webp`,
      `/media/./${KEY}-s.webp/..%2F..%2Frezepte.sqlite`,
    ]) {
      await expectNotFound(urlPath);
    }
  });

  it('only serves names like <16 hex>-<s|m|l>.webp', async () => {
    for (const name of [
      `${KEY.toUpperCase()}-s.webp`,
      `${KEY}-S.webp`,
      `${KEY}-x.webp`,
      `${KEY}-s.WEBP`,
      `${KEY}-s.png`,
      `${KEY}-s.webp.bak`,
      `${KEY.slice(1)}-s.webp`,
      `${KEY}0-s.webp`,
      `%30${KEY.slice(1)}-s.webp`,
      `${KEY}-s.webp%00`,
      `${KEY}-s.webp::$DATA`,
      `${KEY}-s`,
      '',
    ]) {
      await expectNotFound(`/media/${name}`);
    }
    await expectNotFound('/media');
    await expectNotFound(`/media/sub/${KEY}-s.webp`);
    await expectNotFound(`/media/${KEY}-s.webp/`);
  });

  it('answers 404 for missing files and never serves images/.trash', async () => {
    writeImage(`${KEY}-m.webp`, 'im Papierkorb', ctx.deps.paths.imagesTrash);
    await expectNotFound(`/media/${KEY}-m.webp`);
    await expectNotFound(`/media/${KEY}-m.webp`, 'HEAD');
    await expectNotFound(`/media/.trash/${KEY}-m.webp`);
    await expectNotFound(`/media/%2Etrash%2F${KEY}-m.webp`);
    await expectNotFound(`/media/fedcba9876543210-l.webp`);
    const missing = await get('/media/fedcba9876543210-l.webp');
    expect(missing.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('does not serve a directory with a valid name', async () => {
    fs.mkdirSync(path.join(ctx.deps.paths.images, `${KEY}-l.webp`));
    await expectNotFound(`/media/${KEY}-l.webp`);
  });

  it('still serves images while sharp is unavailable (NF-24)', async () => {
    ctx.deps.state.images = 'unavailable';
    const res = await get(`/media/${KEY}-s.webp`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('bild');
  });
});
