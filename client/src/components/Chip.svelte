<script lang="ts">
  // Tag chip of the generator (chip()): inactive = Moonstone with dark text, active = primary surface
  // with check icon (state not by color alone, NF-13), outline = "Alle Tags …" and sort options.
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    active?: boolean;
    /** Recipe count shown after the label (filter sheet, tag page). */
    count?: number | null;
    /**
     * toggle: aria-pressed chip (chip row, filter sheet); outline: plain action or option;
     * action: the inactive look without a state (a choice such as the merge target).
     */
    variant?: 'toggle' | 'outline' | 'action';
    /** radio: an option of a role="radiogroup" (sort); `active` becomes aria-checked. */
    role?: 'radio' | undefined;
    /** Roving tabindex inside a radiogroup (0 for the checked option, -1 for the others). */
    tabindex?: number | undefined;
    haspopup?: 'dialog' | undefined;
    href?: string | undefined;
    onclick?: ((event: MouseEvent) => void) | undefined;
    /** Early signal of a tap, e.g. to preload the sheet the chip opens. */
    onpointerdown?: ((event: PointerEvent) => void) | undefined;
    onkeydown?: ((event: KeyboardEvent) => void) | undefined;
    /** The rendered <button> or <a>, e.g. to focus the checked option. */
    element?: HTMLElement | null | undefined;
  }

  let {
    label,
    active = false,
    count = null,
    variant = 'toggle',
    role,
    tabindex,
    haspopup,
    href,
    onclick,
    onpointerdown,
    onkeydown,
    element = $bindable(),
  }: Props = $props();

  const classes = $derived(['chip', active ? 'active' : variant === 'outline' ? 'outline' : 'inactive']);
</script>

{#snippet content()}
  {#if active}<Icon name="check" size={18} strokeWidth={2.6} />{/if}
  {label}
  {#if count !== null}<span class="count">{count}</span>{/if}
{/snippet}

{#if href}
  <a bind:this={element} class={classes} {href} aria-current={active ? 'true' : undefined} {onclick}>
    {@render content()}
  </a>
{:else}
  <button
    bind:this={element}
    type="button"
    class={classes}
    {role}
    {tabindex}
    aria-checked={role === 'radio' ? active : undefined}
    aria-pressed={role !== 'radio' && (variant === 'toggle' || active) ? active : undefined}
    aria-haspopup={haspopup}
    {onclick}
    {onpointerdown}
    {onkeydown}
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
