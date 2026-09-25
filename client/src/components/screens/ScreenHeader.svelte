<script lang="ts">
  // Header of the main screens (generator phoneHeader): screen title, optional "Aktualisieren" (F-34)
  // and, on phones and tablets portrait, the avatar for the profile switch (F-03); from 1024 px the
  // avatar sits in the rail. `compact`: list column next to the detail (30 px title, artboard TabletQuer).
  // It stays above the list's sticky search row, whose band for the iOS status bar reaches up into the
  // header (standalone mode, SearchBar.svelte).
  import { de } from '../../i18n/de.ts';
  import { breakpoints } from '../../lib/breakpoints.svelte.ts';
  import AvatarButton from '../AvatarButton.svelte';
  import IconButton from '../IconButton.svelte';

  interface Props {
    title: string;
    compact?: boolean;
    onrefresh?: (() => void) | undefined;
    /** Refresh running: the icon turns. */
    busy?: boolean;
  }

  let { title, compact = false, onrefresh, busy = false }: Props = $props();
</script>

<header class={['header', { compact, busy }]}>
  <h1 class="title-screen">{title}</h1>
  <div class="actions">
    {#if onrefresh}
      <IconButton icon="refresh" label={de.common.refresh} onclick={onrefresh} />
    {/if}
    {#if !breakpoints.wide}
      <AvatarButton />
    {/if}
  </div>
</header>

<style>
  .header {
    position: relative;
    z-index: 21;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: calc(58px + var(--safe-top));
    padding: calc(14px + var(--safe-top)) 12px 0 20px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  @media (min-width: 1024px) {
    .header {
      min-height: 60px;
      padding: 16px 12px 0 20px;
    }
  }

  .compact .title-screen {
    font-size: 1.875rem;
  }

  .busy .actions :global(svg) {
    animation: turn 0.9s linear infinite;
  }

  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }
</style>
