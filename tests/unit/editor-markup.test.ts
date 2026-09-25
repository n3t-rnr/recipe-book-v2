// Behavior of the editor's photo section and tag field that lives in Svelte components, which the unit
// tests do not render: the jump to the first error skips the photo hints (NF-11), a running or repeatable
// upload guards leaving like an unsaved change (F-14, F-09), "Erneut hochladen" hands the focus on and the
// upload is announced (NF-11), and the tag field is an ARIA combobox over the local tag list (F-18, NF-11).
// firstError is tested directly, pick() runs with stand-ins; the wiring is checked in the sources. The
// browser checks: tests/e2e/tag-input.spec.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { deEditor } from '../../client/src/i18n/de-editor.ts';
import { firstError, PHOTO_SECTION } from '../../client/src/lib/editor.ts';

const SRC = fileURLToPath(new URL('../../client/src/', import.meta.url));
const EDITOR = read('routes/RecipeEdit.svelte');
const PICKER = read('components/editor/ImagePicker.svelte');
const TAGS = read('components/editor/TagInput.svelte');

function read(file: string): string {
  return fs.readFileSync(path.join(SRC, file), 'utf8');
}

/** Markup without script, style and comments. */
function markup(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

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

/** A stand-in for an element: `closest` finds the photo section when it is inside one. */
function element(name: string, inPhoto: boolean): { name: string; closest(selector: string): object | null } {
  return { name, closest: (selector) => (inPhoto && selector === PHOTO_SECTION ? {} : null) };
}

describe('jump to the first error on save (NF-11)', () => {
  it('skips the hints of the photo section, which comes first in the form', () => {
    const candidates = [element('photo notice', true), element('title', false), element('tag error', false)];
    expect(firstError(candidates)?.name).toBe('title');
  });

  it('finds nothing when only photo hints are shown', () => {
    expect(firstError([element('failed upload', true), element('photo notice', true)])).toBeUndefined();
    expect(firstError([])).toBeUndefined();
  });

  it('marks the whole photo section, so every hint in it is skipped', () => {
    expect(PHOTO_SECTION).toBe('[data-photo]');
    const picker = markup(PICKER);
    expect(picker).toMatch(/^<div class="picker"[^>]*\sdata-photo[\s>]/);
    // The root wraps all of the section: its closing tag ends the markup.
    expect(picker.endsWith('</div>')).toBe(true);
    expect(picker.indexOf('<FieldError')).toBeGreaterThan(0);
  });

  it('is what showErrors scrolls to and focuses', () => {
    const showErrors = body(EDITOR, 'showErrors');
    expect(showErrors).toMatch(/const target = firstError\(\s*formEl\?\.querySelectorAll/);
    expect(showErrors).not.toMatch(/querySelector</);
  });
});

describe('a photo that is not in the form yet guards leaving (F-14, F-09)', () => {
  it('is reported by the picker while it uploads or can be sent again', () => {
    expect(PICKER).toMatch(/unsaved = \$bindable\(false\)/);
    expect(PICKER).toMatch(/unsaved = photoPending\(phase, retryable\)/);
  });

  it('asks before Abbrechen, the back gesture and links, like an unsaved change', () => {
    expect(EDITOR).toMatch(/bind:unsaved=\{photoUnsaved\}/);
    expect(EDITOR).toMatch(/const mustAsk = \$derived\(dirty \|\| photoUnsaved\)/);
    expect(body(EDITOR, 'requestLeave')).toMatch(/if \(mustAsk\)/);
    expect(body(EDITOR, 'onGuardClosed')).toMatch(/if \(mustAsk\)/);
    expect(body(EDITOR, 'interceptLinks')).toMatch(/!mustAsk/);
    expect(EDITOR).toMatch(/const needed = mustAsk && /);
    for (const name of ['requestLeave', 'onGuardClosed', 'interceptLinks']) {
      expect(body(EDITOR, name), name).not.toMatch(/\bdirty\b/);
    }
  });

  it('writes no draft for an upload alone: autosave follows the form only', () => {
    const autosave = body(EDITOR, 'autosave');
    expect(autosave).toMatch(/if \(!dirty\)/);
    expect(autosave).not.toMatch(/mustAsk|photoUnsaved/);
  });
});

describe('"Erneut hochladen" and upload status (NF-11)', () => {
  it('moves the focus to "Foto aufnehmen" once the retry button is gone', () => {
    const retry = body(PICKER, 'retry');
    expect(retry.indexOf('upload(')).toBeGreaterThan(-1);
    expect(retry).toMatch(/tick\(\)\.then\(\(\) => takeButton\?\.focus\(\)\)/);
    expect(retry.indexOf('takeButton')).toBeGreaterThan(retry.indexOf('upload('));
    // The retry button only exists while the upload has failed; "Foto aufnehmen" always.
    const picker = markup(PICKER);
    expect(picker).toMatch(/\{#if phase === 'failed'\}[\s\S]*onclick=\{retry\}[\s\S]*\{\/if\}/);
    expect(picker).toMatch(/bind:element=\{takeButton\}/);
  });

  it('announces start and processing politely through the editor, the result as before', () => {
    expect(body(PICKER, 'upload')).toMatch(/announce\(deEditor\.photo\.sending\)/);
    expect(body(PICKER, 'send')).toMatch(/announce\(deEditor\.photo\.processingPhoto\)/);
    expect(body(PICKER, 'send')).toMatch(/announce\(deEditor\.photo\.uploaded\)/);
    // The editor's live region is polite; percentages stay in the progress bar (not read out each step).
    expect(markup(EDITOR)).toMatch(/<p class="visually-hidden" aria-live="polite">\{announcement\}<\/p>/);
    expect(deEditor.photo.sending).toBe('Foto wird hochgeladen …');
    expect(deEditor.photo.processingPhoto).toBe('Foto wird verarbeitet …');
  });
});

/** The opening tag `<name …>` that contains `marker`; a `>` inside `{…}` or quotes does not end it. */
function openingTag(source: string, name: string, marker: string): string {
  const html = markup(source);
  for (const match of html.matchAll(new RegExp(`<${name}\\b`, 'g'))) {
    let depth = 0;
    let quote = '';
    for (let i = match.index; i < html.length; i++) {
      const ch = html[i] ?? '';
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (depth === 0 && (ch === '"' || ch === "'")) quote = ch;
      else if (depth === 0 && ch === '>') {
        const tag = html.slice(match.index, i + 1);
        if (tag.includes(marker)) return tag;
        break;
      }
    }
  }
  throw new Error(`no <${name}> with ${marker}`);
}

describe('the tag field is a combobox over the local tag list (F-18, NF-11)', () => {
  it('announces itself as a combobox with a list, its state and the marked suggestion', () => {
    const input = openingTag(TAGS, 'input', 'class="tag-input"');
    expect(input).toMatch(/role="combobox"/);
    expect(input).toMatch(/aria-autocomplete="list"/);
    expect(input).toMatch(/aria-expanded=\{expanded\}/);
    expect(input).toMatch(/aria-controls=\{listId\}/);
    expect(input).toMatch(
      /aria-activedescendant=\{expanded && active >= 0 \? `\$\{listId\}-\$\{active\}` : undefined\}/,
    );
    expect(TAGS).toMatch(/const expanded = \$derived\(focused && suggestions\.length > 0\)/);
  });

  it('shows the suggestions as a labelled listbox whose options carry the ids the field points to', () => {
    const list = openingTag(TAGS, 'ul', 'role="listbox"');
    expect(list).toMatch(/id=\{listId\}/);
    expect(list).toMatch(/aria-labelledby=\{captionId\}/);
    const option = openingTag(TAGS, 'li', 'role="option"');
    expect(option).toMatch(/id="\{listId\}-\{i\}"/);
    expect(option).toMatch(/aria-selected=\{i === active\}/);
    expect(option).toMatch(/aria-label=\{deEditor\.tags\.option\(tag\.name, tag\.count\)\}/);
    expect(option).toMatch(/onclick=\{\(\) => pick\(tag\.name, true\)\}/);
    // The marked option shows the focus ring, not a color alone (NF-13).
    expect(TAGS).toMatch(
      /\.add\.active \{\s*outline: 2px solid var\(--color-focus\);\s*outline-offset: 2px;/,
    );
  });

  it('keeps the focus in the field while a suggestion is pressed, so blur does not add the fragment', () => {
    const list = openingTag(TAGS, 'ul', 'role="listbox"');
    expect(list).toMatch(/onmousedown=\{keepFocus\}/);
    // Not pointerdown: cancelling it drops the click of a tap in WebKit (iOS), so a tap would pick nothing.
    expect(list).not.toMatch(/onpointerdown/);
    expect(body(TAGS, 'keepFocus').trim()).toBe('event.preventDefault();');
    expect(body(TAGS, 'onblur')).toMatch(/commit\(\)/);
  });

  it('offers „Häufig verwendet“ as a labelled group of buttons; a tap does not open the keyboard', () => {
    const group = openingTag(TAGS, 'div', 'role="group"');
    expect(group).toMatch(/aria-labelledby=\{captionId\}/);
    const chip = openingTag(TAGS, 'button', 'class="add"');
    expect(chip).toMatch(/aria-label=\{deEditor\.tags\.add\(tag\.name\)\}/);
    // A click from the keyboard has detail 0: only then the focus returns to the field.
    expect(chip).toMatch(/onclick=\{\(e\) => pick\(tag\.name, e\.detail === 0\)\}/);
    expect(TAGS).toMatch(/if \(full \|\| pending\.trim\(\) !== ''\) return \[\];/);
    expect(TAGS).toMatch(/\.slice\(0, FREQUENT_TAGS\)/);
  });

  it('asks the server once when the editor opens and on focus, never while typing (F-18 AK3)', () => {
    expect(body(TAGS, 'onfocus')).toMatch(/void tagStore\.ensure\(\);/);
    const mount = TAGS.slice(TAGS.indexOf('onMount(() => {'));
    expect(mount).toMatch(/^onMount\(\(\) => \{\s*void tagStore\.ensure\(\);/);
    for (const name of ['oninput', 'onkeydown', 'add', 'pick']) {
      expect(body(TAGS, name), name).not.toMatch(/tagStore|get\(|fetch/);
    }
    expect(TAGS).not.toMatch(/tagStore\.load\(/);
    expect(TAGS).toMatch(/matchTags\(tagStore\.list, query, chosen, MAX_SUGGESTIONS\)/);
  });

  it('keeps the error announcement of the add action and the hint in the description', () => {
    expect(markup(TAGS)).toMatch(/<FieldError[^>]*live=\{message !== null\}/);
    expect(openingTag(TAGS, 'input', 'class="tag-input"')).toMatch(
      /aria-describedby=\{shown \? `\$\{hintId\} \$\{errorId\}` : hintId\}/,
    );
  });

  it('scrolls the list above the save bar whenever it changes, the field first (NF-07)', () => {
    // An $effect that reads the suggestions reruns when they change (a deleted letter can add rows); the
    // field is scrolled last, so where both do not fit, the field wins. The browser: tag-input.spec.ts.
    const effect = /\$effect\(\(\) => \{([\s\S]*?)\n {2}\}\);/.exec(TAGS)?.[1] ?? '';
    expect(effect).toMatch(
      /if \(suggestions\.length === 0\) return;\s*list\?\.scrollIntoView\(\{ block: 'nearest' \}\);\s*input\?\.scrollIntoView\(\{ block: 'nearest' \}\);/,
    );
    // The box's border and focus ring (5.5 + 2 + 2 + 2 px around the input) come along into view.
    expect(TAGS).toMatch(/\.tag-input \{[^}]*scroll-margin-block: 12px;/);
  });
});

type PickRun = (
  state: { pending: string; tags: string[]; active: number },
  add: (names: readonly string[]) => string[],
  announce: (message: string) => void,
  input: { focus: () => void },
  texts: typeof deEditor,
  name: string,
  refocus: boolean,
) => { pending: string; active: number };

/** TagInput's pick() with its state as parameters; returns the state afterwards. */
const pickRaw = new Function(
  'state',
  'add',
  'announce',
  'input',
  'deEditor',
  'name',
  'refocus',
  `let { pending, tags, active } = state;
  (() => {${body(TAGS, 'pick')}})();
  return { pending, active };`,
) as PickRun;

function pick(pending: string, name: string, refocus: boolean, accept = true) {
  const tags = ['Schwäbisch'];
  const add = vi.fn((names: readonly string[]): string[] => {
    if (!accept) return [...names];
    tags.push(...names);
    return [];
  });
  const announce = vi.fn();
  const input = { focus: vi.fn() };
  const after = pickRaw({ pending, tags, active: 1 }, add, announce, input, deEditor, name, refocus);
  return { ...after, tags, add, announce, focus: input.focus };
}

describe('picking a suggestion or a frequent tag (F-18, NF-11)', () => {
  it('adds the tag, clears the typed fragment, drops the mark and announces it politely', () => {
    const run = pick('veg', 'Vegetarisch', true);
    // As one whole name, not split at a comma (see the next test).
    expect(run.add).toHaveBeenCalledWith(['Vegetarisch']);
    expect(run).toMatchObject({ pending: '', active: -1, tags: ['Schwäbisch', 'Vegetarisch'] });
    expect(run.announce).toHaveBeenCalledWith('Tag „Vegetarisch“ hinzugefügt');
    expect(run.focus).toHaveBeenCalledOnce();
  });

  it('adds a tag with a comma in its name as one tag (F-17 allows punctuation)', () => {
    const run = pick('salz', 'Salz, Pfeffer', true);
    expect(run.add).toHaveBeenCalledWith(['Salz, Pfeffer']);
    expect(run).toMatchObject({ pending: '', tags: ['Schwäbisch', 'Salz, Pfeffer'] });
    expect(run.announce).toHaveBeenCalledWith('Tag „Salz, Pfeffer“ hinzugefügt');
  });

  it('keeps the parts before the last comma that could not be added', () => {
    const long = 'x'.repeat(41);
    expect(pick(`${long}, veg`, 'Vegetarisch', true).pending).toBe(long);
    expect(pick(`${long}, zu viel, su`, 'Süßspeise', true).pending).toBe(`${long}, zu viel`);
  });

  it('leaves the focus where it is after a tap on a chip (no on-screen keyboard)', () => {
    const run = pick('', 'Schnell', false);
    expect(run.tags).toContain('Schnell');
    expect(run.focus).not.toHaveBeenCalled();
  });

  it('announces nothing when the tag could not be added', () => {
    const run = pick('', 'Schnell', true, false);
    expect(run.announce).not.toHaveBeenCalled();
    expect(run.pending).toBe('Schnell');
  });
});

describe('the editor saves the typed tag through TagInput (F-17, F-18)', () => {
  it('binds the tag input and commits it before the form is copied for saving', () => {
    const tagInput = openingTag(EDITOR, 'TagInput', 'bind:tags');
    expect(tagInput).toMatch(/bind:this=\{tagInput\}/);
    expect(tagInput).toMatch(/\{announce\}/);
    const save = body(EDITOR, 'save');
    expect(save.indexOf('tagInput?.commit();')).toBeGreaterThan(-1);
    expect(save.indexOf('tagInput?.commit();')).toBeLessThan(save.indexOf('const sent = cloneForm(form);'));
    expect(body(TAGS, 'commit')).toMatch(
      /if \(pending\.trim\(\) !== ''\) pending = add\(pending\)\.join\(', '\);/,
    );
    expect(TAGS).toMatch(/export function commit\(\): void/);
  });

  it('adds tags only in TagInput, with the display names of the known tags', () => {
    expect(EDITOR).not.toMatch(/\baddTags\b|pendingTag/);
    expect(body(TAGS, 'add')).toMatch(/addTags\(tags, text, canonical\)/);
    expect(TAGS).toMatch(/const canonical = \$derived\(tagNamesByKey\(tagStore\.list\)\)/);
  });
});

type CommitRun = (
  state: { pending: string; expanded: boolean; active: number; suggestions: Array<{ name: string }> },
  add: (text: string) => string[],
  pick: (name: string, refocus: boolean) => void,
) => { pending: string };

/** TagInput's commit() with its state as parameters; returns the pending text afterwards. */
const commitRaw = new Function(
  'state',
  'add',
  'pick',
  `let { pending, expanded, active, suggestions } = state;
  (() => {${body(TAGS, 'commit')}})();
  return { pending };`,
) as CommitRun;

function commit(state: Partial<Parameters<CommitRun>[0]>, rejected: string[] = []) {
  const add = vi.fn((): string[] => rejected);
  const pick = vi.fn();
  const suggestions = [{ name: 'Vegan' }, { name: 'Vegetarisch' }];
  const after = commitRaw({ pending: 'veg', expanded: true, active: -1, suggestions, ...state }, add, pick);
  return { ...after, add, pick };
}

describe('commit(): what saving takes from the tag field (F-17, F-18)', () => {
  it('takes the marked suggestion, not the typed fragment (Ctrl/Cmd+Enter with a marked suggestion)', () => {
    const run = commit({ active: 1 });
    expect(run.pick).toHaveBeenCalledWith('Vegetarisch', false);
    expect(run.add).not.toHaveBeenCalled();
  });

  it('adds the typed text when nothing is marked, or the list is closed (blur drops the mark first)', () => {
    for (const state of [{ active: -1 }, { active: 1, expanded: false }]) {
      const run = commit(state, ['zu lang']);
      expect(run.pick, JSON.stringify(state)).not.toHaveBeenCalled();
      expect(run.add, JSON.stringify(state)).toHaveBeenCalledWith('veg');
      expect(run.pending, JSON.stringify(state)).toBe('zu lang');
    }
    expect(commit({ pending: '  ', expanded: false }).add).not.toHaveBeenCalled();
    // onblur: the field is left, so the mark goes before commit() runs.
    expect(body(TAGS, 'onblur')).toMatch(/focused = false;\s*active = -1;\s*commit\(\);/);
  });
});
