// Markup and style guards for the M2 screens that have no component tests (Svelte components are not
// rendered in the unit tests): F-11 empty steps, focus order and initial focus (NF-11), live error
// messages, tap targets (NF-07) and the artboard layout rules they fixed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dl } from '../../client/src/i18n/de-screens-lazy.ts';

const SRC = fileURLToPath(new URL('../../client/src/', import.meta.url));

function read(file: string): string {
  return fs.readFileSync(path.join(SRC, file), 'utf8');
}

/** Markup without script, style and comments. */
function markup(file: string): string {
  return read(file)
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** Declarations of the first CSS rule with exactly this selector in the component's <style>. */
function rule(file: string, selector: string): string {
  const css = /<style>([\s\S]*?)<\/style>/.exec(read(file))?.[1] ?? '';
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (body === undefined) throw new Error(`${file}: no rule "${selector}"`);
  return body;
}

describe('recipe detail (F-11, F-29)', () => {
  const body = markup('components/screens/DetailBody.svelte');

  it('shows "Noch keine Zubereitung erfasst" with a link to the editor when there are no steps', () => {
    expect(dl.detail.stepsEmpty).toBe('Noch keine Zubereitung erfasst');
    // The steps section is always there; only its content depends on the steps.
    expect(body.indexOf('<section class="steps"')).toBeGreaterThan(-1);
    expect(body.indexOf('{#if recipe.steps.length > 0}')).toBeGreaterThan(
      body.indexOf('<section class="steps"'),
    );
    expect(body).not.toMatch(/\{#if[^}]*recipe\.steps\.length[^}]*\}\s*<div class="columns">/);
    const empty = body.slice(body.indexOf('{:else}', body.indexOf('<section class="steps"')));
    expect(empty).toContain('{dl.detail.stepsEmpty}');
    expect(empty).toContain('href={paths.recipeEdit(recipe.id)}');
  });

  it('hyphenates tile labels instead of breaking them anywhere ("Vorbereitun|g")', () => {
    const label = rule('components/screens/DetailBody.svelte', '.fact dt');
    expect(label).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(label).toMatch(/hyphens:\s*auto/);
  });

  it('gives the source link a 44 px tap target (NF-07)', () => {
    expect(rule('components/screens/DetailBody.svelte', '.source a')).toMatch(/min-height:\s*44px/);
  });

  it('limits the description to about 70 characters per line (Kap. 6.7)', () => {
    // 70 characters of German body text in Figtree measure 32.8 em; "ch" is the wider "0" (0.64 em).
    const max = /max-width:\s*([\d.]+)em/.exec(rule('routes/RecipeDetail.svelte', '.description'))?.[1];
    expect(Number(max)).toBeGreaterThanOrEqual(30);
    expect(Number(max)).toBeLessThanOrEqual(34);
  });

  it('puts the back button first in the focus order of the photo area (NF-11)', () => {
    const detail = markup('routes/RecipeDetail.svelte');
    const hero = detail.slice(detail.indexOf('<div class="hero">'));
    expect(hero.indexOf('class="overlay start"')).toBeGreaterThan(-1);
    expect(hero.indexOf('class="overlay start"')).toBeLessThan(hero.indexOf('<RecipeMedia'));
    expect(hero.indexOf('class="overlay end"')).toBeLessThan(hero.indexOf('<RecipeMedia'));
    // Before the photo in the DOM, the buttons need a z-index to stay above it.
    expect(rule('routes/RecipeDetail.svelte', '.overlay')).toMatch(/z-index:\s*1/);
  });

  it('keeps "Foto hinzufügen" clear of the content sheet that overlaps the photo by 32 px', () => {
    expect(rule('components/PlaceholderImage.svelte', '.add')).toMatch(
      /bottom:\s*var\(--add-photo-bottom,\s*20px\)/,
    );
    const offset = /--add-photo-bottom:\s*(\d+)px/.exec(rule('routes/RecipeDetail.svelte', '.hero'))?.[1];
    expect(Number(offset)).toBeGreaterThanOrEqual(32 + 20);
    expect(rule('routes/RecipeDetail.svelte', '.content')).toMatch(/margin-top:\s*-32px/);
  });
});

describe('recipe list (artboard TabletQuer)', () => {
  it('clamps compact row titles to two lines', () => {
    const title = rule('components/CompactRow.svelte', '.title');
    expect(title).toMatch(/-webkit-line-clamp:\s*2/);
    expect(title).toMatch(/overflow:\s*hidden/);
  });
});

describe('dialogs and error messages (NF-11)', () => {
  it('start irreversible confirmations on "Abbrechen"', () => {
    expect(read('components/Dialog.svelte')).toMatch(/initialFocus\?: 'first' \| 'cancel'/);
    const trash = markup('routes/Trash.svelte');
    const dialog = trash.slice(trash.indexOf('<Dialog'));
    expect(dialog.slice(0, dialog.indexOf('>'))).toMatch(/initialFocus="cancel"/);
    // "Abbrechen" is the last action, which initialFocus="cancel" focuses.
    const actions = dialog.slice(dialog.indexOf('{#snippet actions()}'), dialog.indexOf('{/snippet}'));
    expect(actions.trim().split('\n').at(-1)).toContain('de.common.cancel');
  });

  it('announce server errors of the profile form at once', () => {
    expect(markup('components/screens/ProfileForm.svelte')).toMatch(
      /<p id="\{id\}-error" class="error" role="alert">/,
    );
  });

  it('announce tag errors raised by adding a tag', () => {
    expect(read('components/editor/FieldError.svelte')).toMatch(/role=\{live \? 'alert' : undefined\}/);
    expect(markup('components/editor/TagInput.svelte')).toMatch(/<FieldError[^>]*live=\{message !== null\}/);
  });
});
