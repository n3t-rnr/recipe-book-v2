import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { type Config, loadConfig } from './config.ts';
import { closeDatabase, openDatabase } from './db/connection.ts';
import { ensureFtsConsistent, reindexAll } from './db/fts.ts';
import { MIGRATIONS_DIR, runMigrations } from './db/migrate.ts';
import { createFileLogger, type Logger } from './log.ts';
import { dataPaths, ensureDataDirs } from './paths.ts';
import { runImageStartup } from './services/image-cleanup.ts';
import { startMaintenance } from './services/maintenance.ts';
import { getNetInfo, qrAscii } from './services/net-info.ts';
import { probeIPv4Port } from './services/port.ts';
import { ensureStartTags } from './services/tags.ts';
import type { AppDeps, RuntimeState } from './types.ts';
import { APP_VERSION } from './version.ts';

/** Start errors end the process with exit code 1 and a German message (NF-24). */
function fail(message: string): never {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadImages(log: Logger): Promise<RuntimeState['images']> {
  try {
    const sharp = (await import('sharp')).default;
    sharp.cache(false);
    sharp.concurrency(2);
    return 'ok';
  } catch (err) {
    // Degraded mode: the app runs, uploads answer 503 IMAGES_UNAVAILABLE (NF-24).
    log.error('sharp konnte nicht geladen werden', { err });
    return 'unavailable';
  }
}

function printBanner(config: Config, log: Logger): void {
  const info = getNetInfo(config);
  log.info('urls', { urls: info.urls.map((u) => u.url), qrUrl: info.qrUrl });
  const lines = ['', `Rezepte-App ${APP_VERSION} läuft. Öffne auf Handy oder Tablet:`];
  for (const u of info.urls)
    lines.push(`  ${u.url}${u.kind === 'mdns' ? '   (falls .local im Netz funktioniert)' : ''}`);
  lines.push('', 'Oder diesen QR-Code mit der Kamera scannen:', qrAscii(info.qrUrl), '');
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    fail(errorMessage(err));
  }

  const paths = dataPaths(config.dataDir);
  try {
    ensureDataDirs(paths);
  } catch (err) {
    fail(`Datenordner nicht beschreibbar: ${config.dataDir} (${errorMessage(err)})`);
  }

  const log = createFileLogger({
    dir: paths.logs,
    level: config.logLevel,
    console: config.env !== 'production',
  });
  log.info('start', { version: APP_VERSION, env: config.env, dataDir: config.dataDir, port: config.port });

  let opened: ReturnType<typeof openDatabase>;
  try {
    opened = openDatabase(paths.db, log);
  } catch (err) {
    fail(errorMessage(err));
  }
  const { db, status } = opened;

  if (status === 'ok') {
    try {
      runMigrations(db, { migrationsDir: MIGRATIONS_DIR, backupsDir: paths.backups, log });
    } catch (err) {
      log.error('migration failed', { err });
      closeDatabase(db, log);
      fail(errorMessage(err));
    }
    if (process.argv.includes('--rebuild-fts')) {
      log.info('fts rebuilt', { recipes: reindexAll(db) });
    } else {
      ensureFtsConsistent(db, log);
    }
    // A new installation gets the start tags once (F-20); meta.seeded keeps deleted ones deleted.
    const created = ensureStartTags(db, new Date());
    if (created > 0) log.info('start tags created', { count: created });
  } else {
    log.error('Datenbank beschädigt – Nur-Lese-Modus. Wiederherstellung siehe docs/BETRIEB.md.');
  }

  const state: RuntimeState = {
    version: APP_VERSION,
    startedAt: new Date(),
    db: status,
    images: await loadImages(log),
  };

  const deps: AppDeps = {
    config,
    db,
    paths,
    state,
    log,
    clientDir: config.clientDir,
    netInfo: () => getNetInfo(config),
    now: () => new Date(),
  };
  // Before the port opens (F-16, Kap. 10.9): referenced image files come back from images/.trash,
  // e.g. after restoring a database backup; files without a row move there. Skipped when read-only.
  runImageStartup(deps);
  const app = createApp(deps);

  // @hono/node-server returns a union incl. HTTP/2 servers; without TLS options it is always http.Server.
  const holder: { server: Server | null; stopMaintenance: (() => void) | null } = {
    server: null,
    stopMaintenance: null,
  };
  const listen = (hostname: string): void => {
    const server = serve({ fetch: app.fetch, port: config.port, hostname }, (address: AddressInfo) => {
      log.info('listening', { address: address.address, port: address.port });
      printBanner(config, log);
      // Last start step (Kap. 5.4): the hourly maintenance, incl. the 30-day trash purge (F-08).
      holder.stopMaintenance ??= startMaintenance(deps);
    }) as Server;
    holder.server = server;
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EAFNOSUPPORT' && hostname === '::') {
        log.warn('IPv6 nicht verfügbar, lausche nur auf IPv4');
        listen('0.0.0.0');
        return;
      }
      if (err.code === 'EADDRINUSE') fail(`Port ${config.port} ist bereits belegt`);
      if (err.code === 'EACCES') fail(`Port ${config.port} ist von Windows reserviert – anderen Port wählen`);
      log.error('server error', { err });
      fail(`Server konnte nicht starten: ${err.message}`);
    });
  };
  if (config.host === '::') {
    const probe = await probeIPv4Port(config.port);
    if (probe === 'EADDRINUSE') fail(`Port ${config.port} ist bereits belegt`);
    if (probe === 'EACCES') fail(`Port ${config.port} ist von Windows reserviert – anderen Port wählen`);
  }
  listen(config.host);

  // Clean shutdown (NF-24): WinSW sends Ctrl+C (SIGINT); SIGBREAK for Ctrl+Break; SIGTERM elsewhere.
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`shutdown: ${signal}`);
    // No maintenance run may start between here and closing the database.
    holder.stopMaintenance?.();
    holder.stopMaintenance = null;
    const finish = () => {
      closeDatabase(db, log);
      process.exit(0);
    };
    const server = holder.server;
    if (!server) {
      finish();
      return;
    }
    // Open requests get at most 5 s, then the connections are cut (NF-24).
    const force = setTimeout(() => {
      server.closeAllConnections();
      finish();
    }, 5000);
    force.unref();
    server.close(() => {
      clearTimeout(force);
      finish();
    });
    server.closeIdleConnections();
  };
  for (const signal of ['SIGINT', 'SIGBREAK', 'SIGTERM'] as const) {
    process.on(signal, () => shutdown(signal));
  }
}

await main();
