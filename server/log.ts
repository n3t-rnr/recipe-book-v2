import fs from 'node:fs';
import path from 'node:path';
import type { LogLevel } from './config.ts';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface LogEntry extends LogFields {
  time: string;
  level: LogLevel;
  msg: string;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface FileLoggerOptions {
  /** Directory for app.log; created on demand. */
  dir: string;
  level: LogLevel;
  /** Mirror every line to stdout/stderr (dev, WinSW also captures it). */
  console: boolean;
  /** Rotate when app.log reaches this size (NF-25: 5 MB). */
  maxBytes?: number;
  /** Total number of files including app.log (NF-25: 3). */
  files?: number;
  now?: () => Date;
}

/**
 * JSON Lines logger (NF-25). The file is never kept open: every line is appended with
 * appendFileSync, so a deleted or moved app.log is simply recreated by the next write.
 */
export function createFileLogger(options: FileLoggerOptions): Logger {
  const file = path.join(options.dir, 'app.log');
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const files = Math.max(1, options.files ?? 3);
  const now = options.now ?? (() => new Date());

  const rotate = () => {
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size < maxBytes) return;
    if (files === 1) {
      // No generations to keep: start over instead of growing without bound.
      fs.rmSync(file, { force: true });
      return;
    }
    for (let i = files - 1; i >= 1; i--) {
      const from = i === 1 ? file : path.join(options.dir, `app.${i - 1}.log`);
      const to = path.join(options.dir, `app.${i}.log`);
      try {
        fs.renameSync(from, to);
      } catch {
        // missing generation: nothing to shift
      }
    }
  };

  const write = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (ORDER[level] < ORDER[options.level]) return;
    const line = `${serialize(createEntry(now(), level, msg, fields))}\n`;
    try {
      fs.mkdirSync(options.dir, { recursive: true });
      rotate();
      fs.appendFileSync(file, line, 'utf8');
    } catch {
      // Logging must never crash the server; the console copy below still shows the line.
    }
    if (options.console) {
      (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line);
    }
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

export interface MemoryLogger extends Logger {
  entries: LogEntry[];
}

/** In-memory logger for tests. */
export function createMemoryLogger(level: LogLevel = 'debug'): MemoryLogger {
  const entries: LogEntry[] = [];
  const write = (lvl: LogLevel, msg: string, fields?: LogFields) => {
    if (ORDER[lvl] < ORDER[level]) return;
    entries.push(createEntry(new Date(), lvl, msg, fields));
  };
  return {
    entries,
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

function createEntry(time: Date, level: LogLevel, msg: string, fields: LogFields | undefined): LogEntry {
  // Core keys come first for readable lines and are applied again last, so a field
  // named "level", "time" or "msg" can never fake them.
  const core = { time: time.toISOString(), level, msg };
  return Object.assign({ ...core }, fields, core);
}

/** JSON.stringify throws on BigInt (handled by the replacer) and on cycles; a log call must never throw. */
function serialize(entry: LogEntry): string {
  try {
    return JSON.stringify(entry, replacer);
  } catch {
    return JSON.stringify({
      time: entry.time,
      level: entry.level,
      msg: entry.msg,
      logError: 'fields not serializable',
    });
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    // Error properties are not enumerable; code covers AppError and Node system errors (EADDRINUSE, …).
    const code = 'code' in value ? value.code : undefined;
    return {
      name: value.name,
      message: value.message,
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
      stack: value.stack,
      ...(value.cause !== undefined && value.cause !== value ? { cause: value.cause } : {}),
    };
  }
  return value;
}
