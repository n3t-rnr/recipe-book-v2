<script lang="ts">
  // The filtered list without hits (Kap. 6.6 „Suche ohne Treffer“; F-33: „Eine Suche ohne Treffer zeigt den
  // Suchbegriff, „Filter zurücksetzen“ und „Rezept ‚…‘ anlegen“ (der Begriff wird als Titel übernommen)“;
  // F-23: „Meintest du: Spätzle?“, ein Fingertipp darauf startet die Suche). Without a search term (tags
  // only) there is nothing to create: only „Filter zurücksetzen“. No artboard: component-sheet parts only
  // (EmptyState with the plate, primary and outline buttons, a text button), NF-16.
  import { LIMITS } from '../../../../shared/constants.ts';
  import { df } from '../../i18n/de-screens-filter.ts';
  import { paths } from '../../lib/routes.ts';
  import Button from '../Button.svelte';
  import EmptyState from '../EmptyState.svelte';

  interface Props {
    /** The search term (trimmed), or null for a filter by tags only. */
    q: string | null;
    /** „Meintest du“ suggestion of the server (F-23): the whole corrected search text. */
    didYouMean: string | null;
    /** The click, so the list can tell a key (detail 0) from a tap and put the focus accordingly (NF-11). */
    onreset: (event: MouseEvent) => void;
    onsuggest: (q: string, event: MouseEvent) => void;
  }

  let { q, didYouMean, onreset, onsuggest }: Props = $props();

  /**
   * The term as the new recipe's title: at most LIMITS.recipeTitle UTF-16 units, but never half an emoji.
   * A lone surrogate makes encodeURIComponent (buildQuery) throw, and this view would not render.
   */
  function titleOf(term: string): string {
    const cut = term.slice(0, LIMITS.recipeTitle);
    return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  }
</script>

<div class="no-hits">
  <EmptyState title={q ? df.noHits(q) : df.noHitsFiltered}>
    {#if didYouMean}
      {@const suggestion = didYouMean}
      <p class="suggestion">
        {df.didYouMean} <Button variant="text" onclick={(event) => onsuggest(suggestion, event)}>{suggestion}</Button>?
      </p>
    {/if}
    <div class="actions">
      {#if q}
        <Button size={52} icon="plus" href={paths.recipeNew({ title: titleOf(q) })}>
          {df.create(q)}
        </Button>
      {/if}
      <Button variant="outline" size={52} onclick={onreset}>{df.reset}</Button>
    </div>
  </EmptyState>
</div>

<style>
  /* A long search term (up to 200 characters, even without spaces) wraps instead of widening the page
     (NF-08); the buttons grow in height for it. */
  .no-hits :global(.title),
  .no-hits :global(.button) {
    overflow-wrap: anywhere;
  }

  .no-hits :global(.button) {
    max-width: 100%;
    white-space: normal;
  }

  .suggestion {
    max-width: 100%;
    font-size: var(--text-label);
  }

  .suggestion :global(.button) {
    height: auto;
    min-height: 44px;
  }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    max-width: 100%;
  }

  .actions :global(.button) {
    height: auto;
    min-height: 52px;
    padding-block: 8px;
  }
</style>
