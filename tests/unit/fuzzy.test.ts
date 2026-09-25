import { describe, expect, it } from 'vitest';
import { maxDistance, osaDistance } from '../../server/services/fuzzy.ts';

/** Damerau-Levenshtein (optimal string alignment) for F-23 and F-45 (Kap. 9.1). */
describe('osaDistance', () => {
  const cases: [string, string, number][] = [
    ['spazle', 'spatzle', 1],
    ['lasange', 'lasagne', 1],
    ['kitten', 'sitting', 3],
    ['', 'abc', 3],
    ['abc', '', 3],
    ['kase', 'kase', 0],
    ['ab', 'ba', 1],
    ['ca', 'abc', 3],
    ['zwiebel', 'zwibel', 1],
    ['kartofel', 'kartoffel', 1],
  ];

  it.each(cases)('%s ↔ %s = %i', (a, b, d) => {
    expect(osaDistance(a, b, 10)).toBe(d);
  });

  it('is symmetric', () => {
    for (const [a, b] of cases) expect(osaDistance(b, a, 10)).toBe(osaDistance(a, b, 10));
  });

  it('is exact up to max and returns max + 1 above it', () => {
    expect(osaDistance('kitten', 'sitting', 3)).toBe(3);
    expect(osaDistance('kitten', 'sitting', 2)).toBe(3);
    expect(osaDistance('kitten', 'sitting', 1)).toBe(2);
    expect(osaDistance('abcdef', 'uvwxyz', 1)).toBe(2);
  });

  it('exits early when the lengths differ by more than max', () => {
    expect(osaDistance('ab', 'abcdef', 1)).toBe(2);
    expect(osaDistance('', 'abcdef', 2)).toBe(3);
  });

  it('counts code points, not UTF-16 units', () => {
    expect(osaDistance('a😀b', 'ab', 5)).toBe(1);
  });
});

describe('maxDistance', () => {
  it('allows no edit below 4 characters, 1 for 4–6 and 2 from 7 (F-23)', () => {
    expect([0, 1, 2, 3].map(maxDistance)).toEqual([0, 0, 0, 0]);
    expect([4, 5, 6].map(maxDistance)).toEqual([1, 1, 1]);
    expect([7, 8, 20].map(maxDistance)).toEqual([2, 2, 2]);
  });
});
