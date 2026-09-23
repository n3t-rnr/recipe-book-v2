/**
 * German-aware key for search, sorting (DIN 5007-1) and uniqueness (Kap. 4.4).
 * The same function runs on client and server; original texts are never changed.
 */
const FOLD: Record<string, string> = { ß: 'ss', ẞ: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l' };

export function normalize(input: string): string {
  // 1. NFD, German lower case
  let s = input.normalize('NFD').toLocaleLowerCase('de');
  // 2. ß/ẞ → ss, æ → ae, œ → oe, ø → o, ł → l
  s = s.replace(/[ßẞæœøł]/g, (ch) => FOLD[ch] ?? ch);
  // 3. drop combining marks: ä → a, é → e
  s = s.replace(/\p{M}+/gu, '');
  // 4. three or more equal letters → two (digits untouched): sussspeise → susspeise
  s = s.replace(/(\p{L})\1{2,}/gu, '$1$1');
  // 5. collapse whitespace
  return s.replace(/\s+/gu, ' ').trim();
}

/**
 * Extra spellings for a normalized search term: "kaese" also searches "kase".
 * ae/oe/ue are never folded in the index, so "Michael" or "Goethe" stay intact (F-22).
 */
export function queryVariants(term: string): string[] {
  if (!/ae|oe|ue/.test(term)) return [term];
  const folded = term.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
  return folded === term ? [term] : [term, folded];
}

/** Splits a query into normalized terms; terms shorter than 2 characters are ignored (Kap. 4.5). */
export function searchTerms(query: string): string[] {
  return normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}
