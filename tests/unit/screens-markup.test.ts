// Markup and style guards for the M2 screens that have no component tests (Svelte components are not
// rendered in the unit tests): F-11 empty steps, focus order and initial focus (NF-11), live error
// messages, tap targets (NF-07) and the artboard layout rules they fixed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { df } from '../../client/src/i18n/de-screens-filter.ts';
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

describe('search row, count row and filter sheet (Kap. 6.3, F-21 to F-26)', () => {
  const search = markup('components/screens/SearchBar.svelte');

  it('is a search landmark with a search field of Kap. 6.3 (type, enter key, 200 characters, label)', () => {
    expect(search).toMatch(/<form class="search-row" role="search" \{onsubmit\}>/);
    const input = search.slice(search.indexOf('<input'), search.indexOf('/>', search.indexOf('<input')));
    expect(input).toContain('type="search"');
    expect(input).toContain('enterkeyhint="search"');
    // Longer text would not survive the URL (list-query.ts cuts q to LIMITS.query).
    expect(input).toContain('maxlength={LIMITS.query}');
    expect(input).toContain('aria-label={ds.list.search}');
    expect(input).toContain('placeholder={ds.list.searchPlaceholder}');
    expect(rule('components/screens/SearchBar.svelte', 'input')).toMatch(/font-size:\s*1rem/);
  });

  it('names the filter button with the number of active filters and marks it as opening a dialog', () => {
    const button = search.slice(search.indexOf('class="filter"'), search.indexOf('</button>'));
    expect(button).toContain('aria-label={ds.list.filter(filterCount)}');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded={expanded}');
    expect(button).toMatch(/<span class="badge" aria-hidden="true">\{filterCount\}<\/span>/);
  });

  it('keeps the search row in view below the offline banner (Kap. 6.3 „fixiertes Suchfeld“, NF-08)', () => {
    const row = rule('components/screens/SearchBar.svelte', '.search-row');
    expect(row).toMatch(/position:\s*sticky/);
    expect(row).toMatch(/top:\s*var\(--banner-h, 0px\)/);
    // Focused cards scroll below it, not behind it (NF-11).
    expect(read('routes/RecipeList.svelte')).toMatch(
      /:global\(html:has\(\.search-row\)\),\s*:global\(\.list-pane:has\(\.search-row\)\)\s*\{\s*scroll-padding-top:\s*calc\(var\(--banner-h, 0px\) \+ var\(--safe-top\) \+ 72px\);/,
    );
  });

  it('announces only the count text, not the sort button next to it', () => {
    const list = markup('routes/RecipeList.svelte');
    const open = '<p bind:this={countLine} class="count" aria-live="polite" tabindex="-1">';
    const start = list.indexOf(open);
    expect(start).toBeGreaterThan(-1);
    const region = list.slice(start + open.length, list.indexOf('</p>', start));
    expect(region).not.toContain('<');
    expect(region).toContain('ds.list.countOf(total, totalAll)');
    expect(list.slice(list.indexOf('</p>', start))).toMatch(/^<\/p>\s*<Button/);
  });

  it('reads the unfiltered total of list snapshots from before M4 as their total (amendment 22)', () => {
    const list = read('routes/RecipeList.svelte');
    expect(list).toContain('saved ? (saved.totalAll ?? saved.total) : 0');
    expect(list).toContain('totalAll = data.totalAll ?? data.total;');
    expect(list).toContain('show(snapshot, filter);');
  });

  it('keys the chip row by tag id and switches a chip tapped in the row in place (F-24, NF-07)', () => {
    const row = markup('components/screens/TagChipRow.svelte');
    // Sorted by the active tags of the last state from outside the row; each chip shows the current state.
    expect(row).toMatch(/\{#each chipRow\(list, basis\) as chip \(chip\.tag\.id\)\}/);
    expect(row).toContain('active={active.includes(chip.tag.id)}');
    const script = read('components/screens/TagChipRow.svelte');
    // Kept while the active tags are, by value, the ones the row made (a recipe opened next to the list
    // parses the same tags into a new array).
    expect(script).toContain(
      'kept && kept.after === active.join() && kept.list === list ? kept.basis : active',
    );
    expect(script).toMatch(
      /const from = basis;\s*ontoggle\(id\);[\s\S]{0,120}kept = \{ basis: from, after: active\.join\(\), list \};/,
    );
    // A new order from elsewhere starts the row at its beginning, where the active tags are.
    expect(script).toMatch(/const lead = \$derived\(basis\.join\(\)\);/);
    expect(script).toMatch(/\$effect\(\(\) => \{\s*void lead;\s*if \(row\) row\.scrollLeft = 0;\s*\}\);/);
    expect(row).toContain('<div bind:this={row} class="chips" role="group"');
  });

  it('puts the focus after the empty result into the search field by key, on the count line by tap (NF-11)', () => {
    expect(read('routes/RecipeList.svelte')).toMatch(
      /if \(event\.detail === 0\) searchBar\?\.focus\(\);\s*else countLine\?\.focus\(\{ preventScroll: true \}\);/,
    );
    const noHits = markup('components/screens/NoHits.svelte');
    expect(noHits).toContain('onclick={(event) => onsuggest(suggestion, event)}');
    expect(noHits).toContain('onclick={onreset}');
  });

  it('opens the filter sheet from „Alle Tags …“ on the heading of the tags, not in their search field (NF-11)', () => {
    expect(read('components/screens/FilterSheet.svelte')).toContain(
      "else if (focus === 'tags') tagsLabel?.focus();",
    );
    expect(markup('components/screens/FilterSheet.svelte')).toContain(
      '<p bind:this={tagsLabel} id="{id}-tags" class="label" tabindex="-1">{df.tags}</p>',
    );
  });

  it('offers no favourites, minimum rating or rating sorts in the filter sheet before M5 (F-25, F-43, F-44)', () => {
    const sheet = read('components/screens/FilterSheet.svelte');
    const texts = JSON.stringify(df);
    for (const word of ['Favorit', 'Bewertung', 'Mindest', 'Zuletzt geändert']) {
      expect(texts, word).not.toContain(word);
      expect(markup('components/screens/FilterSheet.svelte'), word).not.toContain(word);
    }
    expect(sheet).not.toMatch(/role="switch"|minRating|fav\b|'rating'|'myRating'|'updated'/);
    // The sort options are those of F-26 only.
    expect(sheet).toMatch(/\['relevance', 'newest', 'title'\] : \['newest', 'title'\]/);
  });

  it('gives the filter sheet its own close label and the side panel the artboard values (tabletFilter)', () => {
    const sheet = read('components/Sheet.svelte');
    expect(sheet).toMatch(/closeLabel = de\.common\.close/);
    expect(markup('components/Sheet.svelte')).toContain(
      '<IconButton icon="close" label={closeLabel} onclick={onclose} />',
    );
    expect(markup('components/screens/FilterSheet.svelte')).toContain('closeLabel={df.close}');
    const panel = rule('components/Sheet.svelte', '.sheet.side');
    expect(panel).toMatch(/inset:\s*56px auto auto calc\(404px \+ var\(--safe-left\)\)/);
    expect(panel).toMatch(/width:\s*400px/);
    const surface = rule('components/Sheet.svelte', '.side .panel');
    expect(surface).toMatch(/gap:\s*12px/);
    expect(surface).toMatch(/padding:\s*16px 20px 12px/);
    expect(surface).toMatch(/box-shadow:\s*0 16px 40px var\(--color-shadow\)/);
    expect(rule('components/Sheet.svelte', '.side .body')).toMatch(/gap:\s*12px/);
    expect(rule('components/Sheet.svelte', '.sheet.side::backdrop')).toMatch(/background:\s*transparent/);
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
