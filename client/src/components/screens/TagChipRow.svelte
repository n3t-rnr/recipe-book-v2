<script lang="ts">
  // Chip row under the search field (generator chipRow(); F-24: „aktive Tags zuerst, dann die 12
  // meistgenutzten; ein Fingertipp schaltet den Filter an oder aus“; Kap. 6.3: zuletzt „Alle Tags …“).
  // Only the row scrolls sideways, never the page (NF-08). Its height is kept while the tags load, when
  // only „Alle Tags …“ shows (no layout shift, NF-06). Keyed by tag id: a chip that moves to the front for
  // new tags from elsewhere is the same element.
  import type { TagCount } from '../../../../shared/types.ts';
  import { ds } from '../../i18n/de-screens.ts';
  import { chipRow } from '../../lib/list-query.ts';
  import Chip from '../Chip.svelte';

  interface Props {
    /** All tags in server order (GET /tags). */
    list: readonly TagCount[];
    /** Active tag ids in activation order. */
    active: readonly number[];
    ontoggle: (id: number) => void;
    /** „Alle Tags …“: the filter sheet. */
    onall: () => void;
    /** Early signal of a tap on „Alle Tags …“: preload the sheet. */
    onintent: () => void;
  }

  let { list, active, ontoggle, onall, onintent }: Props = $props();

  /**
   * A chip focused with the keyboard comes fully into view: browsers leave a half hidden one at the row's
   * edge (NF-11). Not on a tap: the row would move under the finger between press and release.
   */
  function reveal(event: FocusEvent): void {
    const chip = event.target;
    if (chip instanceof HTMLElement && chip.matches(':focus-visible')) {
      chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /**
   * Order of the row: the active tags first (F-24), but a switch made in the row itself moves no chip. The
   * row keeps its scroll position, so a chip moving to the front would leave another tag's chip under the
   * finger, and a second tap on the same spot would switch that tag (NF-07). So the row is sorted by
   * `basis`, the active tags of the last state it did not make itself. A tap or key in the row keeps that
   * basis while the active tags are the ones it produced (`kept`, compared by value): the chip switches in
   * place, under the finger and with the keyboard focus (NF-11), and a second tap there switches it back.
   * The same tags from elsewhere keep it too: a search, the sort or tag mode, or a recipe opened next to
   * the list (≥ 1024 px) is no reason to move chips. Other tags (load, Back/Forward, the filter sheet,
   * „Filter zurücksetzen“, a link) or a new tag list sort the row afresh; when that brings other tags to
   * the front, the row starts at its beginning again, where they now are.
   */
  let kept = $state.raw<{ basis: readonly number[]; after: string; list: readonly TagCount[] } | null>(null);
  const basis = $derived(kept && kept.after === active.join() && kept.list === list ? kept.basis : active);
  const lead = $derived(basis.join());
  let row: HTMLElement | undefined = $state();

  $effect(() => {
    void lead;
    if (row) row.scrollLeft = 0;
  });

  function toggle(id: number): void {
    const from = basis;
    ontoggle(id);
    // router.setQuery() changes the URL, and with it `active`, at once.
    kept = { basis: from, after: active.join(), list };
  }
</script>

<div bind:this={row} class="chips" role="group" aria-label={ds.list.chips} onfocusin={reveal}>
  {#each chipRow(list, basis) as chip (chip.tag.id)}
    <Chip label={chip.tag.name} active={active.includes(chip.tag.id)} onclick={() => toggle(chip.tag.id)} />
  {/each}
  <Chip label={ds.list.allTags} variant="outline" haspopup="dialog" onpointerdown={onintent} onclick={onall} />
</div>

<style>
  /* 14 px 0 0 20 px, 8 px apart, 20 px after the last chip (8 px gap + 12 px end spacer). The 4 px below
     keep the focus ring of the chips inside the scrolling row; the negative margin gives them back. */
  .chips {
    display: flex;
    gap: 8px;
    min-height: 62px;
    margin-bottom: -4px;
    padding: 14px 0 4px 20px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .chips::-webkit-scrollbar {
    display: none;
  }

  .chips::after {
    content: "";
    flex: 0 0 12px;
  }
</style>
