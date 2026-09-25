import { Hono } from 'hono';
import type { ImageInfo, ImageUploadResponse } from '../../shared/types.ts';
import { AppError } from '../errors.ts';
import { parseId, requireProfile } from '../middleware/profile.ts';
import { imageServiceFor } from '../services/images.ts';
import type { AppDeps, AppEnv } from '../types.ts';

/**
 * POST /images and GET /images/:id (Kap. 7.5), mounted under /api/v1. The upload is a raw body
 * (image/jpeg, image/png, image/webp or application/octet-stream; the client guard checks the type
 * and leaves the size to the service). The new image stays unassigned until a recipe write names it.
 */
export function imagesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/images', async (c) => {
    requireProfile(c);
    const body: ImageUploadResponse = await imageServiceFor(deps).upload({
      body: c.req.raw.body,
      contentLength: c.req.header('content-length'),
      requestId: c.get('requestId'),
      signal: c.req.raw.signal,
    });
    return c.json(body, 201);
  });

  app.get('/images/:id{[0-9]+}', (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null) throw new AppError('NOT_FOUND', 'Bild nicht gefunden');
    const body: ImageInfo = imageServiceFor(deps).info(id);
    return c.json(body);
  });

  return app;
}
