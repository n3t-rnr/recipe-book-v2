<script lang="ts">
  // Small search field of the generator (filterContent(): tag search in the filter sheet), also on the tag
  // page: 44 px, round, search icon 18. The field itself carries the border, so the whole 44 px is its
  // tap target (NF-07); the icon sits on its left padding. Only lazily loaded screens use it (NF-01).
  import Icon from './Icon.svelte';

  interface Props {
    value: string;
    /** Accessible name and placeholder, e.g. „Tags durchsuchen“. */
    label: string;
    /** The <input>, e.g. to give it the focus back. */
    element?: HTMLInputElement | undefined;
  }

  let { value = $bindable(), label, element = $bindable() }: Props = $props();
</script>

<label class="field">
  <Icon name="search" size={18} class="search-icon" />
  <input
    bind:this={element}
    bind:value
    type="search"
    aria-label={label}
    placeholder={label}
    autocomplete="off"
    spellcheck="false"
    enterkeyhint="search"
  />
</label>

<style>
  .field {
    position: relative;
    display: flex;
    min-width: 0;
  }

  /* Artboard: icon at 14 px padding inside the 1.5 px border, 8 px gap to the text. */
  .field :global(.search-icon) {
    position: absolute;
    top: 13px;
    left: 15.5px;
    pointer-events: none;
  }

  input {
    flex: 1;
    min-width: 0;
    height: 44px;
    margin: 0;
    padding: 0 14px 0 40px;
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-chip);
    background: var(--color-input-bg);
    color: var(--color-text);
    font-size: 1rem;
    outline: none;
    appearance: none;
  }

  /* Focus as on the component sheet: 2 px border in text colour plus the focus ring; the text stays put. */
  input:focus {
    padding: 0 13.5px 0 39.5px;
    border: 2px solid var(--color-text);
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  /* One way to clear is enough; WebKit's own cancel button would add a second one. */
  input::-webkit-search-cancel-button {
    appearance: none;
  }
</style>
