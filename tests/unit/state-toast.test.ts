// Toast queue (client/src/state/toast.svelte.ts): toast.error() turns a failed request into a toast with
// the German message; a timeout or a request that did not reach the server offers "Erneut versuchen",
// which repeats the request (NF-09 AK, Kap. 6.6 "Zeitüberschreitung (10 s) | Toast „Das dauert zu lange“ |
// „Erneut versuchen“"). The screens pass the failed call as `retry` (RecipeList, RecipeDetail, Trash, More,
// Status); a toast action whose request fails (e.g. „Rückgängig“) goes through toast.error() as well.
// The store uses runes, which only the Svelte compiler understands, and Vitest runs without the Svelte
// plugin: the test strips the types, compiles the module with svelte/compiler and imports the result. Its
// imports point to the real files (i18n, lib/api.ts), only the rune-based connection store is mocked.
import fs from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_TEXTS } from '../../client/src/i18n/de.ts';
import { ApiError } from '../../client/src/lib/api.ts';

vi.mock('../../client/src/state/connection.svelte.ts', () => ({
  connection: { markOnline: () => {}, markOffline: () => {}, noteHeaders: () => {} },
}));

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STATE_DIR = path.join(ROOT, 'client/src/state');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toast-store-'));

/** Compiles the store to plain JS whose imports are absolute, so they resolve to the modules of this test. */
function compileStore(): string {
  const source = fs.readFileSync(path.join(STATE_DIR, 'toast.svelte.ts'), 'utf8');
  const { js } = compileModule(stripTypeScriptTypes(source), {
    filename: 'toast.svelte.js',
    generate: 'client',
  });
  const require = createRequire(import.meta.url);
  const code = js.code.replace(
    /(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g,
    (_all, head: string, q: string, spec: string) => {
      const target = spec.startsWith('.') ? path.resolve(STATE_DIR, spec) : require.resolve(spec);
      return `${head}${q}${target.replaceAll('\\', '/')}${q}`;
    },
  );
  const file = path.join(tmpDir, 'toast.svelte.js');
  fs.writeFileSync(file, code);
  return file.replaceAll('\\', '/');
}

interface ToastItem {
  id: number;
  message: string;
  actionLabel: string | null;
  run: (() => Promise<void> | void) | null;
}

interface Toasts {
  items: ToastItem[];
  busy: boolean;
  readonly current: ToastItem | null;
  show(message: string, options?: { undo?: () => Promise<void> | void }): number;
  error(err: unknown, retry: () => Promise<void> | void): number;
  dismiss(id: number): void;
  act(id: number): Promise<void>;
}

const { toast } = (await import(/* @vite-ignore */ compileStore())) as { toast: Toasts };

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const item of [...toast.items]) toast.dismiss(item.id);
});

const timeout = (): ApiError => new ApiError('TIMEOUT', 'Das dauert zu lange');

describe('toast.error (NF-09, Kap. 6.6)', () => {
  it('shows „Das dauert zu lange“ with „Erneut versuchen“ after a timeout', () => {
    toast.error(timeout(), () => {});
    expect(toast.current).toMatchObject({ message: 'Das dauert zu lange', actionLabel: 'Erneut versuchen' });
  });

  it('„Erneut versuchen“ runs the failed request again and removes the toast', async () => {
    const retry = vi.fn(async () => {});
    const id = toast.error(timeout(), retry);
    await toast.act(id);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(toast.current).toBeNull();
  });

  it('keeps the toast (button disabled) while the retry runs', async () => {
    let finish: () => void = () => {};
    const id = toast.error(timeout(), () => new Promise<void>((resolve) => (finish = resolve)));
    const acting = toast.act(id);
    expect(toast.busy).toBe(true);
    expect(toast.current?.id).toBe(id);
    finish();
    await acting;
    expect(toast.busy).toBe(false);
    expect(toast.current).toBeNull();
  });

  it('a retry that times out again leaves a new toast with „Erneut versuchen“', async () => {
    const again = vi.fn(() => {});
    const id = toast.error(timeout(), async () => {
      toast.error(timeout(), again);
    });
    await toast.act(id);
    expect(toast.items).toHaveLength(1);
    expect(toast.current).toMatchObject({ message: 'Das dauert zu lange', actionLabel: 'Erneut versuchen' });
    expect(toast.current?.id).not.toBe(id);
    await toast.act(toast.current?.id ?? 0);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('offers the retry for a request that did not reach the server (write errors, Kap. 6.6)', () => {
    toast.error(new ApiError('NETWORK', 'Server nicht erreichbar – läuft der Rezepte-PC?'), () => {});
    expect(toast.current?.actionLabel).toBe('Erneut versuchen');
  });

  it('shows other errors without an action: repeating them would only fail again', () => {
    toast.error(
      new ApiError('LAST_PROFILE', 'Das letzte Profil kann nicht gelöscht werden.', { status: 409 }),
      () => {},
    );
    expect(toast.current).toMatchObject({
      message: 'Das letzte Profil kann nicht gelöscht werden.',
      actionLabel: null,
      run: null,
    });
  });

  it('shows the generic text for an error that is not an ApiError', () => {
    toast.error(new TypeError('x is undefined'), () => {});
    expect(toast.current?.message).toBe(ERROR_TEXTS.INTERNAL);
    expect(toast.current?.actionLabel).toBeNull();
  });
});

describe('toast.act with a failing request (NF-09)', () => {
  it('„Rückgängig“ that times out offers „Erneut versuchen“, which runs the same action again', async () => {
    let fail = true;
    const undo = vi.fn(async () => {
      if (fail) throw timeout();
    });
    const id = toast.show('Rezept gelöscht', { undo });
    await toast.act(id);
    expect(toast.items).toHaveLength(1);
    expect(toast.current).toMatchObject({ message: 'Das dauert zu lange', actionLabel: 'Erneut versuchen' });
    fail = false;
    await toast.act(toast.current?.id ?? 0);
    expect(undo).toHaveBeenCalledTimes(2);
    expect(toast.current).toBeNull();
  });

  it('another request error shows its message without an action', async () => {
    const id = toast.show('Rezept gelöscht', {
      undo: () => Promise.reject(new ApiError('NOT_FOUND', 'Rezept nicht gefunden', { status: 404 })),
    });
    await toast.act(id);
    expect(toast.current).toMatchObject({ message: 'Rezept nicht gefunden', actionLabel: null });
  });

  it('an action that fails without a request error shows „Das hat nicht geklappt.“', async () => {
    const id = toast.show('Rezept gelöscht', {
      undo: () => {
        throw new TypeError('x is undefined');
      },
    });
    await toast.act(id);
    expect(toast.current).toMatchObject({ message: 'Das hat nicht geklappt.', actionLabel: null });
  });
});
