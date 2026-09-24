<script lang="ts">
  // Structured ingredients (F-10, generator editorIngredients()): group headings and rows with Menge
  // (inputmode decimal), Einheit (free text, suggestions from F-10), Zutat and Notiz. Below 480 px list
  // width a row has two lines (phone artboard, NF-07 AK), wider lists one line (tablet artboard).
  // Reordering: drag handle (pointer events, the row follows the finger) or arrow keys on the handle,
  // and "Nach oben"/"Nach unten" in the row menu as the visible alternative (NF-07). Removing is
  // immediate with "Rückgängig" (F-35). Enter in the last row's name adds a row (F-10 AK).
  import { tick } from 'svelte';
  import { LIMITS } from '../../../../shared/constants.ts';
  import { deEditor } from '../../i18n/de-editor.ts';
  import {
    countIngredients,
    dragShift,
    dropIndex,
    emptyGroup,
    emptyIngredient,
    errorKey,
    type FieldErrors,
    type ListItem,
    moveItem,
    type RowRect,
  } from '../../lib/editor.ts';
  import Button from '../Button.svelte';
  import Icon from '../Icon.svelte';
  import IconButton from '../IconButton.svelte';
  import FieldError from './FieldError.svelte';
  import RowMenu from './RowMenu.svelte';

  interface Props {
    items: ListItem[];
    errors: FieldErrors;
    onundo: (message: string, undo: () => void) => void;
    announce: (text: string) => void;
  }

  let { items = $bindable(), errors, onundo, announce }: Props = $props();

  const uid = $props.id();
  const PARTS = ['amount', 'unit', 'name', 'note'] as const;
  /** Gap between rows (flex gap of the list); the dragged row's slot is its height plus this gap. */
  const GAP = 8;
  const EDGE = 72;

  const rowEls: Record<string, HTMLElement | null> = {};
  let addRow: HTMLDivElement | undefined = $state();
  let menuKey = $state<string | null>(null);

  interface DragState {
    key: string;
    from: number;
    to: number;
    dy: number;
    distance: number;
  }
  let drag = $state<DragState | null>(null);
  let rects: RowRect[] = [];
  let startY = 0;
  let startScroll = 0;
  let pointerY = 0;
  let scrollFrame = 0;

  /** 1-based number of each ingredient among the ingredients (for "Zutat 3"), 0 for group headings. */
  const numbers = $derived.by(() => {
    let n = 0;
    return items.map((item) => (item.kind === 'ingredient' ? ++n : 0));
  });
  const lastIngredient = $derived(items.findLastIndex((item) => item.kind === 'ingredient'));
  const full = $derived(countIngredients(items) >= LIMITS.ingredients);
  const menuIndex = $derived(menuKey === null ? -1 : items.findIndex((item) => item.key === menuKey));
  const menuItem = $derived(menuIndex === -1 ? undefined : items[menuIndex]);

  function focusId(id: string): void {
    void tick().then(() => document.getElementById(id)?.focus());
  }

  function addIngredient(): void {
    if (full) return;
    const item = emptyIngredient();
    items.push(item);
    focusId(`${uid}-amount-${item.key}`);
  }

  function addGroup(): void {
    if (full) return;
    const group = emptyGroup();
    items.push(group, emptyIngredient());
    focusId(`${uid}-group-${group.key}`);
  }

  /** Enter in name or note of the last ingredient adds a row and focuses its amount (F-10 AK). */
  function onLastKeydown(event: KeyboardEvent, index: number): void {
    if (event.key !== 'Enter' || event.isComposing || event.shiftKey || index !== lastIngredient) return;
    event.preventDefault();
    addIngredient();
  }

  /** `speak` = false for the row menu: it announces in its own live region (the page's is inert then). */
  function moveBy(index: number, delta: -1 | 1, speak = true): boolean {
    if (!moveItem(items, index, index + delta)) return false;
    if (speak) announce(deEditor.menu.position(index + delta + 1, items.length));
    return true;
  }

  function onGripKeydown(event: KeyboardEvent, index: number): void {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const key = items[index]?.key;
    if (key && moveBy(index, delta)) focusId(`${uid}-grip-${key}`);
  }

  // ---------------------------------------------------------------- drag and drop

  function measure(): void {
    rects = items.map((item) => {
      const rect = rowEls[item.key]?.getBoundingClientRect();
      return { top: (rect?.top ?? 0) + window.scrollY, height: rect?.height ?? 0 };
    });
  }

  function onGripDown(event: PointerEvent, index: number): void {
    if (drag || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const item = items[index];
    if (!item) return;
    event.preventDefault();
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone (released before the handler ran): the drag ends with pointerup.
    }
    measure();
    startY = event.clientY;
    pointerY = event.clientY;
    startScroll = window.scrollY;
    drag = { key: item.key, from: index, to: index, dy: 0, distance: (rects[index]?.height ?? 0) + GAP };
  }

  function updateDrag(): void {
    if (!drag) return;
    const rect = rects[drag.from];
    if (!rect) return;
    const dy = pointerY - startY + (window.scrollY - startScroll);
    drag.dy = dy;
    drag.to = dropIndex(rects, drag.from, rect.top + rect.height / 2 + dy);
  }

  /** Scrolls the page while the finger is near the top or the save bar, so long lists can be sorted. */
  function autoScroll(): void {
    scrollFrame = 0;
    if (!drag) return;
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const bottomEdge = viewport - 96 - EDGE;
    const speed = pointerY < EDGE ? -(EDGE - pointerY) / 4 : pointerY > bottomEdge ? (pointerY - bottomEdge) / 4 : 0;
    if (speed === 0) return;
    window.scrollBy(0, Math.max(-18, Math.min(18, speed)));
    updateDrag();
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function onGripMove(event: PointerEvent): void {
    if (!drag) return;
    pointerY = event.clientY;
    updateDrag();
    if (scrollFrame === 0) scrollFrame = requestAnimationFrame(autoScroll);
  }

  function endDrag(commit: boolean): void {
    if (!drag) return;
    const { from, to, key } = drag;
    drag = null;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    if (commit && from !== to && moveItem(items, from, to)) {
      announce(deEditor.menu.position(to + 1, items.length));
      focusId(`${uid}-grip-${key}`);
    }
  }

  function offsetOf(index: number, key: string): number {
    if (!drag) return 0;
    return key === drag.key ? drag.dy : dragShift(index, drag.from, drag.to, drag.distance);
  }

  // ---------------------------------------------------------------- row menu

  function remove(): void {
    const index = menuIndex;
    const item = items[index];
    if (!item) return;
    menuKey = null;
    items.splice(index, 1);
    onundo(item.kind === 'group' ? deEditor.ingredients.groupRemoved : deEditor.ingredients.removed, () => {
      if (items.some((i) => i.key === item.key)) return;
      items.splice(Math.min(index, items.length), 0, item);
      focusId(item.kind === 'group' ? `${uid}-group-${item.key}` : `${uid}-name-${item.key}`);
    });
    void tick().then(() => {
      const next = items[Math.min(index, items.length - 1)];
      const target = next ? rowEls[next.key]?.querySelector<HTMLElement>('[aria-haspopup]') : null;
      (target ?? addRow?.querySelector('button'))?.focus();
    });
  }
</script>

<div class="ingredients">
  <ol class={['list', { dragging: drag !== null }]}>
    {#each items as item, i (item.key)}
      {@const offset = offsetOf(i, item.key)}
      <li
        bind:this={rowEls[item.key]}
        class={['item', { dragged: drag?.key === item.key }]}
        style:transform={offset !== 0 ? `translateY(${offset}px)` : undefined}
      >
        {#if item.kind === 'group'}
          {@const message = errors[errorKey.item(item.key, 'group')]}
          <div class="group-row">
            <input
              id="{uid}-group-{item.key}"
              class={['group-input', { invalid: message }]}
              type="text"
              autocomplete="off"
              enterkeyhint="next"
              aria-label={deEditor.ingredients.group}
              placeholder={deEditor.ingredients.groupPlaceholder}
              aria-invalid={message ? 'true' : undefined}
              aria-describedby={message ? `${uid}-err-${item.key}-group` : undefined}
              bind:value={item.name}
            />
            <IconButton
              icon="dotsV"
              label={deEditor.ingredients.groupMenu}
              haspopup="dialog"
              onclick={() => (menuKey = item.key)}
            />
          </div>
          <FieldError id="{uid}-err-{item.key}-group" {message} />
        {:else}
          <div class="row" role="group" aria-label={deEditor.ingredients.row(numbers[i] ?? 0)}>
            <div class="fields">
              <button
                id="{uid}-grip-{item.key}"
                type="button"
                class="grip"
                aria-label={deEditor.ingredients.move}
                aria-keyshortcuts="ArrowUp ArrowDown"
                onpointerdown={(e) => onGripDown(e, i)}
                onpointermove={onGripMove}
                onpointerup={() => endDrag(true)}
                onpointercancel={() => endDrag(false)}
                onlostpointercapture={() => endDrag(true)}
                onkeydown={(e) => onGripKeydown(e, i)}
              >
                <Icon name="grip" size={22} />
              </button>
              {#each PARTS as part (part)}
                {@const message = errors[errorKey.item(item.key, part)]}
                <input
                  id="{uid}-{part}-{item.key}"
                  class={['input', part, { invalid: message }]}
                  type="text"
                  inputmode={part === 'amount' ? 'decimal' : undefined}
                  autocomplete="off"
                  spellcheck={part === 'amount' || part === 'unit' ? 'false' : undefined}
                  enterkeyhint={i === lastIngredient && (part === 'name' || part === 'note') ? 'enter' : 'next'}
                  list={part === 'unit' ? `${uid}-units` : undefined}
                  aria-label={deEditor.ingredients[part]}
                  placeholder={deEditor.ingredients[part]}
                  aria-invalid={message ? 'true' : undefined}
                  aria-describedby={message ? `${uid}-err-${item.key}-${part}` : undefined}
                  onkeydown={part === 'name' || part === 'note' ? (e) => onLastKeydown(e, i) : undefined}
                  bind:value={item[part]}
                />
              {/each}
              <span class="break" aria-hidden="true"></span>
              <IconButton
                icon="dotsV"
                label={deEditor.ingredients.menu}
                haspopup="dialog"
                class="menu"
                onclick={() => (menuKey = item.key)}
              />
            </div>
            {#each PARTS as part (part)}
              <FieldError id="{uid}-err-{item.key}-{part}" message={errors[errorKey.item(item.key, part)]} />
            {/each}
          </div>
        {/if}
      </li>
    {/each}
  </ol>
  <FieldError message={errors.ingredients} />
  <div class="add" bind:this={addRow}>
    <Button variant="outline" size={44} icon="plus" disabled={full} onclick={addIngredient}>
      <span class="visually-hidden">{deEditor.ingredients.addIngredientLabel}</span><span aria-hidden="true"
        >{deEditor.ingredients.addIngredient}</span
      >
    </Button>
    <Button variant="outline" size={44} icon="plus" disabled={full} onclick={addGroup}>
      <span class="visually-hidden">{deEditor.ingredients.addGroupLabel}</span><span aria-hidden="true"
        >{deEditor.ingredients.addGroup}</span
      >
    </Button>
  </div>
  {#if full}<p class="limit">{deEditor.ingredients.limit(LIMITS.ingredients)}</p>{/if}
  <datalist id="{uid}-units">
    {#each deEditor.unitSuggestions as unit (unit)}
      <option value={unit}></option>
    {/each}
  </datalist>
</div>

{#if menuItem}
  <RowMenu
    title={menuItem.kind === 'group'
      ? menuItem.name.trim() || deEditor.menu.group
      : menuItem.name.trim() || deEditor.menu.ingredient}
    meta={deEditor.menu.position(menuIndex + 1, items.length)}
    canUp={menuIndex > 0}
    canDown={menuIndex < items.length - 1}
    onup={() => moveBy(menuIndex, -1, false)}
    ondown={() => moveBy(menuIndex, 1, false)}
    onremove={remove}
    onclose={() => (menuKey = null)}
  />
{/if}

<style>
  .ingredients {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .list.dragging .item:not(.dragged) {
    transition: transform 150ms ease-out;
  }

  .item.dragged {
    position: relative;
    z-index: 2;
  }

  .item.dragged .row {
    box-shadow: 0 8px 24px var(--color-shadow);
  }

  /* Group heading: underlined 16/700 field of the artboard, row menu on the right. */
  .group-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .group-input {
    flex-grow: 1;
    min-width: 0;
    height: 44px;
    padding: 0 2px;
    border: 0;
    border-bottom: 1.5px solid var(--color-border-strong);
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    font-size: 1rem;
    font-weight: 700;
    appearance: none;
  }

  .group-input.invalid {
    border-bottom: 2px solid var(--color-primary-text);
  }

  /* Phone artboard: two lines (grip · Menge · Einheit · menu / Zutat · Notiz), 8 px padding, 18 px radius.
     The DOM keeps the reading order grip, Menge, Einheit, Zutat, Notiz, menu; `order` builds the lines. */
  .row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-tile);
    background: var(--color-surface);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 6px;
    row-gap: 0;
  }

  .grip {
    order: 1;
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
    color: var(--color-text-muted);
    cursor: grab;
    touch-action: none;
  }

  .list.dragging .grip {
    cursor: grabbing;
  }

  .fields > .input.amount {
    order: 2;
    width: 72px;
  }

  .fields > .input.unit {
    order: 3;
    width: 88px;
  }

  .fields > :global(.menu) {
    order: 4;
    margin-left: auto;
  }

  .break {
    order: 5;
    flex-basis: 100%;
    height: 0;
  }

  .fields > .input.name {
    order: 6;
    flex: 1 1 0;
    margin-top: 6px;
  }

  .fields > .input.note {
    order: 7;
    width: 120px;
    margin-top: 6px;
  }

  /* Tablet artboard: one line, 6 px padding, 16 px radius; Menge 64, Einheit 76, Notiz 100 px. */
  @container (min-width: 480px) {
    .row {
      padding: 6px;
      border-radius: var(--radius-row);
    }

    .fields {
      flex-wrap: nowrap;
    }

    .grip,
    .fields > .input.amount,
    .fields > .input.unit,
    .fields > .input.name,
    .fields > .input.note,
    .fields > :global(.menu) {
      order: 0;
      margin: 0;
    }

    .fields > .input.amount {
      width: 64px;
    }

    .fields > .input.unit {
      width: 76px;
    }

    .fields > .input.note {
      width: 100px;
    }

    .break {
      display: none;
    }
  }

  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .limit {
    font-size: var(--text-meta);
    color: var(--color-text-muted);
  }
</style>
