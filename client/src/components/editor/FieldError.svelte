<script lang="ts">
  // Inline field error of the component sheet ("Eingabefelder": alert icon + 15/600 text in
  // --color-primary-text). Not color alone: icon and text (NF-13). Inputs point here via aria-describedby.
  import Icon from '../Icon.svelte';

  interface Props {
    id?: string | undefined;
    message: string | undefined;
    /**
     * Announce the message at once (role="alert"): for errors raised by an action in the field, e.g.
     * adding a tag. Errors shown on saving stay quiet; the editor moves focus to the field instead.
     */
    live?: boolean;
  }

  let { id, message, live = false }: Props = $props();
</script>

{#if message}
  <!-- Live: every new message is a new alert element, which screen readers announce on insertion. -->
  {#key live && message}
    <p {id} class="field-error" role={live ? 'alert' : undefined}><Icon name="alert" size={18} />{message}</p>
  {/key}
{/if}

<style>
  .field-error {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--text-label);
    font-weight: 600;
    line-height: 1.4;
    color: var(--color-primary-text);
  }

  .field-error :global(svg) {
    margin-top: 1px;
  }
</style>
