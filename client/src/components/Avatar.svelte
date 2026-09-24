<script lang="ts">
  // Profile avatar (generator avatar()): avatar color with its own initial color (≥ 4.5:1 in both
  // modes, NF-13), one or two letters (F-03). Decorative: the surrounding control carries the name.
  import type { AvatarToken } from '../../../shared/schemas.ts';

  interface Props {
    initials: string;
    avatar: AvatarToken;
    /** 38 (header, rail), 48 (component sheet), 64 (profile tiles). */
    size?: 38 | 48 | 64;
  }

  let { initials, avatar, size = 38 }: Props = $props();
</script>

<span class={['avatar', avatar, `s${size}`, { two: initials.length > 1 }]} aria-hidden="true">{initials}</span>

<style>
  .avatar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border);
    font-family: var(--font-display);
    font-weight: 800;
    line-height: 1;
  }

  .s38 {
    width: 38px;
    height: 38px;
    border-radius: 19px;
    font-size: 1.0625rem;
  }

  .s48 {
    width: 48px;
    height: 48px;
    border-radius: 24px;
    font-size: 1.25rem;
  }

  .s48.two {
    font-size: 1.0625rem;
  }

  .s64 {
    width: 64px;
    height: 64px;
    border-radius: 32px;
    font-size: 1.75rem;
  }

  .s64.two {
    font-size: 1.5rem;
  }

  .s38.two {
    font-size: 0.9375rem;
  }

  .avatar-1 {
    background: var(--avatar-1);
    color: var(--avatar-1-fg);
  }

  .avatar-2 {
    background: var(--avatar-2);
    color: var(--avatar-2-fg);
  }

  .avatar-3 {
    background: var(--avatar-3);
    color: var(--avatar-3-fg);
  }

  .avatar-4 {
    background: var(--avatar-4);
    color: var(--avatar-4-fg);
  }

  .avatar-5 {
    background: var(--avatar-5);
    color: var(--avatar-5-fg);
  }

  .avatar-6 {
    background: var(--avatar-6);
    color: var(--avatar-6-fg);
  }
</style>
