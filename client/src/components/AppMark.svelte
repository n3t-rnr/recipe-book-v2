<script lang="ts">
  // App mark of the profile choice (generator iconMark inside a 64 px tile with 18 px radius): plate
  // and cutlery in the page color on the primary surface; the same motif as the app icon.
  interface Props {
    size?: number;
  }

  let { size = 64 }: Props = $props();
</script>

<span class="mark" style:width={`${size}px`} style:height={`${size}px`} aria-hidden="true">
  <svg viewBox="0 0 128 128">
    <rect class="bg" width="128" height="128"></rect>
    <circle class="plate" cx="68" cy="64" r="30"></circle>
    <circle class="ring" cx="68" cy="64" r="21" fill="none" stroke-width="3"></circle>
    <g class="cutlery" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 34v18"></path>
      <path d="M30 34v18"></path>
      <path d="M38 34v18"></path>
      <path d="M22 52q0 8 8 8q8 0 8-8"></path>
      <path d="M30 60v36"></path>
      <path d="M106 96V34q14 10 14 32q0 6-6 6h-8"></path>
    </g>
  </svg>
</span>

<style>
  .mark {
    display: flex;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: var(--radius-tile);
    background: var(--color-primary);
  }

  svg {
    width: 100%;
    height: 100%;
  }

  .bg {
    fill: var(--color-primary);
  }

  /* Light: Linen on Terracotta; dark: Raisin Black on the lighter dark-mode Terracotta — both --color-bg. */
  .plate {
    fill: var(--color-bg);
  }

  .ring {
    stroke: var(--color-primary);
    stroke-opacity: 0.45;
  }

  .cutlery {
    stroke: var(--color-bg);
  }
</style>
