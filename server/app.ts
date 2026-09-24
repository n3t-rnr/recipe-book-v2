import { Hono } from 'hono';
import { AppError } from './errors.ts';
import { clientGuard } from './middleware/client-guard.ts';
import { errorHandler } from './middleware/error.ts';
import { hostCheck } from './middleware/host-check.ts';
import { profileContext } from './middleware/profile.ts';
import { requestContext } from './middleware/request-context.ts';
import { revision } from './middleware/revision.ts';
import { securityHeaders } from './middleware/security-headers.ts';
import { opsRoutes } from './routes/ops.ts';
import { profilesRoutes } from './routes/profiles.ts';
import { recipeListRoutes } from './routes/recipe-list.ts';
import { recipesRoutes } from './routes/recipes.ts';
import { registerStatic } from './routes/static.ts';
import type { AppDeps, AppEnv } from './types.ts';

/**
 * Hono app factory (Kap. 5.4). Testable without network via app.request().
 * Middleware order: requestId → host check → security headers → client guard → revision → profile → routes → error.
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', requestContext(deps));
  app.use('*', hostCheck(deps));
  app.use('*', securityHeaders(deps));
  app.use('/api/*', clientGuard(deps));
  app.use('/api/*', revision(deps));
  app.use('/api/*', profileContext(deps));

  app.route('/api/v1', opsRoutes(deps));
  app.route('/api/v1', profilesRoutes(deps));
  app.route('/api/v1', recipeListRoutes(deps));
  app.route('/api/v1', recipesRoutes(deps));
  app.all('/api/*', () => {
    throw new AppError('NOT_FOUND', 'Unbekannter API-Pfad');
  });

  registerStatic(app, deps);

  app.onError(errorHandler(deps));
  return app;
}
