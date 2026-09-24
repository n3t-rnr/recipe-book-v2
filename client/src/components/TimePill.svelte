<script lang="ts">
  // Total time on the card image (generator timePill): Vanilla surface, dark text, clock icon.
  // The parent positions it (12 px from the left and bottom edge of the image).
  import { de } from '../i18n/de.ts';
  import { formatMinutes } from '../lib/format-list.ts';
  import Icon from './Icon.svelte';

  interface Props {
    minutes: number;
  }

  let { minutes }: Props = $props();
  const text = $derived(formatMinutes(minutes));
</script>

<span class="pill">
  <Icon name="clock" size={16} strokeWidth={2.2} />
  <span aria-hidden="true">{text}</span>
  <span class="visually-hidden">{de.recipe.totalTime(text)}</span>
</span>

<style>
  .pill {
    position: relative;
    height: 32px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    border-radius: 16px;
    background: var(--color-highlight);
    color: var(--color-ink);
    font-size: var(--text-meta);
    font-weight: 700;
    white-space: nowrap;
  }

  /* 1 px Raisin Black border at 20 % in both modes (the design keeps it on Vanilla in dark mode too). */
  .pill::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid var(--color-ink);
    border-radius: inherit;
    opacity: 0.2;
    pointer-events: none;
  }
</style>
