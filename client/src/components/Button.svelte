<script lang="ts">
  // Text buttons of the generator: primaryBtn, outlineBtn and textBtn. Heights 44/48/52/56 with fully
  // round ends; kitchen actions such as Speichern use ≥ 48 (NF-07).
  import type { Snippet } from 'svelte';
  import type { IconName } from '../lib/icons.ts';
  import Icon from './Icon.svelte';

  interface Props {
    variant?: 'primary' | 'outline' | 'text';
    /** Height in px; the text variant is always 44. */
    size?: 44 | 48 | 52 | 56;
    icon?: IconName | undefined;
    /** Icon after the label (text variant, e.g. chevron). */
    trailingIcon?: IconName | undefined;
    /** Text variant: underline (default) or plain. */
    underline?: boolean;
    full?: boolean;
    grow?: boolean;
    href?: string | undefined;
    type?: 'button' | 'submit';
    disabled?: boolean;
    /**
     * Shows the button as busy and blocks double submits (NF-09). It stays focusable (aria-disabled
     * instead of disabled), so keyboard focus is not lost to <body> while the request runs (NF-11).
     */
    busy?: boolean;
    onclick?: ((event: MouseEvent) => void) | undefined;
    children: Snippet;
    class?: string;
    /** The rendered <button> or <a>, e.g. to give it the focus back after a form closes. */
    element?: HTMLElement | null | undefined;
  }

  let {
    variant = 'primary',
    size = 56,
    icon,
    trailingIcon,
    underline = true,
    full = false,
    grow = false,
    href,
    type = 'button',
    disabled = false,
    busy = false,
    onclick,
    children,
    class: className = '',
    element = $bindable(),
  }: Props = $props();

  const classes = $derived([
    'button',
    variant,
    variant === 'text' ? 's44' : `s${size}`,
    { full, grow, plain: variant === 'text' && !underline },
    className,
  ]);
  const iconStroke = $derived(variant === 'primary' ? 2.2 : 2);

  /** Busy: the click (and a submit button's form submission) does nothing. */
  function ignore(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

{#snippet content()}
  {#if icon}<Icon name={icon} size={20} strokeWidth={iconStroke} />{/if}
  {@render children()}
  {#if trailingIcon}<Icon name={trailingIcon} size={18} />{/if}
{/snippet}

{#if href && !disabled}
  <a bind:this={element} class={classes} {href} {onclick}>{@render content()}</a>
{:else}
  <button
    bind:this={element}
    {type}
    class={classes}
    disabled={disabled && !busy}
    aria-disabled={busy || undefined}
    aria-busy={busy || undefined}
    onclick={busy ? ignore : onclick}
  >
    {@render content()}
  </button>
{/if}

<style>
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    white-space: nowrap;
    font-size: var(--text-body);
    font-weight: 700;
    line-height: 1.2;
    text-decoration: none;
  }

  .s44 {
    height: 44px;
    border-radius: 22px;
  }

  .s48 {
    height: 48px;
    border-radius: 24px;
  }

  .s52 {
    height: 52px;
    border-radius: 26px;
  }

  .s56 {
    height: 56px;
    border-radius: 28px;
  }

  .primary {
    padding: 0 24px;
    border: 0;
    background: var(--color-primary);
    color: var(--color-on-primary);
  }

  .outline {
    padding: 0 22px;
    border: 1.5px solid var(--color-border-strong);
    background: transparent;
    color: var(--color-text);
  }

  .text {
    gap: 4px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font-size: var(--text-label);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .text.plain {
    text-decoration: none;
  }

  .full {
    width: 100%;
  }

  .grow {
    flex-grow: 1;
  }

  .primary:active {
    filter: brightness(0.94);
  }

  .outline:active {
    background: var(--color-subtle);
  }

  /* Disabled primary from the component sheet: subtle surface with muted text. Busy looks the same. */
  .primary:disabled,
  .primary[aria-disabled="true"] {
    background: var(--color-subtle);
    color: var(--color-text-muted);
    cursor: default;
  }

  .outline:disabled,
  .text:disabled,
  .outline[aria-disabled="true"],
  .text[aria-disabled="true"] {
    color: var(--color-text-muted);
    cursor: default;
  }

  .button[aria-busy="true"] {
    cursor: progress;
  }
</style>
