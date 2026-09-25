import { describe, expect, it } from 'vitest';
import { buildWordList, suggestWord } from '../../server/services/did-you-mean.ts';

/** „Meintest du …?“ (F-23, Kap. 4.5 point 7). */
describe('buildWordList', () => {
  it('keys words by normalize, keeps the first spelling and counts every occurrence', () => {
    const list = buildWordList(['Spätzle mit Linsen', 'spätzle', 'Käse-Spätzle', 'Spaetzle']);
    expect(list.get('spatzle')).toEqual({ display: 'Spätzle', n: 3 });
    expect(list.get('kase')).toEqual({ display: 'Käse', n: 1 });
    // ae is not folded in keys, like in the index (Kap. 4.4).
    expect(list.get('spaetzle')).toEqual({ display: 'Spaetzle', n: 1 });
    expect(list.get('linsen')).toEqual({ display: 'Linsen', n: 1 });
  });

  it('keeps words of 3+ characters only and splits at anything but letters, digits and marks', () => {
    const list = buildWordList(['Ei mit Öl, 250g Mehl (Type 405)', 'Crème brûlée']);
    expect([...list.keys()].sort()).toEqual(['250g', '405', 'brulee', 'creme', 'mehl', 'mit', 'type']);
    // A decomposed "ä" (a + U+0308) stays inside its word and shows in the composed form.
    expect(buildWordList(['Spa\u0308tzle']).get('spatzle')?.display).toBe('Spätzle');
  });
});

describe('suggestWord', () => {
  const list = buildWordList([
    'Spätzle mit Linsen',
    'Käsespätzle',
    'Lasagne',
    'Kürbissuppe',
    'Zwiebelkuchen',
    'Tomaten',
  ]);

  it('suggests „Spätzle“ for „spazle“ and „Lasagne“ for „lasange“ (F-23 AK1, AK2)', () => {
    expect(suggestWord(list, 'spazle')).toBe('Spätzle');
    expect(suggestWord(list, 'lasange')).toBe('Lasagne');
    expect(suggestWord(list, 'zwibelkuchen')).toBe('Zwiebelkuchen');
  });

  it('allows 1 edit for 4–6 characters and 2 from 7; nothing below 4', () => {
    // 5 characters at distance 2 from "linsen" / "tomaten": no suggestion.
    expect(suggestWord(list, 'lisne')).toBeNull();
    expect(suggestWord(list, 'tomtn')).toBeNull();
    // 7 characters at distance 2: suggested.
    expect(suggestWord(list, 'tomatnn')).toBe('Tomaten');
    expect(suggestWord(list, 'mti')).toBeNull();
    expect(suggestWord(list, 'lase')).toBeNull();
  });

  it('leaves a term alone that is part of a known word (it has hits of its own)', () => {
    expect(suggestWord(list, 'spat')).toBeNull();
    expect(suggestWord(list, 'suppe')).toBeNull();
    expect(suggestWord(list, 'lasagne')).toBeNull();
    // "kase" is 1 edit from "hase", but "kasekuchen" contains it: „kase hase“ must not become „Hase Hase“.
    expect(suggestWord(buildWordList(['Käsekuchen', 'Hase']), 'kase')).toBeNull();
    expect(suggestWord(buildWordList(['Kuchen', 'Hase']), 'kase')).toBe('Hase');
  });

  it('treats ae/oe/ue as a spelling of ä/ö/ü, not as a typo (F-22)', () => {
    const words = buildWordList(['Käse-Lauch-Suppe', 'Müsli', 'Spätzle mit Linsen', 'Möhren']);
    // Each of these already finds its word through the folded query variant: nothing to correct.
    for (const term of ['kaese', 'muesli', 'spaetzle', 'moehren', 'moehre']) {
      expect(suggestWord(words, term), term).toBeNull();
    }
    // A real typo next to an ae spelling is measured on the folded spelling too: "musly" is 1 edit.
    expect(suggestWord(words, 'muesly')).toBe('Müsli');
    expect(suggestWord(words, 'spaezle')).toBe('Spätzle');
  });

  it('breaks ties by frequency, then alphabetically', () => {
    // "hafel" is 1 away from "hafer" (2×) and "hafen" (1×): the more frequent word wins,
    // whichever came first.
    expect(suggestWord(buildWordList(['Hafen', 'Hafer', 'Hafer']), 'hafel')).toBe('Hafer');
    // "birje" is 1 away from "birne" and "birke", both once: the alphabetically first key wins.
    expect(suggestWord(buildWordList(['Birne', 'Birke']), 'birje')).toBe('Birke');
    // A smaller distance beats frequency: "tomatne" (7 characters, up to 2 edits) is 1 swap from
    // "tomaten" but 2 edits from the more frequent "tomatli".
    expect(suggestWord(buildWordList(['Tomatli', 'Tomatli', 'Tomatli', 'Tomaten']), 'tomatne')).toBe(
      'Tomaten',
    );
  });

  it('never accepts a candidate beyond the maximum, even as the only one', () => {
    expect(suggestWord(buildWordList(['Rhabarber']), 'banane')).toBeNull();
  });
});
