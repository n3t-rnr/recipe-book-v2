// Arrow keys of the radio groups in the filter sheet (sort options, „Alle müssen passen | Einer reicht“):
// NF-11 „volle Tastaturbedienung“, WAI-ARIA radio group pattern (client/src/lib/radio-keys.ts).
import { describe, expect, it } from 'vitest';
import { radioKeys } from '../../client/src/lib/radio-keys.ts';

describe('radioKeys (NF-11)', () => {
  it('moves forward with ArrowRight and ArrowDown and wraps after the last option', () => {
    expect(radioKeys('ArrowRight', 0, 3)).toBe(1);
    expect(radioKeys('ArrowDown', 1, 3)).toBe(2);
    expect(radioKeys('ArrowRight', 2, 3)).toBe(0);
    expect(radioKeys('ArrowDown', 2, 3)).toBe(0);
  });

  it('moves back with ArrowLeft and ArrowUp and wraps before the first option', () => {
    expect(radioKeys('ArrowLeft', 2, 3)).toBe(1);
    expect(radioKeys('ArrowUp', 1, 3)).toBe(0);
    expect(radioKeys('ArrowLeft', 0, 3)).toBe(2);
    expect(radioKeys('ArrowUp', 0, 2)).toBe(1);
  });

  it('jumps to the first and the last option with Home and End', () => {
    expect(radioKeys('Home', 2, 3)).toBe(0);
    expect(radioKeys('End', 0, 3)).toBe(2);
    expect(radioKeys('End', 1, 2)).toBe(1);
  });

  it('ignores every other key (Tab leaves the group, Space and Enter are the click)', () => {
    for (const key of ['Tab', 'Enter', ' ', 'Escape', 'a', 'PageDown', 'arrowright']) {
      expect(radioKeys(key, 1, 3), key).toBeNull();
    }
  });

  it('stays on a single option and does nothing without options', () => {
    expect(radioKeys('ArrowRight', 0, 1)).toBe(0);
    expect(radioKeys('ArrowLeft', 0, 1)).toBe(0);
    expect(radioKeys('ArrowRight', 0, 0)).toBeNull();
    expect(radioKeys('Home', 0, 0)).toBeNull();
  });
});
