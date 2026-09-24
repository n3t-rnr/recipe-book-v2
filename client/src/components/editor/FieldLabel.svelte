<script lang="ts">
  // Field label of the generator (fieldLabel()): 15/700 label left, optional 14/500 muted hint right
  // ("Pflichtfeld", "optional").
  interface Props {
    /** id of the input; without it the label is plain text (a group heading). */
    for?: string | undefined;
    text: string;
    hint?: string | undefined;
  }

  let { for: htmlFor, text, hint }: Props = $props();
</script>

<div class="label-row">
  {#if htmlFor}
    <label class="label" for={htmlFor}>{text}</label>
  {:else}
    <span class="label">{text}</span>
  {/if}
  {#if hint}<span class="hint">{hint}</span>{/if}
</div>

<style>
  .label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    line-height: 1.4;
  }

  .label {
    font-size: var(--text-label);
    font-weight: 700;
  }

  .hint {
    font-size: var(--text-meta);
    font-weight: 500;
    color: var(--color-text-muted);
  }
</style>
