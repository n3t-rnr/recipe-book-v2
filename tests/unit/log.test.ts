import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../server/errors.ts';
import { createFileLogger, createMemoryLogger, type FileLoggerOptions } from '../../server/log.ts';

const FIXED_NOW = new Date('2026-09-23T10:05:00.123Z');

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-log-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const logFile = (name = 'app.log') => path.join(dir, name);

function logger(options: Partial<FileLoggerOptions> = {}) {
  return createFileLogger({ dir, level: 'info', console: false, now: () => FIXED_NOW, ...options });
}

function readLines(name = 'app.log'): Array<Record<string, unknown>> {
  const text = fs.readFileSync(logFile(name), 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('createFileLogger() format (NF-25)', () => {
  it('writes one JSON line per call with time, level, msg and fields', () => {
    const log = logger();
    log.info('request', {
      requestId: 'r1',
      method: 'GET',
      path: '/api/v1/health',
      status: 200,
      durationMs: 3,
    });
    log.warn('slow');
    expect(readLines()).toEqual([
      {
        time: '2026-09-23T10:05:00.123Z',
        level: 'info',
        msg: 'request',
        requestId: 'r1',
        method: 'GET',
        path: '/api/v1/health',
        status: 200,
        durationMs: 3,
      },
      { time: '2026-09-23T10:05:00.123Z', level: 'warn', msg: 'slow' },
    ]);
  });

  it('starts every line with time, level and msg', () => {
    logger().info('first', { a: 1 });
    const [line] = fs.readFileSync(logFile(), 'utf8').split('\n');
    expect(line).toMatch(/^\{"time":"[^"]+","level":"info","msg":"first","a":1\}$/);
  });

  it('writes the time in UTC by default', () => {
    createFileLogger({ dir, level: 'info', console: false }).info('now');
    expect(readLines()[0]?.time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it('never lets a field overwrite time, level or msg', () => {
    logger().info('real', { time: 'fake', level: 'debug', msg: 'spoof', extra: true });
    expect(readLines()).toEqual([
      { time: '2026-09-23T10:05:00.123Z', level: 'info', msg: 'real', extra: true },
    ]);
  });

  it('creates the log directory on demand', () => {
    const nested = path.join(dir, 'data', 'logs');
    createFileLogger({ dir: nested, level: 'info', console: false }).info('hello');
    expect(fs.existsSync(path.join(nested, 'app.log'))).toBe(true);
  });
});

describe('createFileLogger() level filter', () => {
  it('suppresses debug at level info', () => {
    const log = logger({ level: 'info' });
    log.debug('hidden');
    log.info('shown');
    log.warn('shown');
    log.error('shown');
    expect(readLines().map((l) => l.level)).toEqual(['info', 'warn', 'error']);
  });

  it('writes debug at level debug', () => {
    logger({ level: 'debug' }).debug('visible');
    expect(readLines().map((l) => l.msg)).toEqual(['visible']);
  });

  it('only writes errors at level error', () => {
    const log = logger({ level: 'error' });
    log.info('no');
    log.warn('no');
    log.error('yes');
    expect(readLines().map((l) => l.msg)).toEqual(['yes']);
  });

  it('does not create a file when every line is filtered', () => {
    logger({ level: 'warn' }).info('ignored');
    expect(fs.existsSync(logFile())).toBe(false);
  });
});

describe('createFileLogger() errors', () => {
  it('serializes Error fields with name, message and stack', () => {
    const error = new Error('Datenbank kaputt');
    logger().error('request failed', { err: error });
    const err = readLines()[0]?.err as Record<string, unknown>;
    expect(err.name).toBe('Error');
    expect(err.message).toBe('Datenbank kaputt');
    expect(typeof err.stack).toBe('string');
    expect(err.stack).toContain('Datenbank kaputt');
  });

  it('keeps the code of an AppError and of Node system errors', () => {
    const system = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    logger().error('failed', { app: new AppError('NOT_FOUND', 'Rezept nicht gefunden'), system });
    expect(readLines()[0]).toMatchObject({
      app: { name: 'AppError', code: 'NOT_FOUND', message: 'Rezept nicht gefunden' },
      system: { code: 'EADDRINUSE' },
    });
  });

  it('serializes the cause chain', () => {
    const error = new Error('outer', { cause: new Error('inner') });
    logger().error('failed', { err: error });
    const err = readLines()[0]?.err as { cause: { message: string; stack: string } };
    expect(err.cause.message).toBe('inner');
    expect(err.cause.stack).toContain('inner');
  });

  it('never throws on fields JSON cannot handle (BigInt, cycles)', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const log = logger();
    expect(() => log.info('bigint', { rowid: 10n })).not.toThrow();
    expect(() => log.info('cycle', { cyclic })).not.toThrow();
    const lines = readLines();
    expect(lines[0]).toMatchObject({ msg: 'bigint', rowid: '10' });
    expect(lines[1]).toMatchObject({ level: 'info', msg: 'cycle', logError: 'fields not serializable' });
  });

  it('never throws when the log directory cannot be created', () => {
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'a file, not a directory');
    const log = createFileLogger({ dir: path.join(blocker, 'logs'), level: 'info', console: false });
    expect(() => log.error('lost', { err: new Error('x') })).not.toThrow();
  });
});

describe('createFileLogger() rotation (NF-25)', () => {
  it('keeps no more than 3 files and creates app.1.log after the size limit', () => {
    const log = logger({ maxBytes: 200, files: 3 });
    for (let i = 0; i < 200; i++) {
      log.info('line', { i });
      expect(fs.readdirSync(dir).length).toBeLessThanOrEqual(3);
    }
    expect(fs.readdirSync(dir).sort()).toEqual(['app.1.log', 'app.2.log', 'app.log']);
  });

  it('shifts generations without losing or reordering the newest lines', () => {
    const log = logger({ maxBytes: 200, files: 3 });
    const total = 50;
    for (let i = 0; i < total; i++) log.info('line', { i });
    const indexes = ['app.2.log', 'app.1.log', 'app.log'].flatMap((name) => readLines(name).map((l) => l.i));
    const first = total - indexes.length;
    expect(indexes).toEqual(Array.from({ length: indexes.length }, (_, k) => first + k));
    expect(indexes.at(-1)).toBe(total - 1);
  });

  it('rotates only once app.log has reached maxBytes', () => {
    const log = logger({ maxBytes: 10_000, files: 3 });
    for (let i = 0; i < 20; i++) log.info('line', { i });
    expect(fs.readdirSync(dir)).toEqual(['app.log']);
  });

  it('uses 5 MB and 3 files by default', () => {
    // Pre-fill app.log to just under 5 MB: the next line crosses the limit, the one after rotates.
    fs.writeFileSync(logFile(), 'x'.repeat(5 * 1024 * 1024 - 10));
    const log = logger();
    log.info('crosses the limit');
    expect(fs.existsSync(logFile('app.1.log'))).toBe(false);
    log.info('rotates');
    expect(fs.existsSync(logFile('app.1.log'))).toBe(true);
    expect(readLines().map((l) => l.msg)).toEqual(['rotates']);
  });

  it('keeps a single bounded file when files is 1', () => {
    const log = logger({ maxBytes: 200, files: 1 });
    for (let i = 0; i < 100; i++) log.info('line', { i });
    expect(fs.readdirSync(dir)).toEqual(['app.log']);
    expect(fs.statSync(logFile()).size).toBeLessThan(400);
  });
});

describe('createFileLogger() keeps no open handle (NF-25)', () => {
  it('recreates app.log after it was deleted while running', () => {
    const log = logger();
    log.info('before');
    fs.rmSync(logFile());
    expect(() => log.info('after delete')).not.toThrow();
    log.info('next');
    expect(readLines().map((l) => l.msg)).toEqual(['after delete', 'next']);
  });

  it('recreates app.log after it was moved while running', () => {
    const log = logger();
    log.info('before');
    fs.renameSync(logFile(), logFile('moved.log'));
    log.info('after move');
    expect(readLines('moved.log').map((l) => l.msg)).toEqual(['before']);
    expect(readLines().map((l) => l.msg)).toEqual(['after move']);
  });

  it('recreates the whole log directory after it was deleted', () => {
    const logs = path.join(dir, 'logs');
    const log = createFileLogger({ dir: logs, level: 'info', console: false });
    log.info('before');
    fs.rmSync(logs, { recursive: true });
    log.info('after');
    expect(fs.readFileSync(path.join(logs, 'app.log'), 'utf8')).toContain('"msg":"after"');
  });
});

describe('createFileLogger() console mirror', () => {
  it('mirrors info to stdout and warn/error to stderr when enabled', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = logger({ console: true });
    log.info('to stdout');
    log.warn('to stderr');
    log.error('to stderr too');
    expect(out).toHaveBeenCalledTimes(1);
    expect(String(out.mock.calls[0]?.[0])).toContain('"msg":"to stdout"');
    expect(err).toHaveBeenCalledTimes(2);
  });

  it('stays silent on the console when disabled', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = logger({ console: false });
    log.info('file only');
    log.error('file only');
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});

describe('createMemoryLogger()', () => {
  it('collects entries with level, msg and fields', () => {
    const log = createMemoryLogger();
    log.debug('d');
    log.info('request', { status: 200 });
    log.error('boom', { err: new Error('x') });
    expect(log.entries.map((e) => [e.level, e.msg])).toEqual([
      ['debug', 'd'],
      ['info', 'request'],
      ['error', 'boom'],
    ]);
    expect(log.entries[1]?.status).toBe(200);
    expect(log.entries[2]?.err).toBeInstanceOf(Error);
    expect(log.entries[0]?.time).toMatch(/Z$/);
  });

  it('filters by level', () => {
    const log = createMemoryLogger('warn');
    log.debug('no');
    log.info('no');
    log.warn('yes');
    log.error('yes');
    expect(log.entries.map((e) => e.level)).toEqual(['warn', 'error']);
  });

  it('never lets a field overwrite level or msg', () => {
    const log = createMemoryLogger();
    log.info('real', { level: 'error', msg: 'spoof' });
    expect(log.entries[0]).toMatchObject({ level: 'info', msg: 'real' });
  });
});
