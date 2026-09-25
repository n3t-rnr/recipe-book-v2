import { describe, expect, it } from 'vitest';
import { buildSearchSpec, ftsPrefix, likeContains, MAX_TERMS } from '../../server/db/search.ts';

/** Query builder of the search (Kap. 4.5, F-21, F-22). */
describe('buildSearchSpec', () => {
  it('searches "kaese" as prefix and substring in both spellings, original first (F-22)', () => {
    expect(buildSearchSpec('kaese')).toEqual({
      terms: [{ term: 'kaese', fts: '"kaese"* OR "kase"*', ftsTitle: null, likes: ['%kaese%', '%kase%'] }],
      ftsAny: '("kaese"* OR "kase"*)',
    });
  });

  it('keeps "michael" findable: the index is not folded, the query adds "michal" (F-22 AK2)', () => {
    const spec = buildSearchSpec('Michael');
    expect(spec?.terms).toEqual([
      { term: 'michael', fts: '"michael"* OR "michal"*', ftsTitle: null, likes: ['%michael%', '%michal%'] },
    ]);
  });

  it('splits "kartoffel käse" into two normalized terms that are AND-ed by the caller', () => {
    const spec = buildSearchSpec('kartoffel käse');
    expect(spec?.terms.map((t) => t.term)).toEqual(['kartoffel', 'kase']);
    expect(spec?.terms[0]?.fts).toBe('"kartoffel"*');
    expect(spec?.terms[1]?.likes).toEqual(['%kase%', '%kase%']);
    expect(spec?.ftsAny).toBe('("kartoffel"*) OR ("kase"*)');
  });

  it('uses substrings only from 3 characters; a 2-character term is a prefix, in the title for tier 0', () => {
    expect(buildSearchSpec('su')?.terms).toEqual([
      { term: 'su', fts: '"su"*', ftsTitle: 'title : ("su"*)', likes: null },
    ]);
    expect(buildSearchSpec('upp')?.terms[0]?.likes).toEqual(['%upp%', '%upp%']);
  });

  it('keeps "oel" prefix-only like "öl": no substring for a 2-letter spelling (F-22, Kap. 4.5)', () => {
    expect(buildSearchSpec('oel')?.terms).toEqual([
      { term: 'oel', fts: '"oel"* OR "ol"*', ftsTitle: 'title : ("oel"* OR "ol"*)', likes: null },
    ]);
    expect(buildSearchSpec('öl')?.terms).toEqual([
      { term: 'ol', fts: '"ol"*', ftsTitle: 'title : ("ol"*)', likes: null },
    ]);
    expect(buildSearchSpec('aes')?.terms[0]?.likes).toBeNull();
    // Both spellings of 3+ characters: substrings as before.
    expect(buildSearchSpec('oele')?.terms[0]?.likes).toEqual(['%oele%', '%ole%']);
  });

  it('never turns "ae" into a 1-character prefix', () => {
    expect(buildSearchSpec('ae')?.terms).toEqual([
      { term: 'ae', fts: '"ae"*', ftsTitle: 'title : ("ae"*)', likes: null },
    ]);
    // "aee" → "ae": both spellings stay ≥ 2 characters.
    expect(buildSearchSpec('aee')?.terms[0]?.fts).toBe('"aee"* OR "ae"*');
  });

  it('ignores 1-character terms and returns null without a usable term (Kap. 4.5 point 1)', () => {
    for (const q of ['', '   ', 'a', 'a b', '-', '"', '%', '_', '*', '🍕']) {
      expect(buildSearchSpec(q), JSON.stringify(q)).toBeNull();
    }
    expect(buildSearchSpec('a ei')?.terms.map((t) => t.term)).toEqual(['ei']);
  });

  it('dedupes terms and keeps at most the first 8', () => {
    expect(buildSearchSpec('Suppe suppe SUPPE')?.terms.map((t) => t.term)).toEqual(['suppe']);
    const ten = 'aa bb cc dd ee ff gg hh ii jj';
    const spec = buildSearchSpec(ten);
    expect(MAX_TERMS).toBe(8);
    expect(spec?.terms.map((t) => t.term)).toEqual(['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh']);
  });

  it('drops FTS and LIKE syntax from the query text, so nothing can be injected', () => {
    expect(buildSearchSpec('NEAR(a b) title:kase ^kase -kase "kase OR')?.terms.map((t) => t.term)).toEqual([
      'near',
      'title',
      'kase',
      'or',
    ]);
    expect(buildSearchSpec('50%_x')?.terms.map((t) => t.term)).toEqual(['50']);
  });
});

describe('ftsPrefix and likeContains', () => {
  it('quotes the FTS prefix and doubles an inner double quote', () => {
    expect(ftsPrefix('kase')).toBe('"kase"*');
    expect(ftsPrefix('ab"c')).toBe('"ab""c"*');
    expect(ftsPrefix('""')).toBe('""""""*');
  });

  it("escapes %, _ and the backslash for ESCAPE '\\'", () => {
    expect(likeContains('upp')).toBe('%upp%');
    expect(likeContains('50%_x\\')).toBe('%50\\%\\_x\\\\%');
  });
});
