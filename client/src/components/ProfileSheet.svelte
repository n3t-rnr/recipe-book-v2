<script lang="ts">
  // Profile switch (F-03): all profiles as tiles like the profile choice (132 px, avatar 64); one tap
  // on a tile switches, so avatar → tile are exactly two taps. The active tile has a primary border and
  // a check badge (not color alone, NF-13). "Neues Profil" opens the profile choice with the form.
  import { onMount } from 'svelte';
  import { de } from '../i18n/de.ts';
  import { paths } from '../lib/routes.ts';
  import { profile } from '../state/profile.svelte.ts';
  import Avatar from './Avatar.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  onMount(() => {
    // Another device may have added a profile since the list was loaded.
    void profile.load();
  });

  function choose(id: number): void {
    profile.select(id);
    onclose();
  }
</script>

<Sheet title={de.profile.switchTitle} {onclose}>
  {#if profile.list.length === 0 && profile.status === 'error'}
    <p class="error"><Icon name="alert" size={20} />{profile.error?.message ?? de.profile.loadFailed}</p>
    <div><Button variant="outline" size={44} onclick={() => profile.load()}>{de.common.retry}</Button></div>
  {:else}
    <ul class="tiles" aria-busy={profile.list.length === 0}>
      {#if profile.list.length === 0}
        {#each [1, 2] as n (n)}
          <li class="tile skeleton" aria-hidden="true"></li>
        {/each}
      {/if}
      {#each profile.list as p (p.id)}
        {@const active = p.id === profile.id}
        <li>
          <button
            type="button"
            class={['tile', { active }]}
            aria-current={active ? 'true' : undefined}
            onclick={() => choose(p.id)}
          >
            <Avatar initials={p.initials} avatar={p.avatar} size={64} />
            <span class="name">{p.name}</span>
            {#if active}
              <span class="badge"><Icon name="check" size={15} strokeWidth={3} /></span>
              <span class="visually-hidden">({de.profile.active})</span>
            {/if}
          </button>
        </li>
      {/each}
      <li>
        <a class="tile add" href={paths.profile({ neu: true })}>
          <span class="plus"><Icon name="plus" size={28} strokeWidth={2.2} /></span>
          <span class="name">{de.profile.newProfile}</span>
        </a>
      </li>
    </ul>
    <p class="hint">{de.profile.hint}</p>
  {/if}
</Sheet>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding: 0;
    list-style: none;
  }

  @media (min-width: 600px) {
    .tiles {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .tile {
    position: relative;
    width: 100%;
    height: 132px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 0 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-step);
    font-weight: 700;
    text-decoration: none;
  }

  .tile.active {
    border: 2px solid var(--color-primary);
  }

  .tile.add {
    border: 2px dashed var(--color-border-strong);
    background: transparent;
  }

  .tile.skeleton {
    background: var(--color-subtle);
    border-color: transparent;
  }

  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    background: var(--color-primary);
    color: var(--color-on-primary);
  }

  .plus {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--color-border-strong);
    border-radius: 32px;
  }

  .hint {
    font-size: var(--text-label);
    line-height: 1.5;
    color: var(--color-text-muted);
  }

  .error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: var(--text-label);
    font-weight: 600;
    color: var(--color-danger-text);
  }
</style>
