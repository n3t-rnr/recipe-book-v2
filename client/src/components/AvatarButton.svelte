<script lang="ts">
  // Avatar of the active profile (generator avatarBtn): 44 px target with a 38 px avatar. Opens the
  // profile sheet (F-03). Phones and tablets portrait: top right in the header; ≥ 1024 px: in the rail.
  // The sheet is a separate chunk (NF-01); pressing the button already starts loading it.
  import type { Component } from 'svelte';
  import { de } from '../i18n/de.ts';
  import { ping } from '../lib/api.ts';
  import { mayReloadForChunk } from '../lib/chunk-retry.ts';
  import { lazy } from '../lib/lazy-routes.ts';
  import { profile } from '../state/profile.svelte.ts';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  const loadSheet = lazy(() => import('./ProfileSheet.svelte'));

  let Sheet: Component<{ onclose: () => void }> | null = $state.raw(null);
  let open = $state(false);
  const current = $derived(profile.current);

  function preload(): void {
    loadSheet().catch(() => {});
  }

  async function openSheet(): Promise<void> {
    try {
      Sheet = (await loadSheet()).default;
      open = true;
    } catch {
      // Chunk not reachable: the connection banner explains it. A chunk that failed once stays failed in
      // Chromium's module map, so once the server answers again only a reload brings the sheet back.
      if ((await ping()) && mayReloadForChunk()) location.reload();
    }
  }
</script>

<button
  type="button"
  class="avatar-button"
  aria-label={current ? de.profile.switchLabel(current.name) : de.profile.chooseLabel}
  aria-haspopup="dialog"
  onpointerdown={preload}
  onclick={openSheet}
>
  {#if current}
    <Avatar initials={current.initials} avatar={current.avatar} />
  {:else if profile.id !== null && profile.status !== 'error'}
    <span class="pending" aria-hidden="true"></span>
  {:else}
    <span class="none" aria-hidden="true"><Icon name="users" size={22} /></span>
  {/if}
</button>

{#if open && Sheet}
  <Sheet onclose={() => (open = false)} />
{/if}

<style>
  .avatar-button {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: inherit;
  }

  .pending,
  .none {
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 19px;
  }

  .pending {
    background: var(--color-subtle);
  }

  .none {
    border: 1.5px solid currentColor;
  }
</style>
