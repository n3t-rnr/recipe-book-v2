<script lang="ts">
  // Plate illustration of the design (generator plateSvg): plate, inner ring, fork and knife, optional
  // first letter. Light: translucent white plate with ink lines on the colored surface around it.
  // Dark: the plate itself carries the placeholder color on a dark surface (docs/design/README.md).
  // Inline SVG without extra request (F-16); colors only via tokens (NF-12).

  interface Props {
    /** Placeholder color 1–4 (--placeholder-n). */
    color: 1 | 2 | 3 | 4;
    letter?: string;
    cutlery?: boolean;
  }

  let { color, letter = '', cutlery = true }: Props = $props();
</script>

<svg class={['plate-svg', `ph-${color}`]} viewBox="0 0 240 160" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <circle class="plate" cx="120" cy="80" r="50" stroke-width="2"></circle>
  <circle class="ring" cx="120" cy="80" r="38" fill="none" stroke-width="1.5"></circle>
  {#if letter}
    <text class="letter" x="120" y="82" text-anchor="middle" dominant-baseline="central">{letter}</text>
  {/if}
  {#if cutlery}
    <g class="cutlery" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M42 44v20"></path>
      <path d="M50 44v20"></path>
      <path d="M58 44v20"></path>
      <path d="M42 64q0 8 8 8q8 0 8-8"></path>
      <path d="M50 72v46"></path>
      <path d="M190 118V44q14 10 14 34q0 6-6 6h-8"></path>
    </g>
  {/if}
</svg>

<style>
  .plate-svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* Light: plate white at 42 % with an ink outline at 32 %, ring ink 20 %, cutlery ink 50 %. */
  .plate {
    fill: var(--color-on-dark);
    fill-opacity: 0.42;
    stroke: var(--color-ink);
    stroke-opacity: 0.32;
  }

  .ring {
    stroke: var(--color-ink);
    stroke-opacity: 0.2;
  }

  .cutlery {
    stroke: var(--color-ink);
    stroke-opacity: 0.5;
  }

  .letter {
    fill: var(--color-ink);
    font-family: var(--font-display);
    font-size: 40px;
    font-weight: 800;
  }

  /* Dark: plate, outline and cutlery in the placeholder color, ring ink 0.26. Both selectors mirror
     the theme switch of tokens.css (system dark unless forced light, or forced dark). */
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .plate {
      fill: var(--ph);
      fill-opacity: 1;
      stroke: var(--ph);
      stroke-opacity: 1;
    }

    :global(:root:not([data-theme="light"])) .ring {
      stroke-opacity: 0.26;
    }

    :global(:root:not([data-theme="light"])) .cutlery {
      stroke: var(--ph);
      stroke-opacity: 1;
    }
  }

  :global(:root[data-theme="dark"]) .plate {
    fill: var(--ph);
    fill-opacity: 1;
    stroke: var(--ph);
    stroke-opacity: 1;
  }

  :global(:root[data-theme="dark"]) .ring {
    stroke-opacity: 0.26;
  }

  :global(:root[data-theme="dark"]) .cutlery {
    stroke: var(--ph);
    stroke-opacity: 1;
  }
</style>
