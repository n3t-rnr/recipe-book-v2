<script lang="ts">
  // Search row of the list (generator searchRow(); Kap. 6.3 „fixiertes Suchfeld (type="search",
  // enterkeyhint="search", Platzhalter „Rezepte, Zutaten, Tags suchen“, Löschen-Icon) … Rechts neben dem
  // Suchfeld das Filtersymbol mit Zähler“). It sticks below the header, or below the offline banner
  // (--banner-h, AppShell). F-21: the text goes to the URL 150 ms after the last key (the list searches from
  // 2 characters); Enter and the clear icon apply at once. The text typed stays as typed, so the caret
  // never jumps; only a change from elsewhere (Back, „Filter zurücksetzen“, „Meintest du“) replaces it.
  import { untrack } from 'svelte';
  import { LIMITS } from '../../../../shared/constants.ts';
  import { ds } from '../../i18n/de-screens.ts';
  import { SEARCH_DEBOUNCE_MS } from '../../lib/list-query.ts';
  import Icon from '../Icon.svelte';
  import IconButton from '../IconButton.svelte';

  interface Props {
    /** Search text of the URL (q). */
    value: string;
    /** Active filters: the number on the filter button (F-24 AK2). */
    filterCount: number;
    /** The filter sheet is open. */
    expanded: boolean;
    onsearch: (q: string) => void;
    onfilter: () => void;
    /** Early signal of a tap on the filter button: preload the sheet. */
    onintent: () => void;
  }

  let { value, filterCount, expanded, onsearch, onfilter, onintent }: Props = $props();

  let text = $state(untrack(() => value));
  let input: HTMLInputElement | undefined = $state();
  /** Text last handed to onsearch (or taken from the URL). */
  let emitted = untrack(() => value);
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const next = value;
    untrack(() => {
      if (next.trim() === emitted.trim()) return;
      clearTimeout(timer);
      text = next;
      emitted = next;
    });
  });

  $effect(() => () => clearTimeout(timer));

  function emit(q: string): void {
    clearTimeout(timer);
    emitted = q;
    onsearch(q);
  }

  // No bind:value: its runtime would be the only one in the entry chunk (NF-01).
  function oninput(event: Event & { currentTarget: HTMLInputElement }): void {
    text = event.currentTarget.value;
    clearTimeout(timer);
    timer = setTimeout(() => emit(text), SEARCH_DEBOUNCE_MS);
  }

  function onsubmit(event: SubmitEvent): void {
    event.preventDefault();
    emit(text);
    // Closes the on-screen keyboard, so the results are visible.
    input?.blur();
  }

  function clear(): void {
    text = '';
    emit('');
    input?.focus();
  }

  /** Focuses the search field (key "/", Kap. 6.4; „Filter zurücksetzen“, „Meintest du“ by keyboard). */
  export function focus(): void {
    input?.focus();
  }
</script>

<form class="search-row" role="search" {onsubmit}>
  <div class={['field', { clearable: text !== '' }]}>
    <label class="input">
      <Icon name="search" size={22} />
      <input
        bind:this={input}
        value={text}
        type="search"
        aria-label={ds.list.search}
        placeholder={ds.list.searchPlaceholder}
        enterkeyhint="search"
        autocomplete="off"
        spellcheck="false"
        maxlength={LIMITS.query}
        {oninput}
      />
    </label>
    {#if text !== ''}
      <IconButton icon="close" label={ds.list.clearSearch} iconSize={22} onclick={clear} />
    {/if}
  </div>
  <button
    type="button"
    class="filter"
    aria-label={ds.list.filter(filterCount)}
    aria-haspopup="dialog"
    aria-expanded={expanded}
    onpointerdown={onintent}
    onclick={onfilter}
  >
    <Icon name="filter" size={24} />
    {#if filterCount > 0}<span class="badge" aria-hidden="true">{filterCount}</span>{/if}
  </button>
</form>

<style>
  /* 12 px 20 px 0 (tablet portrait 12 px 24 px 0 20 px, list column 12 px 16 px 0 20 px). Sticky: the band
     above the field covers the iOS status bar in standalone mode (--safe-top) without moving the field. */
  .search-row {
    position: sticky;
    top: var(--banner-h, 0px);
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: calc(-1 * var(--safe-top));
    padding: calc(12px + var(--safe-top)) 20px 0;
    background: var(--color-bg);
  }

  @media (min-width: 600px) {
    .search-row {
      padding-right: 24px;
    }
  }

  @media (min-width: 1024px) {
    .search-row {
      padding-right: 16px;
    }
  }

  .field {
    flex: 1;
    min-width: 0;
    height: 52px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 18px;
    border: 1.5px solid var(--color-border-strong);
    border-radius: 26px;
    background: var(--color-input-bg);
  }

  /* Clear icon inside the field (Kap. 6.3 „Löschen-Icon“, not in the artboard): 44 px, 4 px from the edge. */
  .field.clearable {
    padding-right: 4px;
  }

  /* Focus in the field as on the component sheet: 2 px border in text colour plus the focus ring; the text
     stays put. The clear icon shows its own focus ring. */
  .field:has(input:focus) {
    padding: 0 17.5px;
    border: 2px solid var(--color-text);
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .field.clearable:has(input:focus) {
    padding-right: 3.5px;
  }

  /* The label spans icon and field, so tapping the icon focuses the field too. */
  .input {
    display: contents;
  }

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-text);
    font-size: 1rem;
    outline: none;
    appearance: none;
  }

  /* One way to clear is enough; WebKit's own cancel button would add a second one. */
  input::-webkit-search-cancel-button {
    appearance: none;
  }

  .filter {
    position: relative;
    flex-shrink: 0;
    width: 52px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 26px;
    background: var(--color-text);
    color: var(--color-bg);
  }

  .badge {
    position: absolute;
    top: -3px;
    right: -3px;
    min-width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 5px;
    border: 2px solid var(--color-bg);
    border-radius: 11px;
    background: var(--color-primary);
    color: var(--color-on-primary);
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1;
  }
</style>
