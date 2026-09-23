/**
 * `pnpm dev`: API server (node --watch) and Vite dev server side by side in one terminal, every line
 * prefixed with its source. Plain Node without dependencies and without a shell, so it behaves the same
 * in PowerShell, cmd and Git Bash.
 *
 * Stopping rules: Ctrl+C (or SIGTERM) stops both; if one process ends on its own, the other one is
 * stopped too and the runner exits with the code of the process that ended first.
 */
import { type ChildProcessByStdio, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

type Name = 'server' | 'client';

interface Proc {
  name: Name;
  child: ChildProcessByStdio<null, Readable, Readable>;
  exited: boolean;
  /** Exited and all stdio streams closed, i.e. no grandchild holds the pipes any more. */
  closed: boolean;
}

const root = path.resolve(import.meta.dirname, '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const isWindows = process.platform === 'win32';

// Long enough for the server's own clean shutdown (open requests get 5 s, then the WAL checkpoint, NF-24).
const GRACE_MS = 8000;
// Windows reports a process ended by Ctrl+C with this NTSTATUS as exit code instead of a signal.
const STATUS_CONTROL_C_EXIT = 0xc000013a;

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
const COLOR_CODES: Record<Name | 'dev', string> = { server: '36', client: '35', dev: '33' };
// Children write into pipes and would drop their colors; keep them when the runner itself has a terminal.
const colorEnv: NodeJS.ProcessEnv =
  useColor && process.env.FORCE_COLOR === undefined ? { FORCE_COLOR: '1' } : {};

const procs: Proc[] = [];
let stopping = false;
let exitCode = 0;
let graceTimer: NodeJS.Timeout | undefined;

function label(name: Name | 'dev'): string {
  const text = `[${name}]`.padEnd(8);
  return useColor ? `\x1b[${COLOR_CODES[name]}m${text}\x1b[0m` : text;
}

function say(message: string): void {
  process.stderr.write(`${label('dev')} ${message}\n`);
}

function pipeLines(input: Readable, output: Writable, prefix: string): void {
  // readline also emits a last line without trailing newline when the stream ends, so nothing is lost.
  readline.createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY }).on('line', (line) => {
    output.write(`${prefix} ${line}\n`);
  });
}

function start(name: Name, args: string[], env: NodeJS.ProcessEnv): Proc {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    // Nobody types into the children; both would otherwise compete for the terminal.
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX: an own process group lets the runner decide how signals reach the children (no double
    // SIGINT from the terminal) and lets it kill grandchildren (node --watch runs the real server as a
    // child). Windows: detached would open a new console and cut the children off from Ctrl+C.
    detached: !isWindows,
  });
  const proc: Proc = { name, child, exited: false, closed: false };
  const prefix = label(name);
  pipeLines(child.stdout, process.stdout, prefix);
  pipeLines(child.stderr, process.stderr, prefix);
  child.on('error', (error) => {
    say(`${name} konnte nicht gestartet werden: ${error.message}`);
    proc.exited = true;
    proc.closed = true;
    shutdown(1, null);
    finishIfDone();
  });
  child.on('exit', (code, signal) => onExit(proc, code, signal));
  child.on('close', () => {
    proc.exited = true;
    proc.closed = true;
    finishIfDone();
  });
  return proc;
}

function onExit(proc: Proc, code: number | null, signal: NodeJS.Signals | null): void {
  proc.exited = true;
  if (stopping) return;
  if (code === STATUS_CONTROL_C_EXIT) {
    // Ctrl+C reached this child before the runner's own SIGINT handler ran.
    shutdown(0, 'SIGINT');
    return;
  }
  const others = procs.filter((p) => p !== proc && !p.exited).map((p) => p.name);
  const reason = signal === null ? `Code ${code ?? 1}` : `Signal ${signal}`;
  say(`${proc.name} wurde beendet (${reason})${others.length > 0 ? `, stoppe ${others.join(', ')}` : ''}`);
  shutdown(code ?? 1, null);
}

/**
 * @param code exit code of the runner once everything has stopped
 * @param signal the signal the runner received, or null when a child ended on its own
 */
function shutdown(code: number, signal: NodeJS.Signals | null): void {
  if (stopping) {
    // A second Ctrl+C means: stop waiting.
    if (signal !== null) killAll();
    return;
  }
  stopping = true;
  exitCode = code;
  for (const proc of procs) requestStop(proc, signal);
  graceTimer = setTimeout(() => {
    say('Prozesse reagieren nicht und werden hart beendet');
    killAll();
    // Last resort if an orphaned grandchild still holds a pipe open.
    setTimeout(() => process.exit(exitCode), 3000).unref();
  }, GRACE_MS);
  finishIfDone();
}

function requestStop(proc: Proc, signal: NodeJS.Signals | null): void {
  if (proc.exited) return;
  if (!isWindows) {
    // node --watch passes SIGINT/SIGTERM on to the server, which then shuts down cleanly (NF-24);
    // Vite closes cleanly on SIGTERM.
    proc.child.kill(proc.name === 'server' && signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    return;
  }
  // Windows cannot send a signal to another process. Console events (Ctrl+C, Ctrl+Break, closing the
  // window) already reached both children through the shared console, so they stop by themselves;
  // only a child that ended on its own requires killing the other one.
  if (signal === null) forceKill(proc);
}

function forceKill(proc: Proc): void {
  const pid = proc.child.pid;
  if (proc.closed || pid === undefined) return;
  if (isWindows) {
    // child.kill() would end only node --watch and leave the actual server running with port 8080 bound;
    // taskkill /T ends the whole process tree.
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {
      proc.child.kill();
    });
    return;
  }
  try {
    // Negative pid: the whole process group, including the server started by node --watch.
    process.kill(-pid, 'SIGKILL');
  } catch {
    // group already gone
  }
}

function killAll(): void {
  for (const proc of procs) forceKill(proc);
}

function finishIfDone(): void {
  if (!stopping || procs.some((p) => !p.closed)) return;
  clearTimeout(graceTimer);
  // No process.exit(): Node ends by itself once the pipes are closed and flushes pending output first.
  process.exitCode = exitCode;
}

if (!fs.existsSync(viteBin)) {
  say(`Vite nicht gefunden (${viteBin}). Zuerst "pnpm install" ausführen.`);
  process.exit(1);
}

say('Starte Server (node --watch) und Vite, beenden mit Strg+C');
procs.push(
  start('server', ['--watch', '--disable-warning=ExperimentalWarning', 'server/main.ts'], {
    ...process.env,
    ...colorEnv,
    NODE_ENV: 'development',
  }),
  start('client', [viteBin], { ...process.env, ...colorEnv }),
);

const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
// Ctrl+Break in a Windows console.
if (isWindows) signals.push('SIGBREAK');
for (const signal of signals) {
  process.on(signal, () => shutdown(0, signal));
}
