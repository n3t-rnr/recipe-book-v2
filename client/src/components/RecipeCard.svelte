<script lang="ts">
  // Large recipe card of the list (generator card()): image 3:2 with total time, title (max. 2 lines),
  // rating and up to 2 tag pills plus "+n". The whole card opens the recipe (stretched link); the
  // favorite heart on the image appears only with showFavorite (ratings and favorites UI: M5).
  import type { RecipeCard } from '../../../shared/types.ts';
  import { de } from '../i18n/de.ts';
  import { preloadRecipeDetail } from '../lib/lazy-routes.ts';
  import { paths } from '../lib/routes.ts';
  import Icon from './Icon.svelte';
  import RatingInline from './RatingInline.svelte';
  import RecipeMedia from './RecipeMedia.svelte';
  import TagPill from './TagPill.svelte';
  import TimePill from './TimePill.svelte';

  interface Props {
    recipe: RecipeCard;
    href?: string | undefined;
    /** First visible card: eager image for LCP. */
    eager?: boolean;
    /** Overrides the card sizes of RecipeMedia (CARD_SIZES: one column on phones, two in tablet portrait, NF-06). */
    sizes?: string | undefined;
    showFavorite?: boolean;
    onfavorite?: ((next: boolean) => void) | undefined;
  }

  let {
    recipe,
    href,
    eager = false,
    sizes,
    showFavorite = false,
    onfavorite,
  }: Props = $props();

  const shownTags = $derived(recipe.tags.slice(0, 2));
  const moreTags = $derived(Math.max(0, recipe.tags.length - 2) + recipe.moreTags);
  const favorite = $derived(recipe.isFavorite === true);
</script>

<article class="card">
  <div class="media">
    <RecipeMedia image={recipe.image} recipeId={recipe.id} title={recipe.title} {sizes} {eager} />
    {#if showFavorite && recipe.isFavorite !== null}
      <button
        type="button"
        class="heart"
        aria-label={de.recipe.favorite}
        aria-pressed={favorite}
        onclick={() => onfavorite?.(!favorite)}
      >
        <Icon name="heart" size={24} class={['icon-heart', { on: favorite }].join(' ')} />
      </button>
    {/if}
    {#if recipe.totalMinutes !== null}
      <div class="time"><TimePill minutes={recipe.totalMinutes} /></div>
    {/if}
  </div>
  <div class="body">
    <h2 class="title">
      <a
        class="link"
        href={href ?? paths.recipe(recipe.id)}
        onpointerdown={preloadRecipeDetail}
        onfocus={preloadRecipeDetail}>{recipe.title}</a
      >
    </h2>
    <div class="meta">
      <RatingInline avg={recipe.ratingAvg} count={recipe.ratingCount} />
      {#each shownTags as tag (tag.id)}
        <TagPill label={tag.name} />
      {/each}
      {#if moreTags > 0}
        <TagPill label={de.recipe.moreTags(moreTags)} srLabel={de.recipe.moreTagsLabel(moreTags)} />
      {/if}
    </div>
  </div>
</article>

<style>
  .card {
    position: relative;
    flex-shrink: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    overflow: hidden;
    background: var(--color-surface);
  }

  .card:has(.link:focus-visible) {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .media {
    position: relative;
  }

  .heart {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 1;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--color-overlay-border);
    border-radius: 24px;
    background: var(--color-overlay);
    color: var(--color-text);
  }

  .time {
    position: absolute;
    left: 12px;
    bottom: 12px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px 16px;
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-card);
    font-weight: var(--text-card-weight);
    line-height: 1.15;
    letter-spacing: -0.3px;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: break-word;
    hyphens: auto;
  }

  .link {
    color: inherit;
    text-decoration: none;
  }

  /* The link covers the whole card; the heart sits above it. */
  .link::after {
    content: "";
    position: absolute;
    inset: 0;
  }

  .link:focus-visible {
    outline: none;
  }

  .meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
