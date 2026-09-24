<script lang="ts">
  // Toast host (component sheet: dark pill, 8 s, "Rückgängig"): one toast at a time from state/toast,
  // above the bottom navigation or the screen's bottom bar (the shell sets --toast-bottom). The timer
  // pauses while the pointer or keyboard focus is on the toast, so the action stays reachable.
  import { toast } from '../state/toast.svelte.ts';

  let paused = $state(false);
  const remaining = new Map<number, number>();

  $effect(() => {
    const item = toast.current;
    if (!item || paused || toast.busy) return;
    const left = remaining.get(item.id) ?? item.durationMs;
    const started = performance.now();
    const timer = setTimeout(() => {
      remaining.delete(item.id);
      toast.dismiss(item.id);
    }, left);
    return () => {
      clearTimeout(timer);
      remaining.set(item.id, Math.max(0, left - (performance.now() - started)));
    };
  });
</script>

<div class="region" aria-live="polite" aria-atomic="true">
  {#if toast.current}
    {@const item = toast.current}
    {#key item.id}
      <!-- svelte-ignore a11y_no_static_element_interactions (pauses the timer only; no action on hover) -->
      <div
        class={['toast', { 'with-action': item.actionLabel !== null }]}
        onpointerenter={(e) => (paused = e.pointerType === 'mouse')}
        onpointerleave={() => (paused = false)}
        onfocusin={() => (paused = true)}
        onfocusout={() => (paused = false)}
      >
        <span class="message">{item.message}</span>
        {#if item.actionLabel !== null}
          <button type="button" class="action" disabled={toast.busy} onclick={() => toast.act(item.id)}>
            {item.actionLabel}
          </button>
        {/if}
      </div>
    {/key}
  {/if}
</div>

<style>
  .region {
    position: fixed;
    left: var(--toast-left, 12px);
    right: var(--toast-right, 12px);
    bottom: var(--toast-bottom, 16px);
    z-index: 40;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  .toast {
    width: 100%;
    max-width: 480px;
    min-height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 18px;
    border-radius: 28px;
    background: var(--color-toast-bg);
    color: var(--color-toast-text);
    font-size: var(--text-label);
    font-weight: 600;
    line-height: 1.4;
    box-shadow: 0 8px 24px var(--color-shadow);
    pointer-events: auto;
    animation: toast-in 180ms ease-out;
  }

  .toast.with-action {
    padding: 6px 8px 6px 18px;
  }

  .action {
    flex-shrink: 0;
    height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: var(--color-toast-text);
    font-size: var(--text-label);
    font-weight: 800;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .action:disabled {
    cursor: progress;
  }

  .toast :focus-visible {
    outline-color: var(--color-toast-text);
    outline-offset: -2px;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
