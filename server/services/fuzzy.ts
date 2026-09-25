/**
 * Edit distance for „Meintest du …?“ (F-23) and, from M5 on, the similar-title hint (F-45).
 * Plain TypeScript without a dependency (Kap. 4.5 point 7).
 */

/**
 * Damerau-Levenshtein distance in the optimal string alignment variant: insert, delete, substitute
 * and swap two neighbouring characters cost 1 each ("lasange" → "lasagne" is 1). Works on code
 * points. Only distances up to `max` are exact: anything larger returns max + 1, early when the
 * lengths differ by more than `max` or a whole row of the matrix exceeds it.
 */
export function osaDistance(a: string, b: string, max: number): number {
  const s = Array.from(a);
  const t = Array.from(b);
  const la = s.length;
  const lb = t.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0 || lb === 0) return Math.max(la, lb);

  let before: number[] = new Array<number>(lb + 1).fill(0);
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  let cur: number[] = new Array<number>(lb + 1).fill(0);
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const si = s[i - 1];
    for (let j = 1; j <= lb; j++) {
      const tj = t[j - 1];
      const cost = si === tj ? 0 : 1;
      let d = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && si === t[j - 2] && s[i - 2] === tj) d = Math.min(d, (before[j - 2] ?? 0) + 1);
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    // Every later cell is at least this row's minimum (a swap reaches back one more row, but that
    // row's minimum is at most one lower and the swap adds 1), so the result can only exceed max.
    if (rowMin > max) return max + 1;
    [before, prev, cur] = [prev, cur, before];
  }
  const result = prev[lb] ?? 0;
  return result > max ? max + 1 : result;
}

/** Largest accepted distance for a term of `length` characters (F-23): ≤ 1 for 4–6, ≤ 2 from 7, none below 4. */
export function maxDistance(length: number): 0 | 1 | 2 {
  if (length >= 7) return 2;
  if (length >= 4) return 1;
  return 0;
}
