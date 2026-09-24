<script lang="ts">
  // Recipe detail below the title (F-29; generator infoTiles, detailTags, ingredients, steps, footerMeta):
  // info tiles only for set values, tag chips (they open the list filtered by the tag, M4), ingredients
  // in their groups, numbered steps at 18 px (or "Noch keine Zubereitung erfasst" with a link to the
  // editor, F-11), source (a link only for http/https) and the footer "Angelegt von … am …". Ingredients and steps stand side by side at 600–1023 px and from 1280 px,
  // with the ingredients sticky; in the detail column at 1024–1279 px they stand one below the other.
  // Ticking off ingredients (F-30) and the rating box (F-27) follow in M5.
  import type { RecipeDetail } from '../../../../shared/types.ts';
  import { dl } from '../../i18n/de-screens-lazy.ts';
  import { formatAmount, formatIngredientAmount, formatMinutes } from '../../lib/format.ts';
  import { paths } from '../../lib/routes.ts';
  import { footerText, groupIngredients, sourceHref } from '../../lib/screens.ts';
  import Button from '../Button.svelte';
  import Chip from '../Chip.svelte';

  interface Props {
    recipe: RecipeDetail;
  }

  let { recipe }: Props = $props();

  const servings = $derived(recipe.servings === null ? null : formatAmount(recipe.servings));
  const servingsUnit = $derived(recipe.servingsUnit.trim() || dl.detail.servings);
  const groups = $derived(groupIngredients(recipe.ingredients));
  const source = $derived(recipe.source.trim());
  const href = $derived(sourceHref(source));
  const hasFacts = $derived(recipe.prepMinutes !== null || recipe.cookMinutes !== null || servings !== null);

  function ingredientName(name: string, note: string): string {
    return [name.trim(), note.trim()].filter((part) => part !== '').join(', ');
  }
</script>

{#if hasFacts}
  <dl class="facts" aria-label={dl.detail.facts}>
    {#if recipe.prepMinutes !== null}
      <div class="fact prep"><dt>{dl.detail.prep}</dt><dd>{formatMinutes(recipe.prepMinutes)}</dd></div>
    {/if}
    {#if recipe.cookMinutes !== null}
      <div class="fact cook"><dt>{dl.detail.cook}</dt><dd>{formatMinutes(recipe.cookMinutes)}</dd></div>
    {/if}
    {#if servings !== null}
      <div class="fact servings"><dt>{servingsUnit}</dt><dd>{servings}</dd></div>
    {/if}
  </dl>
{/if}

{#if recipe.tags.length > 0}
  <ul class="tags" aria-label={dl.detail.tags}>
    {#each recipe.tags as tag (tag.id)}
      <li><Chip label={tag.name} href={paths.recipes({ tags: tag.id })} /></li>
    {/each}
  </ul>
{/if}

<div class="columns">
  {#if recipe.ingredients.length > 0}
    <section class="ingredients" aria-labelledby="ingredients-{recipe.id}">
      <div class="section-head">
        <h2 id="ingredients-{recipe.id}" class="title-section">{dl.detail.ingredients}</h2>
        {#if servings !== null}
          <span class="for">{dl.detail.forServings(servings, servingsUnit)}</span>
        {/if}
      </div>
      {#each groups as group, g (g)}
        {#if group.group !== ''}<h3 class="group">{group.group}</h3>{/if}
        <ul class="ingredient-list">
          {#each group.items as item (item.id)}
            {@const amount = formatIngredientAmount(item.amount, item.amountMax, item.unit)}
            <li class="ingredient"><span class="amount">{amount}{amount === '' ? '' : ' '}</span><span class="name">{ingredientName(item.name, item.note)}</span></li>
          {/each}
        </ul>
      {/each}
    </section>
  {/if}

  <section class="steps" aria-labelledby="steps-{recipe.id}">
    <h2 id="steps-{recipe.id}" class="title-section">{dl.detail.steps}</h2>
    {#if recipe.steps.length > 0}
      <ol class="step-list">
        {#each recipe.steps as step, i (step.id)}
          <li class="step">
            <h3 class="step-head">{dl.detail.step(i + 1)}</h3>
            <p class="step-text">{step.text}</p>
          </li>
        {/each}
      </ol>
    {:else}
      <!-- A recipe without steps is allowed (F-11); its AK asks for this hint with a way to add them. -->
      <div class="step empty">
        <p>{dl.detail.stepsEmpty}</p>
        <Button variant="text" icon="pencil" href={paths.recipeEdit(recipe.id)}>{dl.detail.stepsEmptyAction}</Button>
      </div>
    {/if}
  </section>
</div>

{#if source !== ''}
  <p class="source">
    <span class="source-label">{dl.detail.source}:</span>
    {#if href}
      <a {href} target="_blank" rel="external noopener noreferrer">{source}</a>
    {:else}
      {source}
    {/if}
  </p>
{/if}

<p class="footer">{footerText(recipe)}</p>

<style>
  /* Info tiles: 3 columns, 8 px apart; Vanilla and Moonstone surfaces carry dark ink (NF-12). */
  .facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .fact {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 12px;
    border-radius: var(--radius-tile);
  }

  /* Labels hyphenate (lang="de") instead of breaking anywhere ("Vorbereitun|g"); break-word only
     catches single words longer than a tile, e.g. a long servings unit. */
  .fact dt {
    font-size: 0.8125rem;
    font-weight: 600;
    overflow-wrap: break-word;
    hyphens: auto;
  }

  /* Below 380 px, 10 px sides keep "Vorbereitung" (78.5 px in Figtree 13/600) on one line at 360 px. */
  @media (max-width: 379.98px) {
    .fact {
      padding-inline: 10px;
    }
  }

  .fact dd {
    font-family: var(--font-display);
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1.3;
  }

  .prep {
    background: var(--color-highlight);
    color: var(--color-ink);
  }

  .cook {
    background: var(--color-secondary);
    color: var(--color-ink);
  }

  .servings {
    border: 1.5px solid var(--color-border-strong);
    background: var(--color-surface);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0;
    list-style: none;
  }

  .columns {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Side by side at 600–1023 px (tablet portrait page) and from 1280 px (wide detail column). */
  @media (min-width: 600px) and (max-width: 1023.98px), (min-width: 1280px) {
    .columns {
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
      align-items: start;
      gap: 24px;
    }

    .ingredients {
      position: sticky;
      top: 16px;
      max-height: calc(100dvh - 32px);
      overflow-y: auto;
      overscroll-behavior: contain;
    }
  }

  /* Without ingredients the steps take the whole width of the two-column grid. */
  .steps:only-child {
    grid-column: 1 / -1;
  }

  .ingredients,
  .steps {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .steps {
    gap: 12px;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px 12px;
  }

  .for {
    font-size: var(--text-label);
    color: var(--color-text-muted);
  }

  .group {
    margin: 8px 0 0;
    font-size: var(--text-label);
    font-weight: 700;
  }

  .ingredient-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    list-style: none;
  }

  /* Ingredient row of the artboard: 52 px, 14 px sides, 70 px bold amount column. */
  .ingredient {
    min-height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-row);
    background: var(--color-surface);
    font-size: var(--text-body);
    line-height: 1.4;
  }

  .amount {
    flex-shrink: 0;
    min-width: 70px;
    max-width: 45%;
    font-weight: 700;
  }

  .name {
    min-width: 0;
    overflow-wrap: break-word;
  }

  .step-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0;
    list-style: none;
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px;
    border: 1px solid var(--color-border);
    border-radius: 20px;
    background: var(--color-surface);
  }

  .empty {
    align-items: flex-start;
    padding-bottom: 8px;
    font-size: var(--text-body);
  }

  .step-head {
    font-family: var(--font-display);
    font-size: var(--text-step-head);
    font-weight: var(--text-step-head-weight);
    line-height: 1.3;
    color: var(--color-primary-text);
  }

  /* Steps ≥ 18 px (F-29); line breaks of the text stay (F-11). */
  .step-text {
    font-size: var(--text-step);
    line-height: 1.5;
    white-space: pre-line;
    overflow-wrap: break-word;
  }

  .source {
    font-size: var(--text-label);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .source-label {
    font-weight: 700;
  }

  /* 44 px tap target (NF-07) without moving the text. */
  .source a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-weight: 600;
  }

  .footer {
    font-size: var(--text-meta);
    line-height: 1.5;
    color: var(--color-text-muted);
  }
</style>
