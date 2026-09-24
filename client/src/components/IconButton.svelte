<script lang="ts">
  // Round icon-only button (generator iconBtn/overlayBtn): 44 px plain, outlined (refresh on the
  // component sheet) or 48 px on a 92 % surface over photos (NF-13). Always has an aria-label (NF-11).
  import type { IconName } from '../lib/icons.ts';
  import Icon from './Icon.svelte';

  interface Props {
    icon: IconName;
    label: string;
    variant?: 'plain' | 'outline' | 'overlay';
    /** Tap target: 44 (default) or 48 for kitchen actions (NF-07). */
    size?: 44 | 48;
    iconSize?: number;
    strokeWidth?: number;
    /** Toggle state for aria-pressed. */
    pressed?: boolean | undefined;
    href?: string | undefined;
    disabled?: boolean;
    haspopup?: 'dialog' | 'menu' | undefined;
    onclick?: ((event: MouseEvent) => void) | undefined;
    class?: string;
  }

  let {
    icon,
    label,
    variant = 'plain',
    size,
    iconSize,
    strokeWidth = 2,
    pressed,
    href,
    disabled = false,
    haspopup,
    onclick,
    class: className = '',
  }: Props = $props();

  const box = $derived(size ?? (variant === 'overlay' ? 48 : 44));
  const glyph = $derived(iconSize ?? (variant === 'overlay' ? 24 : 22));
  const classes = $derived(['icon-button', variant, box === 48 ? 's48' : 's44', className]);
</script>

{#if href}
  <a class={classes} {href} aria-label={label} {onclick}>
    <Icon name={icon} size={glyph} {strokeWidth} />
  </a>
{:else}
  <button
    type="button"
    class={classes}
    aria-label={label}
    aria-pressed={pressed}
    aria-haspopup={haspopup}
    {disabled}
    {onclick}
  >
    <Icon name={icon} size={glyph} {strokeWidth} />
  </button>
{/if}

<style>
  .icon-button {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-decoration: none;
  }

  .s44 {
    width: 44px;
    height: 44px;
    border-radius: 22px;
  }

  .s48 {
    width: 48px;
    height: 48px;
    border-radius: 24px;
  }

  .outline {
    border: 1.5px solid var(--color-border-strong);
  }

  .overlay {
    border: 1px solid var(--color-overlay-border);
    background: var(--color-overlay);
    color: var(--color-text);
  }

  .plain:active,
  .outline:active {
    background: var(--color-subtle);
  }

  .icon-button:disabled {
    cursor: default;
    color: var(--color-text-muted);
  }
</style>
