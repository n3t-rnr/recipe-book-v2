<script lang="ts">
  // "Neues Rezept" FAB (generator fab()): 60 px, bottom right above the floating navigation
  // (bottom 100 px on phones, 104 px on tablets portrait). Moves up while a toast is visible.
  import { de } from '../i18n/de.ts';
  import { paths } from '../lib/routes.ts';
  import Icon from './Icon.svelte';

  interface Props {
    href?: string;
    label?: string;
    /** A toast is visible: lift the FAB above it. */
    raised?: boolean;
  }

  let { href = paths.recipeNew(), label = de.nav.newRecipe, raised = false }: Props = $props();
</script>

<a class={['fab', { raised }]} {href} aria-label={label}>
  <Icon name="plus" size={28} strokeWidth={2.4} />
</a>

<style>
  .fab {
    position: fixed;
    right: calc(20px + var(--safe-right));
    bottom: calc(100px + var(--safe-bottom));
    z-index: 21;
    width: var(--fab-size);
    height: var(--fab-size);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 30px;
    background: var(--color-primary);
    color: var(--color-on-primary);
    box-shadow: 0 8px 20px var(--color-shadow);
    transition: transform 200ms ease-out;
  }

  .fab.raised {
    transform: translateY(-68px);
  }

  .fab:active {
    filter: brightness(0.94);
  }

  @media (min-width: 600px) {
    .fab {
      bottom: calc(104px + var(--safe-bottom));
    }
  }
</style>
