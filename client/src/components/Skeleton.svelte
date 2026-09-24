<script lang="ts">
  // Loading placeholder with the fixed size of the real element (component sheet "Laden (Skeleton)",
  // F-33, NF-06: no layout shift). "card" = RecipeCard (image 3:2, title and meta bars),
  // "row" = CompactRow (112×75 thumbnail). Hidden from assistive technology; the list sets aria-busy.
  interface Props {
    variant?: 'card' | 'row';
  }

  let { variant = 'card' }: Props = $props();
</script>

{#if variant === 'card'}
  <div class="card" aria-hidden="true">
    <div class="media"></div>
    <div class="body">
      <span class="bar title"></span>
      <span class="bar meta"></span>
    </div>
  </div>
{:else}
  <div class="row" aria-hidden="true">
    <div class="thumb"></div>
    <div class="lines">
      <span class="bar row-title"></span>
      <span class="bar row-meta"></span>
    </div>
  </div>
{/if}

<style>
  .card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    overflow: hidden;
    background: var(--color-surface);
  }

  .media {
    aspect-ratio: 3 / 2;
    background: var(--color-subtle);
  }

  /* Same height as a card with a one-line title: 14 + 28 + 8 + 28 + 16 px. */
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 94px;
    padding: 14px 16px 16px;
  }

  .bar {
    display: block;
    background: var(--color-subtle);
    animation: pulse 1.4s ease-in-out infinite;
  }

  .title {
    width: 70%;
    height: 22px;
    border-radius: 11px;
  }

  .meta {
    width: 45%;
    height: 16px;
    border-radius: 8px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border: 2px solid transparent;
    border-radius: 20px;
  }

  .thumb {
    width: 112px;
    height: 75px;
    flex-shrink: 0;
    border-radius: 14px;
    background: var(--color-subtle);
  }

  .lines {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .row-title {
    width: 70%;
    height: 18px;
    border-radius: 9px;
  }

  .row-meta {
    width: 45%;
    height: 14px;
    border-radius: 7px;
  }

  @keyframes pulse {
    50% {
      opacity: 0.55;
    }
  }
</style>
