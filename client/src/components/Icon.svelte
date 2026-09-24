<script lang="ts">
  // Stroke icon from the inline SVG sprite in index.html (NF-15), drawn with currentColor.
  // Decorative unless `label` is given. Filled glyphs (dots, grip) carry their own fill in the sprite.
  import type { IconName } from '../lib/icons.ts';

  interface Props {
    name: IconName;
    /** 20 or 24 in the design; smaller sizes appear inside chips and pills. */
    size?: number;
    strokeWidth?: number;
    /** Accessible name; without it the icon is hidden from assistive technology. */
    label?: string | undefined;
    class?: string;
  }

  let { name, size = 24, strokeWidth = 2, label, class: className = '' }: Props = $props();
</script>

<svg
  class={['icon', className]}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  <use href="#i-{name}"></use>
</svg>

<style>
  .icon {
    flex-shrink: 0;
  }
</style>
