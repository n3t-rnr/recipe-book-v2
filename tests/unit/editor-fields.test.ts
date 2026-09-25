// Keyboard handling and field widths of the editor's tag field and ingredient rows, which live in Svelte
// components the unit tests do not render. The tag field decides with the pure tagKeyAction (lib/editor.ts,
// F-18): arrows mark a suggestion, Enter adds the typed text or picks the marked suggestion, Ctrl/Cmd+Enter
// falls through to the form, which saves (NF-11). The key handlers are taken from the component sources and
// run with stand-ins for the event and the component state. The CSS checks keep Menge and Einheit at the
// artboard widths with room for „Menge“, „Einheit“ and „Packung“ (NF-16). The browser checks:
// tests/e2e/tag-input.spec.ts, tests/e2e/desktop.spec.ts (f6) and tests/e2e/layout-theme.spec.ts (e9).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { type TagKeyAction, tagKeyAction } from '../../client/src/lib/editor.ts';

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

interface TagState {
  /** Shown suggestions (only their count and names matter here). */
  suggestions: Array<{ name: string }>;
  expanded: boolean;
  active: number;
  dismissed: boolean;
  pending: string;
}

type TagHandler = (
  decide: typeof tagKeyAction,
  event: ReturnType<typeof keyEvent>,
  state: TagState,
  pick: (name: string, refocus: boolean) => void,
  add: (text: string) => string[],
) => Omit<TagState, 'suggestions' | 'expanded'>;

/** TagInput's onkeydown with its state as parameters; returns the state afterwards. */
const tagKeydownRaw = new Function(
  'tagKeyAction',
  'event',
  'state',
  'pick',
  'add',
  `let { suggestions, expanded, active, dismissed, pending } = state;
  (() => {${body(TAGS, 'onkeydown')}})();
  return { active, dismissed, pending };`,
) as TagHandler;

function tagKeydown(init: Key, state: Partial<TagState> = {}) {
  const event = keyEvent(init);
  const pick = vi.fn();
  const add = vi.fn((): string[] => []);
  const suggestions = state.suggestions ?? [{ name: 'Vegetarisch' }, { name: 'Vegan' }];
  const after = tagKeydownRaw(
    tagKeyAction,
    event,
    { suggestions, expanded: true, active: -1, dismissed: false, pending: 'veg', ...state },
    pick,
    add,
  );
  return { ...after, event, pick, add };
}

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

describe('tag field keys: tagKeyAction (F-17, F-18, NF-11)', () => {
  const closed = { expanded: false, active: -1 };
  const open = { expanded: true, active: -1 };
  const marked = { expanded: true, active: 1 };
  const action = (init: Key, state: { expanded: boolean; active: number }): TagKeyAction | null =>
    tagKeyAction(keyEvent(init), state.expanded, state.active);

  it('adds the typed text on Enter while no suggestion is marked, also with suggestions shown', () => {
    expect(action({ key: 'Enter' }, closed)).toBe('add');
    expect(action({ key: 'Enter' }, open)).toBe('add');
    expect(action({ key: 'Enter', shiftKey: true }, open)).toBe('add');
  });

  it('picks the marked suggestion on Enter and on a comma (F-18 AK3)', () => {
    expect(action({ key: 'Enter' }, marked)).toBe('pick');
    expect(action({ key: ',' }, marked)).toBe('pick');
    expect(action({ key: 'Enter' }, { expanded: true, active: 0 })).toBe('pick');
  });

  it('leaves a comma without a marked suggestion to the input, which splits the text', () => {
    expect(action({ key: ',' }, closed)).toBeNull();
    expect(action({ key: ',' }, open)).toBeNull();
    // A mark of a list that is no longer shown picks nothing.
    expect(action({ key: ',' }, { expanded: false, active: 1 })).toBeNull();
    expect(action({ key: 'Enter' }, { expanded: false, active: 1 })).toBe('add');
  });

  it('moves the mark with ArrowDown and ArrowUp only while suggestions are shown', () => {
    expect(action({ key: 'ArrowDown' }, open)).toBe('next');
    expect(action({ key: 'ArrowUp' }, open)).toBe('prev');
    expect(action({ key: 'ArrowDown' }, marked)).toBe('next');
    expect(action({ key: 'ArrowDown' }, closed)).toBeNull();
    expect(action({ key: 'ArrowUp' }, closed)).toBeNull();
  });

  it('closes the suggestions with Escape only while they are shown', () => {
    expect(action({ key: 'Escape' }, open)).toBe('close');
    expect(action({ key: 'Escape' }, marked)).toBe('close');
    expect(action({ key: 'Escape' }, closed)).toBeNull();
  });

  it.each([
    ['Ctrl+Enter', { ctrlKey: true }],
    ['Cmd+Enter', { metaKey: true }],
  ])('leaves %s to the form, which saves and adds the pending tag itself', (_, mods) => {
    expect(action({ key: 'Enter', ...mods }, closed)).toBeNull();
    expect(action({ key: 'Enter', ...mods }, marked)).toBeNull();
  });

  it('ignores every key while an input method composes', () => {
    for (const key of ['Enter', 'ArrowDown', 'ArrowUp', 'Escape', ',']) {
      expect(action({ key, isComposing: true }, marked), key).toBeNull();
    }
  });

  it('ignores other keys (typing, Tab, virtual keyboards)', () => {
    for (const key of ['a', 'Tab', ' ', 'Backspace', 'Home', 'Unidentified', 'Process']) {
      expect(action({ key }, marked), key).toBeNull();
    }
  });
});

describe("tag field keys: TagInput's onkeydown (F-17, F-18, NF-11)", () => {
  it('adds the typed tag on Enter without a mark and keeps the form from moving on', () => {
    const run = tagKeydown({ key: 'Enter' }, { pending: 'Kuchen', expanded: false });
    expect(run.add).toHaveBeenCalledWith('Kuchen');
    expect(run.pending).toBe('');
    expect(run.event.preventDefault).toHaveBeenCalled();
    // With suggestions shown but none marked, too: "veg" stays "veg" (F-18 AK3 „legt den Text … an“).
    const typed = tagKeydown({ key: 'Enter' }, { pending: 'veg' });
    expect(typed.add).toHaveBeenCalledWith('veg');
    expect(typed.pick).not.toHaveBeenCalled();
  });

  it('keeps Enter in an empty field from moving to the next field, adding nothing', () => {
    const run = tagKeydown({ key: 'Enter' }, { pending: '  ', expanded: false });
    expect(run.add).not.toHaveBeenCalled();
    expect(run.event.preventDefault).toHaveBeenCalled();
  });

  it('marks the suggestions in turn with ArrowDown and ArrowUp, wrapping around', () => {
    expect(tagKeydown({ key: 'ArrowDown' }).active).toBe(0);
    expect(tagKeydown({ key: 'ArrowDown' }, { active: 0 }).active).toBe(1);
    expect(tagKeydown({ key: 'ArrowDown' }, { active: 1 }).active).toBe(0);
    expect(tagKeydown({ key: 'ArrowUp' }).active).toBe(1);
    expect(tagKeydown({ key: 'ArrowUp' }, { active: 1 }).active).toBe(0);
    expect(tagKeydown({ key: 'ArrowUp' }, { active: 0 }).active).toBe(1);
    expect(tagKeydown({ key: 'ArrowDown' }).event.preventDefault).toHaveBeenCalled();
  });

  it('picks the marked suggestion with Enter or a comma and keeps the focus in the field', () => {
    for (const key of ['Enter', ',']) {
      const run = tagKeydown({ key }, { active: 1 });
      expect(run.pick, key).toHaveBeenCalledWith('Vegan', true);
      expect(run.add, key).not.toHaveBeenCalled();
      expect(run.event.preventDefault, key).toHaveBeenCalled();
    }
  });

  it('closes the suggestions on Escape and drops the mark', () => {
    const run = tagKeydown({ key: 'Escape' }, { active: 1 });
    expect(run).toMatchObject({ dismissed: true, active: -1, pending: 'veg' });
    expect(run.event.preventDefault).toHaveBeenCalled();
  });

  it.each([
    ['Ctrl+Enter', { ctrlKey: true }],
    ['Cmd+Enter', { metaKey: true }],
  ])('leaves %s to the form, which saves and adds the pending tag itself', (_, mods) => {
    const run = tagKeydown({ key: 'Enter', ...mods }, { pending: 'Kuchen', active: 1 });
    expect(run.pending).toBe('Kuchen');
    expect(run.add).not.toHaveBeenCalled();
    expect(run.pick).not.toHaveBeenCalled();
    expect(run.event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores Enter while an input method composes', () => {
    const run = tagKeydown({ key: 'Enter', isComposing: true }, { pending: 'Kuch', expanded: false });
    expect(run.pending).toBe('Kuch');
    expect(run.add).not.toHaveBeenCalled();
    expect(run.event.preventDefault).not.toHaveBeenCalled();
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
