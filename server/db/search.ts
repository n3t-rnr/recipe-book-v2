import { queryVariants, searchTerms } from '../../shared/normalize.ts';

/**
 * Query builder of the full-text search (Kap. 4.5, F-21, F-22). Pure: it only turns the search text
 * into FTS5 match expressions and LIKE patterns; server/db/repos/recipe-list.ts puts them into SQL
 * as bound parameters. It lives under server/db because it writes FTS and LIKE syntax.
 */

/** Terms after dedupe beyond this number are ignored (bounds the SQL shapes and the cost). */
export const MAX_TERMS = 8;

export interface SearchTerm {
  /** Normalized term (Kap. 4.4), at least 2 characters. */
  term: string;
  /** FTS5 prefix query over all columns, one quoted prefix per spelling: "kaese"* OR "kase"*. */
  fts: string;
  /** Only for prefix-only terms (see likes): the same prefixes limited to the title column (ranking tier 0). */
  ftsTitle: string | null;
  /**
   * Only for terms with 3+ characters in every spelling: substring patterns for title, tag and
   * ingredient keys (compounds, „suppe“ → „Kürbissuppe“). Always two entries, so the SQL shape stays
   * fixed. "oel" is „Öl“ (2 letters) and stays prefix-only like "öl", so "%ol%" never finds „Brokkoli“.
   */
  likes: [string, string] | null;
}

export interface SearchSpec {
  terms: SearchTerm[];
  /** Every term's prefixes OR-ed together; only used for the bm25 weight of the ranking. */
  ftsAny: string;
}

/** Quoted FTS5 prefix: inner double quotes are doubled, so no FTS syntax can be injected. */
export function ftsPrefix(term: string): string {
  return `"${term.replaceAll('"', '""')}"*`;
}

/** LIKE pattern "contains term"; backslash, % and _ are escaped for ESCAPE '\'. */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Search spec for a query text, or null when it has no usable term (Kap. 4.5 point 1: terms under
 * 2 characters are ignored). Terms are AND-ed by the caller; the spellings of one term are OR-ed.
 */
export function buildSearchSpec(q: string): SearchSpec | null {
  const distinct = [...new Set(searchTerms(q))].slice(0, MAX_TERMS);
  if (distinct.length === 0) return null;
  const terms = distinct.map((term): SearchTerm => {
    // "ae" → "a" would be a 1-character prefix, which the prefix index cannot serve.
    const variants = queryVariants(term).filter((v) => v.length >= 2);
    const fts = variants.map(ftsPrefix).join(' OR ');
    const first = variants[0] ?? term;
    // Substrings from 3 characters (Kap. 4.5 point 2) in every spelling, so all spellings of a word
    // give the same hits (F-22): "oel" searches like "öl", "aes" like "äs".
    if (variants.every((v) => v.length >= 3)) {
      return { term, fts, ftsTitle: null, likes: [likeContains(first), likeContains(variants[1] ?? first)] };
    }
    return { term, fts, ftsTitle: `title : (${fts})`, likes: null };
  });
  return { terms, ftsAny: terms.map((t) => `(${t.fts})`).join(' OR ') };
}
