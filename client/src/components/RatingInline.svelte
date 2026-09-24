<script lang="ts">
  // Average rating in cards and rows (generator ratingInline): filled star, "4,3" bold, "(3)";
  // "Noch nicht bewertet" when nobody rated. The state is spelled out for screen readers (NF-11).
  import { de } from '../i18n/de.ts';
  import { formatRating } from '../lib/format-list.ts';
  import Icon from './Icon.svelte';

  interface Props {
    avg: number | null;
    count: number;
    /** Font size in px: 15 in cards, 14 in compact rows. */
    size?: 14 | 15;
  }

  let { avg, count, size = 15 }: Props = $props();
  const value = $derived(avg === null ? '' : formatRating(avg));
</script>

{#if avg === null || count === 0}
  <span class={['rating', 'none', `s${size}`]}>{de.recipe.notRated}</span>
{:else}
  <span class={['rating', `s${size}`]}>
    <span class="visual" aria-hidden="true">
      <Icon name="star" size={18} strokeWidth={1.8} class="icon-star-on" />
      <strong>{value}</strong>({count})
    </span>
    <span class="visually-hidden">{de.recipe.ratingSummary(value, count)}</span>
  </span>
{/if}

<style>
  .rating {
    white-space: nowrap;
  }

  .visual {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .s15 {
    font-size: var(--text-label);
  }

  .s14 {
    font-size: var(--text-meta);
  }

  .none {
    color: var(--color-text-muted);
  }
</style>
