<script lang="ts">
  // Navigation rail from 1024 px (generator rail()): 88 px, "Neu" on top, the 4 targets, the avatar
  // at the bottom (F-03: "sonst in der Navigationsleiste links").
  import { de } from '../i18n/de.ts';
  import type { IconName } from '../lib/icons.ts';
  import { router } from '../lib/router.svelte.ts';
  import { type NavItem, paths } from '../lib/routes.ts';
  import AvatarButton from './AvatarButton.svelte';
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

<nav class="rail" aria-label={de.nav.main}>
  <a class="new" href={paths.recipeNew()} aria-label={de.nav.newRecipe}>
    <span class="new-circle"><Icon name="plus" size={26} strokeWidth={2.4} /></span>
    <span aria-hidden="true">{de.nav.new}</span>
  </a>
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
  <span class="spacer"></span>
  <AvatarButton />
</nav>

<style>
  .rail {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 20;
    width: calc(88px + var(--safe-left));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 16px 0 16px var(--safe-left);
    overflow-y: auto;
    border-right: 1px solid var(--color-nav-border);
    background: var(--color-nav);
    color: var(--color-nav-text);
  }

  .new {
    width: 76px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 0 0 12px;
    color: var(--color-nav-text);
    font-size: var(--text-nav);
    font-weight: 600;
    line-height: 1.2;
    text-decoration: none;
  }

  .new-circle {
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 28px;
    background: var(--color-primary);
    color: var(--color-on-primary);
  }

  .item {
    width: 76px;
    height: 64px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border-radius: 16px;
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
    width: 56px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 16px;
  }

  .on .pill {
    background: var(--color-nav-active);
    color: var(--color-nav-active-icon);
  }

  .spacer {
    flex-grow: 1;
  }

  /* The page focus color would disappear on the dark rail in light mode. Only the rail's own controls:
     the profile sheet opened from the avatar sits in the rail's DOM and keeps --color-focus. */
  .new:focus-visible,
  .item:focus-visible,
  .rail > :global(button:focus-visible) {
    outline-color: var(--color-nav-text);
  }
</style>
