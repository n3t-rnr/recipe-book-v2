<script lang="ts">
  // Compact list row of the tablet landscape list column (generator compactRow): 112×75 image, title,
  // time and rating; the selected recipe gets a 2 px primary border on the raised surface and
  // aria-current (state not by color alone: border plus surface change, NF-13).
  import type { RecipeCard } from '../../../shared/types.ts';
  import { de } from '../i18n/de.ts';
  import { formatMinutes } from '../lib/format-list.ts';
  import { preloadRecipeDetail } from '../lib/lazy-routes.ts';
  import { paths } from '../lib/routes.ts';
  import Icon from './Icon.svelte';
  import RatingInline from './RatingInline.svelte';
  import RecipeMedia from './RecipeMedia.svelte';

  interface Props {
    recipe: RecipeCard;
    selected?: boolean;
    href?: string | undefined;
    eager?: boolean;
    showFavorite?: boolean;
    onfavorite?: ((next: boolean) => void) | undefined;
  }

  let { recipe, selected = false, href, eager = false, showFavorite = false, onfavorite }: Props = $props();

  const favorite = $derived(recipe.isFavorite === true);
</script>

<article class={['row', { selected }]}>
  <div class="thumb">
    <RecipeMedia
      image={recipe.image}
      recipeId={recipe.id}
      title={recipe.title}
      ratio="112 / 75"
      radius={14}
      sizes="112px"
      {eager}
    />
  </div>
  <div class="text">
    <h2 class="title">
      <a
        class="link"
        href={href ?? paths.recipe(recipe.id)}
        aria-current={selected ? 'page' : undefined}
        onpointerdown={preloadRecipeDetail}
        onfocus={preloadRecipeDetail}
      >
        {recipe.title}
      </a>
    </h2>
    <div class="meta">
      {#if recipe.totalMinutes !== null}
        <span class="time">
          <Icon name="clock" size={16} />
          <span aria-hidden="true">{formatMinutes(recipe.totalMinutes)}</span>
          <span class="visually-hidden">{de.recipe.totalTime(formatMinutes(recipe.totalMinutes))}</span>
        </span>
      {/if}
      <RatingInline avg={recipe.ratingAvg} count={recipe.ratingCount} size={14} />
    </div>
  </div>
  {#if showFavorite && recipe.isFavorite !== null}
    <button
      type="button"
      class="heart"
      aria-label={de.recipe.favorite}
      aria-pressed={favorite}
      onclick={() => onfavorite?.(!favorite)}
    >
      <Icon name="heart" size={22} class={['icon-heart', { on: favorite }].join(' ')} />
    </button>
  {/if}
</article>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border: 2px solid transparent;
    border-radius: 20px;
    background: transparent;
  }

  .row.selected {
    border-color: var(--color-primary);
    background: var(--color-surface-raised);
  }

  .row:has(.link:focus-visible) {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .thumb {
    width: 112px;
    flex-shrink: 0;
  }

  .text {
    flex-grow: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* At most 2 lines as in the artboard. The link's ::after is positioned against .row, so the clip does
     not cut the tap area. */
  .title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-step);
    font-weight: 700;
    line-height: 1.2;
    overflow-wrap: break-word;
    hyphens: auto;
  }

  .link {
    color: inherit;
    text-decoration: none;
  }

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
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 10px;
    font-size: var(--text-meta);
  }

  .time {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  .heart {
    position: relative;
    z-index: 1;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
  }
</style>
