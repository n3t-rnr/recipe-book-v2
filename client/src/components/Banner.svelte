<script lang="ts">
  // Alert banner of the component sheet: Vanilla surface with dark text, alert icon, optional action
  // ("Erneut versuchen"). Used for "Server nicht erreichbar" (F-33) and later read-only and update hints.
  import type { IconName } from '../lib/icons.ts';
  import Icon from './Icon.svelte';

  interface Props {
    message: string;
    icon?: IconName;
    actionLabel?: string | undefined;
    onaction?: (() => void) | undefined;
    /** Disables the action while it runs. */
    busy?: boolean;
  }

  let { message, icon = 'alert', actionLabel, onaction, busy = false }: Props = $props();
</script>

<div class="banner" role="alert">
  <p class="title"><Icon name={icon} size={20} />{message}</p>
  {#if actionLabel && onaction}
    <button
      type="button"
      class="action"
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onclick={() => {
        // Stays focusable while busy (NF-11): a disabled button would drop keyboard focus.
        if (!busy) onaction();
      }}
    >
      {actionLabel}
    </button>
  {/if}
</div>

<style>
  .banner {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    border-radius: var(--radius-tile);
    background: var(--color-highlight);
    color: var(--color-ink);
  }

  .title {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: var(--text-label);
    font-weight: 700;
    line-height: 1.4;
  }

  .action {
    align-self: flex-start;
    height: 44px;
    padding: 0 16px;
    border: 1.5px solid var(--color-ink);
    border-radius: 22px;
    background: transparent;
    color: var(--color-ink);
    font-size: var(--text-label);
    font-weight: 700;
  }

  .action[aria-disabled='true'] {
    cursor: progress;
  }

  /* The page focus color (Linen in dark mode) would vanish on Vanilla. */
  .banner :focus-visible {
    outline-color: var(--color-ink);
  }
</style>
