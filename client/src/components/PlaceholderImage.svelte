<script lang="ts">
  // Image for recipes without a photo (F-16, generator placeholder()): plate with cutlery and the first
  // letter of the title; color --placeholder-(id mod 4 + 1), so a recipe looks the same everywhere.
  // Light: colored surface; dark: --color-surface with a colored plate. Fills its parent.
  // --add-photo-bottom moves "Foto hinzufügen" up where something overlaps the image's lower edge
  // (the detail's content sheet); 20 px otherwise.
  import { de } from '../i18n/de.ts';
  import Icon from './Icon.svelte';
  import Plate from './Plate.svelte';

  interface Props {
    recipeId: number;
    title: string;
    /** Detail view: "Foto hinzufügen" on the placeholder (user decision of 23.09.2026). */
    addPhoto?: { href: string } | { onclick: () => void } | undefined;
  }

  let { recipeId, title, addPhoto }: Props = $props();

  const color = $derived(((Math.abs(recipeId) % 4) + 1) as 1 | 2 | 3 | 4);
  const letter = $derived((Array.from(title.trim())[0] ?? '').toLocaleUpperCase('de'));
</script>

<div class={['placeholder', `ph-${color}`]}>
  <div class="art" role="img" aria-label={de.recipe.noPhoto(title)}>
    <Plate {color} {letter} />
  </div>
  {#if addPhoto}
    {#if 'href' in addPhoto}
      <a class="add" href={addPhoto.href}><Icon name="camera" size={22} />{de.recipe.addPhoto}</a>
    {:else}
      <button type="button" class="add" onclick={addPhoto.onclick}>
        <Icon name="camera" size={22} />{de.recipe.addPhoto}
      </button>
    {/if}
  {/if}
</div>

<style>
  .placeholder {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--ph);
  }

  .art {
    width: 100%;
    height: 100%;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .placeholder {
      background: var(--color-surface);
    }
  }

  :global(:root[data-theme="dark"]) .placeholder {
    background: var(--color-surface);
  }

  .add {
    position: absolute;
    left: 50%;
    bottom: var(--add-photo-bottom, 20px);
    transform: translateX(-50%);
    height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 20px 0 16px;
    border: 1px solid var(--color-overlay-border);
    border-radius: 24px;
    background: var(--color-overlay);
    color: var(--color-text);
    font-size: 1rem;
    font-weight: 700;
    white-space: nowrap;
    text-decoration: none;
  }
</style>
