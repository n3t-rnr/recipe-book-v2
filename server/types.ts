import type { PersonRef } from '../shared/types.ts';
import type { Config } from './config.ts';
import type { DB } from './db/types.ts';
import type { Logger } from './log.ts';
import type { DataPaths } from './paths.ts';

/** Mutable runtime status shown by /api/v1/health (Kap. 7.8). */
export interface RuntimeState {
  version: string;
  startedAt: Date;
  /** "corrupt" after a failed PRAGMA quick_check: read-only mode, writes answer 503 READ_ONLY (NF-19). */
  db: 'ok' | 'corrupt';
  /** "unavailable" when sharp failed to load: uploads answer 503 IMAGES_UNAVAILABLE (NF-24). */
  images: 'ok' | 'unavailable';
}

export interface NetUrl {
  url: string;
  kind: 'public' | 'ip' | 'mdns';
}

/** Result of /api/v1/server-info; recomputed on every call (F-39). */
export interface NetInfo {
  hostname: string;
  urls: NetUrl[];
  qrUrl: string;
  qrSvg: string;
}

/** Everything the Hono app needs. Tests build it with tests/helpers/app.ts. */
export interface AppDeps {
  config: Config;
  db: DB;
  paths: DataPaths;
  state: RuntimeState;
  log: Logger;
  /** Directory with the built client (dist/client in production, a fixture in tests). */
  clientDir: string;
  /** Resolves the reachable URLs; called on every /server-info request. */
  netInfo: () => NetInfo;
  now: () => Date;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    /** Acting profile from X-Profile-Id (F-05); null when the header is absent. Set by profileContext on /api/*. */
    profile: PersonRef | null;
  };
}
