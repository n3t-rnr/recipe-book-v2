<script lang="ts">
  // Empty and error state (component sheet "Leerzustand", F-33): plate illustration, title, text and
  // one primary action; further actions go into `children`.
  import type { Snippet } from 'svelte';
  import type { IconName } from '../lib/icons.ts';
  import Button from './Button.svelte';
  import Plate from './Plate.svelte';

  interface Props {
    title: string;
    text?: string | undefined;
    /** Plate illustration (default) or none, e.g. for compact error states. */
    illustration?: boolean;
    actionLabel?: string | undefined;
    actionIcon?: IconName | undefined;
    actionHref?: string | undefined;
    onaction?: (() => void) | undefined;
    /** Heading level of the title (2 inside a page, 1 when it is the page content). */
    level?: 1 | 2;
    children?: Snippet | undefined;
  }

  let {
    title,
    text,
    illustration = true,
    actionLabel,
    actionIcon = 'plus',
    actionHref,
    onaction,
    level = 2,
    children,
  }: Props = $props();
</script>

<div class="empty">
  {#if illustration}
    <div class="art"><Plate color={1} /></div>
  {/if}
  {#if level === 1}
    <h1 class="title">{title}</h1>
  {:else}
    <h2 class="title">{title}</h2>
  {/if}
  {#if text}<p class="text">{text}</p>{/if}
  {#if actionLabel && (actionHref || onaction)}
    <Button size={52} icon={actionIcon} href={actionHref} onclick={onaction}>{actionLabel}</Button>
  {/if}
  {@render children?.()}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    text-align: center;
  }

  .art {
    width: 180px;
    height: 120px;
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.3px;
  }

  .text {
    max-width: 32rem;
    font-size: var(--text-label);
    line-height: 1.5;
    color: var(--color-text-muted);
  }
</style>
