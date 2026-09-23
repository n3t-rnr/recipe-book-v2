import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/config.ts';

const CWD = path.resolve('/srv/rezepte/app');
const OPTIONS = { cwd: CWD, hostname: 'KUECHE-PC' };

describe('loadConfig() defaults (Kap. 5.5)', () => {
  const config = loadConfig({}, OPTIONS);

  it('uses the documented defaults', () => {
    expect(config.env).toBe('development');
    expect(config.port).toBe(8080);
    expect(config.host).toBe('::');
    expect(config.publicUrl).toBeNull();
    expect(config.backupKeep).toBe(14);
    expect(config.trashDays).toBe(30);
    expect(config.maxUploadBytes).toBe(20_971_520);
    expect(config.logLevel).toBe('info');
  });

  it('resolves dataDir and clientDir against cwd', () => {
    expect(config.dataDir).toBe(path.resolve(CWD, 'data'));
    expect(config.clientDir).toBe(path.resolve(CWD, 'dist', 'client'));
  });

  it('lower-cases the computer name', () => {
    expect(config.hostname).toBe('kueche-pc');
  });

  it('allows the computer name, its .local name and <name>.fritz.box (NF-21)', () => {
    expect(config.allowedHosts).toEqual(
      expect.arrayContaining(['kueche-pc', 'kueche-pc.local', 'kueche-pc.fritz.box']),
    );
    expect(config.allowedHosts).toHaveLength(3);
  });

  it('falls back to process.cwd() without a cwd option', () => {
    expect(loadConfig({}, { hostname: 'x' }).dataDir).toBe(path.resolve(process.cwd(), 'data'));
  });
});

describe('loadConfig() with values', () => {
  it('reads every variable', () => {
    const config = loadConfig(
      {
        NODE_ENV: 'production',
        PORT: '8090',
        HOST: '0.0.0.0',
        DATA_DIR: 'C:/RezepteApp/data',
        PUBLIC_URL: 'http://rezepte.fritz.box:8090',
        BACKUP_KEEP: '7',
        TRASH_DAYS: '60',
        MAX_UPLOAD_MB: '5',
        LOG_LEVEL: 'debug',
      },
      OPTIONS,
    );
    expect(config.env).toBe('production');
    expect(config.port).toBe(8090);
    expect(config.host).toBe('0.0.0.0');
    // Absolute on Windows; on Linux (CI) "C:/…" is relative and resolves against cwd, like the code does.
    expect(config.dataDir).toBe(path.resolve(CWD, 'C:/RezepteApp/data'));
    expect(config.publicUrl).toBe('http://rezepte.fritz.box:8090');
    expect(config.backupKeep).toBe(7);
    expect(config.trashDays).toBe(60);
    expect(config.maxUploadBytes).toBe(5 * 1024 * 1024);
    expect(config.logLevel).toBe('debug');
  });

  it('resolves a relative DATA_DIR against cwd', () => {
    expect(loadConfig({ DATA_DIR: 'daten' }, OPTIONS).dataDir).toBe(path.resolve(CWD, 'daten'));
  });

  it('lets ALLOWED_HOSTS replace the fritz.box default, trimmed and lower-cased', () => {
    const { allowedHosts } = loadConfig({ ALLOWED_HOSTS: 'a.example, B.example ,,' }, OPTIONS);
    expect(allowedHosts).toEqual(
      expect.arrayContaining(['kueche-pc', 'kueche-pc.local', 'a.example', 'b.example']),
    );
    expect(allowedHosts).not.toContain('kueche-pc.fritz.box');
    expect(allowedHosts).not.toContain('');
    expect(allowedHosts).toHaveLength(4);
  });

  it('adds the PUBLIC_URL host (lower case, without port)', () => {
    const { allowedHosts } = loadConfig({ PUBLIC_URL: 'http://Rezepte.Fritz.Box:8080/' }, OPTIONS);
    expect(allowedHosts).toContain('rezepte.fritz.box');
    expect(allowedHosts).toContain('kueche-pc.fritz.box');
  });

  it('lists every allowed host only once', () => {
    const { allowedHosts } = loadConfig(
      { PUBLIC_URL: 'http://kueche-pc.local:8080', ALLOWED_HOSTS: 'KUECHE-PC,kueche-pc.local' },
      OPTIONS,
    );
    expect(allowedHosts).toEqual(['kueche-pc', 'kueche-pc.local']);
  });

  it('accepts an https PUBLIC_URL', () => {
    expect(loadConfig({ PUBLIC_URL: 'https://rezepte.example' }, OPTIONS).publicUrl).toBe(
      'https://rezepte.example',
    );
  });
});

describe('loadConfig() treats empty values as unset (WinSW writes empty <env> entries)', () => {
  it.each(['', '   '])('uses the defaults for %j', (blank) => {
    const config = loadConfig(
      {
        NODE_ENV: blank,
        PORT: blank,
        HOST: blank,
        DATA_DIR: blank,
        PUBLIC_URL: blank,
        ALLOWED_HOSTS: blank,
        BACKUP_KEEP: blank,
        TRASH_DAYS: blank,
        MAX_UPLOAD_MB: blank,
        LOG_LEVEL: blank,
      },
      OPTIONS,
    );
    expect(config).toEqual(loadConfig({}, OPTIONS));
  });
});

describe('loadConfig() rejects invalid values', () => {
  it.each([
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['PORT', '0'],
    ['PORT', '80.5'],
    ['PUBLIC_URL', 'ftp://x'],
    ['PUBLIC_URL', 'rezepte.fritz.box'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['BACKUP_KEEP', '0'],
    ['TRASH_DAYS', 'viele'],
    ['MAX_UPLOAD_MB', '101'],
  ])('%s=%j', (name, value) => {
    expect(() => loadConfig({ [name]: value }, OPTIONS)).toThrow(/^Ungültige Konfiguration/);
  });

  it('names the offending variable in the message', () => {
    expect(() => loadConfig({ PORT: 'abc' }, OPTIONS)).toThrow(/PORT/);
  });

  it('throws a plain Error', () => {
    let caught: unknown;
    try {
      loadConfig({ PUBLIC_URL: 'ftp://x' }, OPTIONS);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message.startsWith('Ungültige Konfiguration')).toBe(true);
  });

  it('stores umlaut host names in punycode so browser Host headers match (NF-21)', () => {
    const config = loadConfig({}, { cwd: '/app', hostname: 'Küche-PC' });
    expect(config.hostname).toBe('küche-pc');
    expect(config.allowedHosts).toContain('xn--kche-pc-n2a');
    expect(config.allowedHosts).toContain('xn--kche-pc-n2a.local');
    expect(config.allowedHosts).toContain('xn--kche-pc-n2a.fritz.box');
    expect(new URL('http://küche-pc.local:8080/').hostname).toBe('xn--kche-pc-n2a.local');
  });
});
