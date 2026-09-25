<script lang="ts">
  // Filter sheet of the list (generator filterContent(), phoneFilter(), tabletFilter(); Kap. 6.3 „Tags mit
  // Suche und Anzahl (Mehrfachauswahl); Segment „alle müssen passen / einer reicht“ … Sortierung als
  // Radiogruppe. Änderungen wirken sofort (kein „Anwenden“), die Trefferzahl steht im Sheet-Kopf; darunter
  // „Filter zurücksetzen““). Bottom sheet on phones (full height) and tablets in portrait (content height),
  // side panel next to the list column from 1024 px (Kap. 6.4). „Nur Favoriten“, „Mindestbewertung“ and the
  // rating sorts follow in M5 (F-25, F-43, F-44). Tags keep the server order (count, then name); active ones
  // stay in place. Lazily loaded (NF-01).
  import { onMount } from 'svelte';
  import { de } from '../../i18n/de.ts';
  import { ds } from '../../i18n/de-screens.ts';
  import { df } from '../../i18n/de-screens-filter.ts';
  import { errorMessage } from '../../lib/api.ts';
  import { breakpoints } from '../../lib/breakpoints.svelte.ts';
  import {
    effectiveSort,
    type ListFilter,
    type ListSortChoice,
    resetFilter,
    searchable,
    toggleTag,
  } from '../../lib/list-query.ts';
  import { radioKeys } from '../../lib/radio-keys.ts';
  import { matchTags } from '../../lib/tag-match.ts';
  import { tags } from '../../state/tags.svelte.ts';
  import Button from '../Button.svelte';
  import Chip from '../Chip.svelte';
  import SearchField from '../SearchField.svelte';
  import Segmented from '../Segmented.svelte';
  import Sheet from '../Sheet.svelte';

  interface Props {
    filter: ListFilter;
    /** Recipes matching the filter: „14 Treffer“ in the head. */
    total: number;
    /**
     * What opened the sheet. The sort button starts on the checked sort option; „Alle Tags …“ on the heading
     * of the tags (NF-11), not in their search field, which would open the on-screen keyboard over them.
     * Tab leads from there into the search field.
     */
    focus: 'filter' | 'tags' | 'sort';
    /** Every change applies at once. */
    onchange: (next: ListFilter) => void;
    onclose: () => void;
  }

  let { filter, total, focus, onchange, onclose }: Props = $props();

  const id = $props.id();
  const SKELETON_WIDTHS = [124, 96, 140, 84, 112, 72];
  let search = $state('');
  let sortGroup: HTMLElement | undefined = $state();
  let tagsLabel: HTMLElement | undefined = $state();

  const shownTags = $derived(search.trim() === '' ? tags.list : matchTags(tags.list, search));
  /** F-26: „Relevanz (Standard bei Suchbegriff)“ is only a choice while there is a search term. */
  const sorts = $derived<ListSortChoice[]>(
    searchable(filter.q) ? ['relevance', 'newest', 'title'] : ['newest', 'title'],
  );
  const sort = $derived(effectiveSort(filter));
  const modes = [
    { value: 'all', label: df.modes.all },
    { value: 'any', label: df.modes.any },
  ];

  onMount(() => {
    void tags.ensure();
    if (focus === 'sort') {
      sortGroup?.scrollIntoView({ block: 'nearest' });
      sortGroup?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    } else if (focus === 'tags') tagsLabel?.focus();
  });

  function choose(value: ListSortChoice): void {
    onchange({ ...filter, sort: value === 'relevance' ? null : value });
  }

  function onsortkey(event: KeyboardEvent, index: number): void {
    const next = radioKeys(event.key, index, sorts.length);
    const value = next === null ? undefined : sorts[next];
    if (next === null || value === undefined) return;
    event.preventDefault();
    choose(value);
    // The options as they stand now: „Relevanz“ leaves with the search term („Filter zurücksetzen“), so an
    // index-bound element list would point at the wrong option (NF-11).
    const option = (event.currentTarget as HTMLElement).parentElement?.children[next];
    if (option instanceof HTMLElement) option.focus();
  }
</script>

<Sheet
  title={df.title}
  meta={df.hits(total)}
  closeLabel={df.close}
  full={breakpoints.phone}
  panel={breakpoints.wide}
  {onclose}
>
  <div class="group">
    <p bind:this={tagsLabel} id="{id}-tags" class="label" tabindex="-1">{df.tags}</p>
    <SearchField bind:value={search} label={df.tagSearch} />
    {#if tags.list.length > 0}
      {#if shownTags.length > 0}
        <div class="chips" role="group" aria-labelledby="{id}-tags">
          {#each shownTags as tag (tag.id)}
            <Chip
              label={tag.name}
              count={tag.count}
              active={filter.tags.includes(tag.id)}
              onclick={() => onchange(toggleTag(filter, tag.id))}
            />
          {/each}
        </div>
      {:else}
        <p class="note">{df.tagNone}</p>
      {/if}
    {:else if tags.status === 'error'}
      <div class="failed">
        <p class="note">{errorMessage(tags.error)}</p>
        <Button variant="outline" size={44} icon="refresh" onclick={() => tags.load()}>{de.common.retry}</Button>
      </div>
    {:else if tags.status === 'ready'}
      <p class="note">{df.tagsEmpty}</p>
    {:else}
      <div class="chips" aria-busy="true">
        {#each SKELETON_WIDTHS as width (width)}
          <span class="skeleton" style:width="{width}px"></span>
        {/each}
        <span class="visually-hidden" role="status">{de.common.loading}</span>
      </div>
    {/if}
    <Segmented
      label={df.mode}
      options={modes}
      value={filter.tagMode}
      onchange={(mode) => onchange({ ...filter, tagMode: mode === 'any' ? 'any' : 'all' })}
    />
  </div>

  <div class="group" bind:this={sortGroup}>
    <p id="{id}-sort" class="label">{df.sort}</p>
    <div class="chips" role="radiogroup" aria-labelledby="{id}-sort">
      {#each sorts as value, i (value)}
        <Chip
          role="radio"
          variant="outline"
          label={ds.list.sorts[value]}
          active={value === sort}
          tabindex={value === sort ? 0 : -1}
          onclick={() => choose(value)}
          onkeydown={(event) => onsortkey(event, i)}
        />
      {/each}
    </div>
  </div>

  <div class="reset">
    <Button variant="text" onclick={() => onchange(resetFilter(filter))}>{df.reset}</Button>
  </div>
</Sheet>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .label {
    font-size: var(--text-label);
    font-weight: 700;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .note {
    font-size: var(--text-label);
    color: var(--color-text-muted);
  }

  .failed {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  /* Tags still loading: chip-sized placeholders (component sheet „Skeleton“). */
  .skeleton {
    height: 44px;
    border-radius: var(--radius-chip);
    background: var(--color-subtle);
  }

  .reset {
    display: flex;
  }
</style>
