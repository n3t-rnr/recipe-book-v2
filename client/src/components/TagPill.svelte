<script lang="ts">
  // Tag display in cards (generator tagPill): not tappable, Moonstone with dark text.
  interface Props {
    label: string;
    /** Screen reader text when the visible label is terse ("+2" → "2 weitere Tags"). */
    srLabel?: string | undefined;
  }

  let { label, srLabel }: Props = $props();
</script>

{#if srLabel}
  <span class="pill"><span aria-hidden="true">{label}</span><span class="visually-hidden">{srLabel}</span></span>
{:else}
  <span class="pill">{label}</span>
{/if}

<style>
  .pill {
    height: 28px;
    display: flex;
    align-items: center;
    padding: 0 10px;
    border-radius: 14px;
    background: var(--color-secondary);
    color: var(--color-ink);
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
  }
</style>
