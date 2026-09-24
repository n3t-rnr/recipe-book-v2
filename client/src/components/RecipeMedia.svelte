<script lang="ts">
  // Recipe image with a fixed aspect ratio (NF-06: no layout shift): the photo as <img> with srcset
  // (s = 720 px card variant, m = 1200 px long edge; never l in lists), lazy unless it is the first
  // card, or the placeholder image when the recipe has no photo (F-16).
  import type { CardImage, DetailImage } from '../../../shared/types.ts';
  import { IMAGE_VARIANTS } from '../../../shared/constants.ts';
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
    /** sizes attribute; must match the layout so the browser picks s or m (NF-06). */
    sizes?: string;
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
    sizes = '100vw',
    eager = false,
    alt = '',
    addPhoto,
  }: Props = $props();

  /** Width of variant m: the long edge is 1200 px, never upscaled (F-15). */
  function mediumWidth(img: { width: number; height: number }): number {
    const scale = Math.min(1, IMAGE_VARIANTS.m.longEdge / Math.max(img.width, img.height, 1));
    return Math.max(1, Math.round(img.width * scale));
  }

  const srcset = $derived.by(() => {
    if (!image) return undefined;
    const m = `${image.urls.m} ${mediumWidth(image)}w`;
    return use === 'card' ? `${image.urls.s} ${IMAGE_VARIANTS.s.width}w, ${m}` : m;
  });
</script>

<div class="media" style:aspect-ratio={ratio} style:border-radius={radius ? `${radius}px` : undefined}>
  {#if image}
    <img
      src={use === 'card' ? image.urls.s : image.urls.m}
      {srcset}
      {sizes}
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
