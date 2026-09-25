<script lang="ts">
  // Chip input for tags (generator tagEditor(), F-17, F-18): Moonstone chips with a 44 px × button,
  // text field "Tag hinzufügen …". Enter or comma adds, duplicates by normalize() collapse, at most 20;
  // a typed spelling of a known tag shows its display name at once ("süßspeise" → "Süßspeise").
  // Removing is immediate with "Rückgängig" (F-35).
  // Autocomplete (F-18): the field is an ARIA combobox over the local tag list (state/tags.svelte.ts, one
  // GET /tags when the editor opens, never a request per key). Suggestions keep the server order (count
  // descending) and look like count chips ("Vegetarisch 12"). Nothing is marked until ArrowDown/ArrowUp,
  // so Enter adds the typed text; with a marked suggestion Enter or comma picks it (lib/editor.ts
  // tagKeyAction). Without typed text the artboard's „Häufig verwendet“ chips offer the most used tags;
  // on a new install the unused start tags fill them (F-20). Tapping a chip adds the tag without opening
  // the on-screen keyboard; the keyboard (Enter/Space on the chip) returns the focus to the field (NF-11).
  import { onMount } from 'svelte';
  import { LIMITS } from '../../../../shared/constants.ts';
  import { normalize } from '../../../../shared/normalize.ts';
  import { deEditor } from '../../i18n/de-editor.ts';
  import { addTags, tagKeyAction } from '../../lib/editor.ts';
  import { FREQUENT_TAGS, MAX_SUGGESTIONS, matchTags, tagKeys, tagNamesByKey } from '../../lib/tag-match.ts';
  import { tags as tagStore } from '../../state/tags.svelte.ts';
  import Icon from '../Icon.svelte';
  import FieldError from './FieldError.svelte';

  interface Props {
    tags: string[];
    /** Text typed but not yet added; commit() adds it (the editor calls it before saving). */
    pending?: string;
    inputId: string;
    /** Error from validation or the server (field "tags"). */
    error?: string | undefined;
    onundo: (message: string, undo: () => void) => void;
    /** Polite announcement through the editor's live region (a picked suggestion). */
    announce: (message: string) => void;
  }

  let {
    tags = $bindable(),
    pending = $bindable(''),
    inputId,
    error,
    onundo,
    announce,
  }: Props = $props();

  let message = $state<string | null>(null);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | null = $state(null);
  /** Marked suggestion (aria-activedescendant); -1 = none, so Enter adds the typed text. */
  let active = $state(-1);
  /** Escape closed the suggestions; typing opens them again. */
  let dismissed = $state(false);
  let focused = $state(false);

  const shown = $derived(message ?? error);
  const errorId = $derived(`${inputId}-error`);
  const hintId = $derived(`${inputId}-hint`);
  const listId = $derived(`${inputId}-list`);
  const captionId = $derived(`${inputId}-caption`);

  const chosen = $derived(new Set(tags.map((tag) => normalize(tag))));
  const full = $derived(tags.length >= LIMITS.tagsPerRecipe);
  /** The part after the last comma: what the suggestions complete. */
  const query = $derived(pending.slice(pending.lastIndexOf(',') + 1));
  const suggestions = $derived(
    full || dismissed || query.trim() === '' ? [] : matchTags(tagStore.list, query, chosen, MAX_SUGGESTIONS),
  );
  const expanded = $derived(focused && suggestions.length > 0);
  const frequent = $derived.by(() => {
    if (full || pending.trim() !== '') return [];
    const keys = tagKeys(tagStore.list);
    return tagStore.list.filter((_, i) => !chosen.has(keys[i] ?? '')).slice(0, FREQUENT_TAGS);
  });
  const canonical = $derived(tagNamesByKey(tagStore.list));

  /** Adds the comma-separated names of a text, or whole names (a tag name may contain a comma, F-17). */
  function add(text: string | readonly string[]): string[] {
    const result = addTags(tags, text, canonical);
    if (result.tags.length !== tags.length) tags = result.tags;
    message = result.error;
    return result.rejected;
  }

  /**
   * Adds the pending text; the editor calls this before saving. A suggestion marked in the open list is
   * what Ctrl/Cmd+Enter saves, not the typed fragment (F-18). Blur drops the mark first (onblur).
   */
  export function commit(): void {
    const marked = expanded ? suggestions[active] : undefined;
    if (marked) pick(marked.name, false);
    else if (pending.trim() !== '') pending = add(pending).join(', ');
  }

  /**
   * Adds a suggested or frequent tag, as one name even with a comma in it. Parts before the last comma
   * that could not be added stay in the field. `refocus`: back into the field (suggestions, keyboard
   * activation), not after a tap on a chip, which would open the on-screen keyboard.
   */
  function pick(name: string, refocus: boolean): void {
    const before = pending.slice(0, Math.max(pending.lastIndexOf(','), 0)).trim();
    const count = tags.length;
    pending = [before, ...add([name])].filter((part) => part !== '').join(', ');
    active = -1;
    if (tags.length > count) announce(deEditor.tags.added(name));
    if (refocus) input?.focus();
  }

  function onkeydown(event: KeyboardEvent): void {
    const action = tagKeyAction(event, expanded, active);
    if (action === null) return;
    event.preventDefault();
    const count = suggestions.length;
    if (action === 'next') active = (active + 1) % count;
    else if (action === 'prev') active = active <= 0 ? count - 1 : active - 1;
    else if (action === 'close') {
      dismissed = true;
      active = -1;
    } else if (action === 'pick') {
      const tag = suggestions[active];
      if (tag) pick(tag.name, true);
    } else if (pending.trim() !== '') pending = add(pending).join(', ');
  }

  function oninput(): void {
    active = -1;
    dismissed = false;
    if (!pending.includes(',')) {
      message = null;
      return;
    }
    const cut = pending.lastIndexOf(',');
    const rest = pending.slice(cut + 1).trimStart();
    const rejected = add(pending.slice(0, cut));
    pending = [...rejected, rest].filter((part) => part !== '').join(', ');
  }

  function onfocus(): void {
    focused = true;
    void tagStore.ensure();
  }

  function onblur(): void {
    focused = false;
    active = -1;
    commit();
  }

  /**
   * A press on the suggestions keeps the focus in the field, so blur does not add the typed fragment.
   * mousedown (also the one a tap produces) moves the focus; a cancelled pointerdown would cost the tap's
   * click in WebKit (iOS).
   */
  function keepFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  function remove(index: number): void {
    const tag = tags[index];
    if (tag === undefined) return;
    tags = tags.filter((_, i) => i !== index);
    message = null;
    input?.focus();
    onundo(deEditor.tags.removed(tag), () => {
      if (tags.includes(tag)) return;
      tags = [...tags.slice(0, index), tag, ...tags.slice(index)];
    });
  }

  // The list opens below the field: scroll it above the save bar and the keyboard (scroll-padding-bottom),
  // again whenever it changes, since a deleted letter can add a row of suggestions (NF-07). The field
  // comes first: where both do not fit (little height, e.g. a phone held sideways), it stays in view with
  // as much of the list below it as fits.
  $effect(() => {
    if (suggestions.length === 0) return;
    list?.scrollIntoView({ block: 'nearest' });
    input?.scrollIntoView({ block: 'nearest' });
  });

  onMount(() => {
    void tagStore.ensure();
  });
</script>

<div class={['box', { invalid: shown !== undefined && shown !== null }]}>
  {#each tags as tag, i (tag)}
    <span class="chip">
      <span class="name">{tag}</span>
      <button type="button" class="remove" aria-label={deEditor.tags.remove(tag)} onclick={() => remove(i)}>
        <Icon name="close" size={18} strokeWidth={2.4} />
      </button>
    </span>
  {/each}
  <input
    bind:this={input}
    bind:value={pending}
    id={inputId}
    class="tag-input"
    type="text"
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={expanded}
    aria-controls={listId}
    aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
    placeholder={deEditor.tags.placeholder}
    autocomplete="off"
    enterkeyhint="enter"
    aria-invalid={shown ? 'true' : undefined}
    aria-describedby={shown ? `${hintId} ${errorId}` : hintId}
    {onkeydown}
    {oninput}
    {onfocus}
    {onblur}
  />
</div>
<p id={hintId} class="visually-hidden">{deEditor.tags.hint}</p>
<!-- Errors of the add action (duplicate, limit) are announced; validation and server errors are not. -->
<FieldError id={errorId} message={shown ?? undefined} live={message !== null} />
{#if expanded}
  <p id={captionId} class="caption">{deEditor.tags.suggestions}</p>
  <ul
    bind:this={list}
    id={listId}
    class="choices"
    role="listbox"
    aria-labelledby={captionId}
    onmousedown={keepFocus}
  >
    {#each suggestions as tag, i (tag.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events (keys go through the combobox: aria-activedescendant) -->
      <li
        id="{listId}-{i}"
        class={['add', { active: i === active }]}
        role="option"
        tabindex="-1"
        aria-selected={i === active}
        aria-label={deEditor.tags.option(tag.name, tag.count)}
        onclick={() => pick(tag.name, true)}
      >
        <Icon name="plus" size={16} strokeWidth={2.4} />
        <span class="name">{tag.name}</span>
        <span class="count">{tag.count}</span>
      </li>
    {/each}
  </ul>
{:else if frequent.length > 0}
  <p id={captionId} class="caption">{deEditor.tags.frequent}</p>
  <div class="choices" role="group" aria-labelledby={captionId}>
    {#each frequent as tag (tag.id)}
      <button
        type="button"
        class="add"
        aria-label={deEditor.tags.add(tag.name)}
        onclick={(e) => pick(tag.name, e.detail === 0)}
      >
        <Icon name="plus" size={16} strokeWidth={2.4} />
        <span class="name">{tag.name}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .box {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-row);
    background: var(--color-input-bg);
  }

  /* The field's focus: 2 px text border plus focus ring (component sheet), on the whole box. */
  .box:focus-within {
    padding: 5.5px;
    border: 2px solid var(--color-text);
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .box.invalid {
    padding: 5.5px;
    border: 2px solid var(--color-primary-text);
  }

  .chip {
    height: 44px;
    display: flex;
    align-items: center;
    padding-left: 16px;
    border-radius: 22px;
    background: var(--color-secondary);
    color: var(--color-ink);
    font-size: var(--text-label);
    font-weight: 600;
    white-space: nowrap;
    max-width: 100%;
  }

  /* A long name (up to 40 characters, F-17) ends with "…" instead of widening the page (NF-08); the
     accessible names of the buttons carry the whole name. */
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .remove {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: var(--color-ink);
  }

  .remove:focus-visible {
    outline-color: var(--color-ink);
    outline-offset: -4px;
  }

  .tag-input {
    flex-grow: 1;
    min-width: 120px;
    height: 44px;
    padding: 0 8px;
    border: 0;
    background: transparent;
    color: var(--color-text);
    font-size: 1rem;
    outline: none;
    /* Scrolled into view (focus, the suggestions' effect), the box's border and focus ring show too. */
    scroll-margin-block: 12px;
  }

  /* „Häufig verwendet“ and „Vorschläge“ (artboard tagEditor(): 14 px, muted). */
  .caption {
    font-size: var(--text-meta);
    color: var(--color-text-muted);
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* Outline chip with a plus (artboard add()): 44 px, 1.5 px strong border, 15/600. */
  .add {
    height: 44px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 16px 0 12px;
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-chip);
    background: transparent;
    color: var(--color-text);
    font-size: var(--text-label);
    font-weight: 600;
    white-space: nowrap;
    max-width: 100%;
    cursor: pointer;
  }

  /* The marked suggestion carries the focus ring, not a color alone (NF-13). */
  .add.active {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .count {
    font-weight: 500;
  }
</style>
