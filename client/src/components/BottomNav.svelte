<script lang="ts">
  // Floating dark navigation below 1024 px (generator navBar()): 4 targets, the active one with a
  // primary pill behind the icon and a bold label (Kap. 6.2: icon and indicator, not color alone).
  import { de } from '../i18n/de.ts';
  import type { IconName } from '../lib/icons.ts';
  import { router } from '../lib/router.svelte.ts';
  import { type NavItem, paths } from '../lib/routes.ts';
  import Icon from './Icon.svelte';

  interface Props {
    active: NavItem | null;
  }

  let { active }: Props = $props();

  const items: ReadonlyArray<{ id: NavItem; icon: IconName; label: string; href: string }> = [
    { id: 'recipes', icon: 'book', label: de.nav.recipes, href: paths.recipes() },
    { id: 'favorites', icon: 'heart', label: de.nav.favorites, href: paths.favorites() },
    { id: 'tags', icon: 'tag', label: de.nav.tags, href: paths.tags },
    { id: 'more', icon: 'dotsH', label: de.nav.more, href: paths.more },
  ];
</script>

<nav class="bottom-nav" aria-label={de.nav.main}>
  {#each items as item (item.id)}
    {@const on = item.id === active}
    <a
      class={['item', { on }]}
      href={item.href}
      aria-current={on ? (router.route.path === item.href ? 'page' : 'true') : undefined}
    >
      <span class="pill"><Icon name={item.icon} size={22} /></span>
      {item.label}
    </a>
  {/each}
</nav>

<style>
  .bottom-nav {
    position: fixed;
    left: calc(12px + var(--safe-left));
    right: calc(12px + var(--safe-right));
    bottom: calc(12px + var(--safe-bottom));
    z-index: 20;
    height: 72px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    align-items: center;
    padding: 0 6px;
    border: 1px solid var(--color-nav-border);
    border-radius: 36px;
    background: var(--color-nav);
    box-shadow: 0 8px 24px var(--color-shadow);
  }

  /* Tablet portrait: centered, 456 px wide (artboard: 144 px side insets at 768 px plus 12 px). */
  @media (min-width: 600px) {
    .bottom-nav {
      left: 50%;
      right: auto;
      width: 456px;
      transform: translateX(-50%);
    }
  }

  .item {
    height: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border-radius: 30px;
    color: var(--color-nav-text);
    font-size: var(--text-nav);
    font-weight: 500;
    line-height: 1.2;
    text-decoration: none;
  }

  .item.on {
    font-weight: var(--text-nav-weight);
  }

  .pill {
    width: 52px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 15px;
  }

  .on .pill {
    background: var(--color-nav-active);
    color: var(--color-nav-active-icon);
  }

  /* The page focus color would disappear on the dark bar in light mode. */
  .item:focus-visible {
    outline-color: var(--color-nav-text);
    outline-offset: -2px;
  }
</style>
