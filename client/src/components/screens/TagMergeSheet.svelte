<script lang="ts">
  // „Zusammenführen mit …“ (F-19, Kap. 6.3): a bottom sheet with the tag search and every other tag as a
  // count chip of the component sheet, filtered with the same prefix rule as the editor (matchTags). A tap
  // picks the target; the page then asks for confirmation (F-35: merging is confirmed first).
  import type { TagCount } from '../../../../shared/types.ts';
  import { dt } from '../../i18n/de-screens-tags.ts';
  import { matchTags } from '../../lib/tag-match.ts';
  import Chip from '../Chip.svelte';
  import SearchField from '../SearchField.svelte';
  import Sheet from '../Sheet.svelte';

  interface Props {
    /** The tag that goes away. */
    from: TagCount;
    /** All tags in server order (tag store). */
    list: readonly TagCount[];
    onpick: (into: TagCount) => void;
    onclose: () => void;
  }

  let { from, list, onpick, onclose }: Props = $props();

  let query = $state('');

  const shown = $derived(
    (query.trim() === '' ? list : matchTags(list, query)).filter((tag) => tag.id !== from.id),
  );
</script>

<!-- display: contents; only scopes the rules for long names below. -->
<div class="merge">
  <Sheet title={dt.mergeTitle(from.name)} {onclose}>
    <SearchField bind:value={query} label={dt.search} />
    {#if shown.length > 0}
      <ul class="choices">
        {#each shown as tag (tag.id)}
          <li><Chip variant="action" label={tag.name} count={tag.count} onclick={() => onpick(tag)} /></li>
        {/each}
      </ul>
    {:else}
      <p class="none">{dt.noMatch(query.trim())}</p>
    {/if}
  </Sheet>
</div>

<style>
  .merge {
    display: contents;
  }

  /* 40-character names without a space wrap instead of widening the sheet (NF-08). */
  .merge :global(h2) {
    overflow-wrap: anywhere;
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 0 4px;
    list-style: none;
  }

  .choices li {
    display: flex;
    min-width: 0;
  }

  .choices :global(button.chip) {
    flex-shrink: 1;
    min-width: 0;
    height: auto;
    min-height: 44px;
    padding-block: 10px;
    white-space: normal;
    overflow-wrap: anywhere;
    text-align: start;
  }

  .none {
    font-size: var(--text-label);
    color: var(--color-text-muted);
  }
</style>
