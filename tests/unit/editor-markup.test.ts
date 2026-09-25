// Behavior of the editor's photo section that lives in Svelte components, which the unit tests do not
// render: the jump to the first error skips the photo hints (NF-11), a running or repeatable upload guards
// leaving like an unsaved change (F-14, F-09), and "Erneut hochladen" hands the focus on and the upload
// is announced (NF-11). firstError is tested directly; the wiring is checked in the sources.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deEditor } from '../../client/src/i18n/de-editor.ts';
import { firstError, PHOTO_SECTION } from '../../client/src/lib/editor.ts';

const SRC = fileURLToPath(new URL('../../client/src/', import.meta.url));
const EDITOR = read('routes/RecipeEdit.svelte');
const PICKER = read('components/editor/ImagePicker.svelte');

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
