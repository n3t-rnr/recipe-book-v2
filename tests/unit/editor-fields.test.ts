// Keyboard handling and field widths of the editor's tag field and ingredient rows, which live in Svelte
// components the unit tests do not render. The key handlers are taken from the component sources and run
// with stand-ins for the event and the component state: Enter adds a tag or a row, Ctrl/Cmd+Enter falls
// through to the form, which saves (NF-11). The CSS checks keep Menge and Einheit at the artboard widths
// with room for „Menge“, „Einheit“ and „Packung“ (NF-16). The browser checks: tests/e2e/desktop.spec.ts
// (f6) and tests/e2e/layout-theme.spec.ts (e9).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const SRC = fileURLToPath(new URL('../../client/src/components/editor/', import.meta.url));
const TAGS = fs.readFileSync(path.join(SRC, 'TagInput.svelte'), 'utf8');
const INGREDIENTS = fs.readFileSync(path.join(SRC, 'IngredientEditor.svelte'), 'utf8');

/** Body of `function name(…) { … }` in a component's script (balanced braces). */
function body(source: string, name: string): string {
  const start = source.search(new RegExp(`function ${name}\\(`));
  if (start < 0) throw new Error(`no function ${name}`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced function ${name}`);
}

/** Declarations of the first CSS rule with exactly this selector in the component's <style>. */
function rule(source: string, selector: string, from = 0): string {
  const css = (/<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '').slice(from);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (found === undefined) throw new Error(`no rule "${selector}"`);
  return found;
}

/** Offset of the one-line rules (container ≥ 480 px) in the <style> block. */
function wideFrom(source: string): number {
  const css = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';
  const at = css.indexOf('@container (min-width: 480px)');
  if (at < 0) throw new Error('no container rule');
  return at;
}

interface Key {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

function keyEvent(init: Key) {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    ...init,
    preventDefault: vi.fn(),
  };
}

type TagHandler = (
  event: ReturnType<typeof keyEvent>,
  pending: string,
  add: (text: string) => string[],
) => string;

/** TagInput's onkeydown with its state as parameters; returns the pending text afterwards. */
const tagKeydown = new Function(
  'event',
  'pending',
  'add',
  `(() => {${body(TAGS, 'onkeydown')}})();\nreturn pending;`,
) as TagHandler;

type RowHandler = (
  event: ReturnType<typeof keyEvent>,
  index: number,
  lastIngredient: number,
  addIngredient: () => void,
) => void;

/** IngredientEditor's onLastKeydown with its state as parameters. */
const rowKeydown = new Function(
  'event',
  'index',
  'lastIngredient',
  'addIngredient',
  body(INGREDIENTS, 'onLastKeydown'),
) as RowHandler;

describe('tag field keys (F-17, NF-11)', () => {
  it('adds the typed tag on Enter and keeps the form from moving on', () => {
    const add = vi.fn((): string[] => []);
    const event = keyEvent({ key: 'Enter' });
    expect(tagKeydown(event, 'Kuchen', add)).toBe('');
    expect(add).toHaveBeenCalledWith('Kuchen');
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it.each([
    ['Ctrl+Enter', { ctrlKey: true }],
    ['Cmd+Enter', { metaKey: true }],
  ])('leaves %s to the form, which saves and adds the pending tag itself', (_, mods) => {
    const add = vi.fn((): string[] => []);
    const event = keyEvent({ key: 'Enter', ...mods });
    expect(tagKeydown(event, 'Kuchen', add)).toBe('Kuchen');
    expect(add).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores Enter while an input method composes', () => {
    const add = vi.fn((): string[] => []);
    const event = keyEvent({ key: 'Enter', isComposing: true });
    expect(tagKeydown(event, 'Kuch', add)).toBe('Kuch');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('ingredient row keys (F-10, NF-11)', () => {
  it('adds a row on Enter in the last ingredient', () => {
    const addIngredient = vi.fn();
    const event = keyEvent({ key: 'Enter' });
    rowKeydown(event, 2, 2, addIngredient);
    expect(addIngredient).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it.each([
    ['Ctrl+Enter', { ctrlKey: true }],
    ['Cmd+Enter', { metaKey: true }],
    ['Shift+Enter', { shiftKey: true }],
  ])('adds no row on %s: the form handles it (Ctrl/Cmd+Enter saves)', (_, mods) => {
    const addIngredient = vi.fn();
    const event = keyEvent({ key: 'Enter', ...mods });
    rowKeydown(event, 2, 2, addIngredient);
    expect(addIngredient).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('adds no row on Enter in an earlier ingredient', () => {
    const addIngredient = vi.fn();
    const event = keyEvent({ key: 'Enter' });
    rowKeydown(event, 0, 2, addIngredient);
    expect(addIngredient).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('Menge and Einheit fields (NF-16, NF-15)', () => {
  it('keep the artboard widths: 72 and 88 px in two lines, 64 and 76 px in one line', () => {
    expect(rule(INGREDIENTS, '.fields > .input.amount')).toMatch(/width:\s*72px/);
    expect(rule(INGREDIENTS, '.fields > .input.unit')).toMatch(/width:\s*88px/);
    const wide = wideFrom(INGREDIENTS);
    expect(rule(INGREDIENTS, '.fields > .input.amount', wide)).toMatch(/width:\s*64px/);
    expect(rule(INGREDIENTS, '.fields > .input.unit', wide)).toMatch(/width:\s*76px/);
  });

  it('use 5 px side padding (4.5 px with the 2 px focus or error border) and keep the 16 px text', () => {
    for (const selector of ['.fields > .input.amount', '.fields > .input.unit']) {
      const declarations = rule(INGREDIENTS, selector);
      expect(declarations).toMatch(/padding:\s*0 5px;/);
      expect(declarations).not.toMatch(/font-size|letter-spacing/);
    }
    expect(rule(INGREDIENTS, '.fields > .input:is(.amount, .unit):is(:focus-visible, .invalid)')).toMatch(
      /padding:\s*0 4\.5px;/,
    );
  });

  it('hide the datalist arrow, which takes 21 px of the unit field in Chromium', () => {
    expect(rule(INGREDIENTS, '.unit::-webkit-calendar-picker-indicator')).toMatch(
      /display:\s*none !important/,
    );
    expect(rule(INGREDIENTS, '.unit::-webkit-list-button')).toMatch(/display:\s*none !important/);
  });
});
