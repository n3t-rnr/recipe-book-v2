<script lang="ts">
  // Tag chip of the generator (chip()): inactive = Moonstone with dark text, active = primary surface
  // with check icon (state not by color alone, NF-13), outline = "Alle Tags …" and sort options.
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    active?: boolean;
    /** Recipe count shown after the label (filter sheet). */
    count?: number | null;
    /** toggle: aria-pressed chip; outline: plain action or option. */
    variant?: 'toggle' | 'outline';
    href?: string | undefined;
    onclick?: ((event: MouseEvent) => void) | undefined;
  }

  let { label, active = false, count = null, variant = 'toggle', href, onclick }: Props = $props();

  const classes = $derived(['chip', active ? 'active' : variant === 'outline' ? 'outline' : 'inactive']);
</script>

{#snippet content()}
  {#if active}<Icon name="check" size={18} strokeWidth={2.6} />{/if}
  {label}
  {#if count !== null}<span class="count">{count}</span>{/if}
{/snippet}

{#if href}
  <a class={classes} {href} aria-current={active ? 'true' : undefined} {onclick}>{@render content()}</a>
{:else}
  <button
    type="button"
    class={classes}
    aria-pressed={variant === 'toggle' || active ? active : undefined}
    {onclick}
  >
    {@render content()}
  </button>
{/if}

<style>
  .chip {
    flex-shrink: 0;
    height: 44px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 18px;
    border: 0;
    border-radius: var(--radius-chip);
    font-size: var(--text-label);
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    text-decoration: none;
  }

  .inactive {
    background: var(--color-secondary);
    color: var(--color-ink);
  }

  .active {
    padding: 0 18px 0 14px;
    background: var(--color-primary);
    color: var(--color-on-primary);
    font-weight: 700;
  }

  .outline {
    border: 1.5px solid var(--color-border-strong);
    background: transparent;
    color: var(--color-text);
  }

  .count {
    font-weight: 500;
  }
</style>
