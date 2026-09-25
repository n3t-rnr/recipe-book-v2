// Wiring of the editor page (routes/RecipeEdit.svelte) that the unit tests cannot render: the empty title's
// hint waits for the end of a press (b4), and dialog actions that save never let the dialog's history step
// overlap the release of the back guard (d3, d4). The E2E specs recipe-editor.spec.ts (b4) and
// drafts-conflict-trash.spec.ts (d3, d4) check the behavior in the browsers; this checks the sources.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const EDITOR = fs.readFileSync(
  fileURLToPath(new URL('../../client/src/routes/RecipeEdit.svelte', import.meta.url)),
  'utf8',
);

/** Body of `function name(…) { … }` in the component's script (balanced braces). */
function body(name: string): string {
  const start = EDITOR.search(new RegExp(`function ${name}\\(`));
  if (start < 0) throw new Error(`no function ${name}`);
  const open = EDITOR.indexOf('{', EDITOR.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < EDITOR.length; i++) {
    if (EDITOR[i] === '{') depth++;
    if (EDITOR[i] === '}' && --depth === 0) return EDITOR.slice(open + 1, i);
  }
  throw new Error(`unbalanced function ${name}`);
}

/** Body of the onMount callback, including the cleanup it returns. */
function onMountBody(): string {
  const start = EDITOR.indexOf('onMount(() => {');
  if (start < 0) throw new Error('no onMount');
  const open = EDITOR.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < EDITOR.length; i++) {
    if (EDITOR[i] === '{') depth++;
    if (EDITOR[i] === '}' && --depth === 0) return EDITOR.slice(open + 1, i);
  }
  throw new Error('unbalanced onMount');
}

describe('the empty title hint waits for the end of a press (b4, F-06 AK)', () => {
  it('is set through onTitleBlur, not directly on blur', () => {
    expect(EDITOR).toMatch(/onblur=\{onTitleBlur\}/);
    expect(EDITOR).not.toMatch(/onblur=\{\(\) => \(titleTouched = true\)\}/);
  });

  it('waits while a pointer is down and else shows after the current event (its click)', () => {
    const blur = body('onTitleBlur');
    expect(blur).toMatch(/if \(pressing\) hintAfterPress = true;/);
    expect(blur).toMatch(/else setTimeout\(\(\) => \(titleTouched = true\)\)/);
  });

  it('shows the waiting hint once the pointer is up or the press is cancelled', () => {
    const pointer = body('onPointer');
    expect(pointer).toMatch(/pressing = event\.type === 'pointerdown'/);
    expect(pointer).toMatch(
      /if \(!pressing && hintAfterPress\) \{\s*hintAfterPress = false;\s*onTitleBlur\(\);/,
    );
  });

  it('follows every press of the page (capture) while the editor is open', () => {
    const mount = onMountBody();
    expect(mount).toMatch(/const pointerEvents = \['pointerdown', 'pointerup', 'pointercancel'\]/);
    expect(mount).toMatch(/window\.addEventListener\(type, onPointer, true\)/);
    const cleanup = mount.slice(mount.indexOf('return () =>'));
    expect(cleanup).toMatch(/window\.removeEventListener\(type, onPointer, true\)/);
  });

  it('keeps the rule itself: an empty title is an error once touched or once other input changed', () => {
    expect(EDITOR).toMatch(
      /form\.title\.trim\(\) === '' && \(titleTouched \|\| textDirty\) \? deEditor\.title\.missing/,
    );
    expect(EDITOR).toMatch(/const canSave = \$derived\(phase === 'ready' && form\.title\.trim\(\) !== ''\)/);
  });
});

describe('dialog actions that save close the dialog before the guard is released (d3, d4)', () => {
  it('close through closeDialog, never by clearing the dialog directly', () => {
    for (const name of ['saveMine', 'restoreAndSave', 'saveAsNew']) {
      const action = body(name);
      expect(action, name).not.toMatch(/dialog = null/);
      const close = action.indexOf('closeDialog()');
      expect(close, name).toBeGreaterThan(-1);
      expect(action.indexOf('save(', close), name).toBeGreaterThan(close);
    }
  });

  it('closeDialog remembers the closing step and hands it out also when no dialog is open', () => {
    const close = body('closeDialog');
    expect(close).toMatch(
      /dialogClosed = tick\(\)\.then\(\(\) => \(pending \? nextPopstate\(\) : undefined\)\)/,
    );
    // The return stands outside `if (dialog)`: finishSaved waits for a close started by the action.
    expect(close.trimEnd().endsWith('return dialogClosed;')).toBe(true);
    expect(close).not.toMatch(/if \(!dialog\) return;/);
  });

  it('finishSaved and leave wait for the dialog before releasing the guard', () => {
    for (const name of ['finishSaved', 'leave']) {
      const flow = body(name);
      const close = flow.indexOf('await closeDialog()');
      expect(close, name).toBeGreaterThan(-1);
      expect(flow.indexOf('await releaseGuard()'), name).toBeGreaterThan(close);
    }
  });
});
