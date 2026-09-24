import { describe, expect, it } from 'vitest';
import { computeInitials } from '../../shared/initials.ts';

function initialsOf(...names: string[]): string[] {
  const map = computeInitials(names.map((name, i) => ({ id: i + 1, name })));
  return names.map((_, i) => map.get(i + 1) ?? '<missing>');
}

describe('computeInitials (F-03)', () => {
  it('returns an empty map for no profiles', () => {
    expect(computeInitials([]).size).toBe(0);
  });

  it('gives a single profile one upper-case letter', () => {
    expect(initialsOf('Anna')).toEqual(['A']);
    expect(initialsOf('sebastian')).toEqual(['S']);
  });

  it('keeps one letter while first letters differ', () => {
    expect(initialsOf('Anna', 'Bernd', 'Clara')).toEqual(['A', 'B', 'C']);
  });

  it('shows "An" and "Ad" for "Anna" and "Andreas" (F-03 AK)', () => {
    expect(initialsOf('Anna', 'Andreas')).toEqual(['An', 'Ad']);
    expect(initialsOf('Andreas', 'Anna')).toEqual(['Ad', 'An']);
  });

  it('keeps umlauts in the displayed letter', () => {
    expect(initialsOf('Ömer')).toEqual(['Ö']);
    expect(initialsOf('Ömer', 'Bernd')).toEqual(['Ö', 'B']);
    expect(initialsOf('Ärne', 'Zoe')).toEqual(['Ä', 'Z']);
  });

  it('shows the same letter for NFC and NFD input', () => {
    expect(initialsOf('Ömer')).toEqual(['Ö']);
    expect(initialsOf('Ömer')[0]).toBe('Ö');
  });

  it('compares first letters with normalize(), so "Ömer" and "Olga" collide', () => {
    expect(initialsOf('Ömer', 'Olga')).toEqual(['Öm', 'Ol']);
  });

  it('is case insensitive when grouping', () => {
    expect(initialsOf('anna', 'Andreas')).toEqual(['An', 'Ad']);
  });

  it('takes the second letter from the original name', () => {
    expect(initialsOf('Bärbel', 'Bernd')).toEqual(['Bä', 'Be']);
  });

  it('uses the first position that differs from all others in a group of three', () => {
    expect(initialsOf('Anna', 'Andreas', 'Anton')).toEqual(['An', 'Ad', 'At']);
    expect(initialsOf('Maria', 'Mario', 'Markus')).toEqual(['Ma', 'Mo', 'Mk']);
  });

  it('falls back to a position that differs from at least one other', () => {
    // "Mario" differs from "Marion" nowhere, but from "Maria" at the fifth letter.
    expect(initialsOf('Maria', 'Mario', 'Marion')).toEqual(['Ma', 'Mo', 'Mn']);
  });

  it('skips spaces and punctuation when looking for the differing letter', () => {
    expect(initialsOf('Jo Smith', 'Jon')).toEqual(['Js', 'Jn']);
    expect(initialsOf('Anna K.', 'Anna M.')).toEqual(['Ak', 'Am']);
  });

  it('falls back to the second letter when the name has no differing letter', () => {
    expect(initialsOf('An', 'Anna')).toEqual(['An', 'An']);
  });

  it('keeps a one-letter name at one letter even in a group', () => {
    expect(initialsOf('A', 'Anna')).toEqual(['A', 'An']);
  });

  it('uses the first character of names that do not start with a letter', () => {
    expect(initialsOf('1. FC Küche')).toEqual(['1']);
    expect(initialsOf('(Oma)')).toEqual(['(']);
  });

  it('does not turn "ß" into two letters', () => {
    expect(initialsOf('ßabine')).toEqual(['ß']);
  });

  it('never repeats a first letter that folds into two ("Æ" → "ae")', () => {
    expect(initialsOf('Æsa', 'Anna')).toEqual(['Æs', 'An']);
  });

  it('aligns names like normalize() does, collapsing letter runs and spaces', () => {
    expect(initialsOf('Schifffahrt  Kapitän', 'Schiffahrt X')).toEqual(['Sk', 'Sx']);
  });

  it('keeps ids of all profiles', () => {
    const map = computeInitials([
      { id: 7, name: 'Anna' },
      { id: 3, name: 'Andreas' },
      { id: 9, name: 'Jörg Müller' },
    ]);
    expect([...map.entries()]).toEqual([
      [7, 'An'],
      [3, 'Ad'],
      [9, 'J'],
    ]);
  });
});
