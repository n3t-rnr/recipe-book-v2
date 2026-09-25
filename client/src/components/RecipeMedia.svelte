<script lang="ts">
  // Recipe image with a fixed aspect ratio (NF-06: no layout shift): the photo as <img> (lib/media.ts:
  // cards offer s = 720 px and m = 1200 px via srcset, the detail loads m; never l), lazy unless it is
  // the first card, or the placeholder image when the recipe has no photo (F-16).
  import { IMAGE_VARIANTS } from '../../../shared/constants.ts';
  import type { CardImage, DetailImage } from '../../../shared/types.ts';
  import { CARD_SIZES, mediaSource } from '../lib/media.ts';
  import PlaceholderImage from './PlaceholderImage.svelte';

  interface Props {
    image: CardImage | DetailImage | null;
    recipeId: number;
    title: string;
    /** "card": s and m; "detail": m only (NF-06). */
    use?: 'card' | 'detail';
    /** CSS aspect-ratio, 3 / 2 for cards (design) and 112 / 75 for tablet rows. */
    ratio?: string;
    /** Corner radius in px (cards clip via their own border radius). */
    radius?: number;
    /** sizes attribute of cards; must match the layout so the browser picks s or m (NF-06). */
    sizes?: string | undefined;
    /** First card of a list: load eagerly for LCP (NF-03). */
    eager?: boolean;
    /** Alt text; empty in cards because the title is next to the image. */
    alt?: string;
    addPhoto?: { href: string } | { onclick: () => void } | undefined;
  }

  let {
    image,
    recipeId,
    title,
    use = 'card',
    ratio = '3 / 2',
    radius = 0,
    sizes = CARD_SIZES,
    eager = false,
    alt = '',
    addPhoto,
  }: Props = $props();

  const source = $derived(image && mediaSource(image, use));
</script>

<div class="media" style:aspect-ratio={ratio} style:border-radius={radius ? `${radius}px` : undefined}>
  {#if source}
    <img
      src={source.src}
      srcset={source.srcset}
      sizes={source.srcset && sizes}
      {alt}
      width={IMAGE_VARIANTS.s.width}
      height={IMAGE_VARIANTS.s.height}
      loading={eager ? 'eager' : 'lazy'}
      fetchpriority={eager ? 'high' : undefined}
      decoding="async"
    />
  {:else}
    <PlaceholderImage {recipeId} {title} {addPhoto} />
  {/if}
</div>

<style>
  .media {
    position: relative;
    width: 100%;
    overflow: hidden;
    background: var(--color-subtle);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
