import os from 'node:os';
import path from 'node:path';
import { domainToASCII } from 'node:url';
import { z } from 'zod';
import { LIMITS } from '../shared/constants.ts';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'production', 'test']).default('development'),
  ),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(8080)),
  HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  DATA_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
  PUBLIC_URL: z.preprocess(emptyToUndefined, z.url({ protocol: /^https?$/ }).optional()),
  ALLOWED_HOSTS: z.preprocess(emptyToUndefined, z.string().optional()),
  BACKUP_KEEP: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(365).default(14)),
  TRASH_DAYS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(365).default(30)),
  MAX_UPLOAD_MB: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).default(20)),
  LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(['debug', 'info', 'warn', 'error']).default('info')),
});

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  /** Listen address; "::" (dual stack) unless HOST is set (Kap. 10.6). */
  host: string;
  dataDir: string;
  /** Preferred URL for QR code and link lists, e.g. http://rezepte.fritz.box:8080. */
  publicUrl: string | null;
  /** Lower-case computer name, e.g. "kueche-pc". */
  hostname: string;
  /** Exact host names (lower case, without port) that pass the host check besides IP literals and localhost (NF-21). */
  allowedHosts: string[];
  backupKeep: number;
  trashDays: number;
  maxUploadBytes: number;
  logLevel: LogLevel;
  /** Absolute path of the built client. */
  clientDir: string;
}

export interface LoadConfigOptions {
  cwd?: string;
  hostname?: string;
}

/** Parses the environment (WinSW XML or shell). Throws a readable error on invalid values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: LoadConfigOptions = {}): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ungültige Konfiguration: ${issues}`);
  }
  const e = parsed.data;
  const cwd = options.cwd ?? process.cwd();
  const hostname = (options.hostname ?? os.hostname()).toLowerCase();
  const publicUrl = e.PUBLIC_URL ?? null;

  // Browsers send IDN host names as punycode ("küche-pc" → "xn--kche-pc-p2a"), so the allow list is
  // compared in ASCII form; unconvertible names are kept as typed (NF-21).
  const allowed = new Set<string>();
  const allow = (name: string) => {
    const trimmed = name.trim().toLowerCase();
    if (trimmed) allowed.add(domainToASCII(trimmed) || trimmed);
  };
  allow(hostname);
  allow(`${hostname}.local`);
  if (publicUrl) allow(new URL(publicUrl).hostname);
  for (const name of (e.ALLOWED_HOSTS ?? `${hostname}.fritz.box`).split(',')) allow(name);

  const maxUploadBytes = e.MAX_UPLOAD_MB === 20 ? LIMITS.uploadBytes : e.MAX_UPLOAD_MB * 1024 * 1024;

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST ?? '::',
    dataDir: path.resolve(cwd, e.DATA_DIR ?? 'data'),
    publicUrl,
    hostname,
    allowedHosts: [...allowed],
    backupKeep: e.BACKUP_KEEP,
    trashDays: e.TRASH_DAYS,
    maxUploadBytes,
    logLevel: e.LOG_LEVEL,
    clientDir: path.resolve(cwd, 'dist', 'client'),
  };
}
