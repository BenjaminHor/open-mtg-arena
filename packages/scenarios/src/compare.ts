// Comparing values from scenarios with values from the game. Key order doesn't matter: `{ G: 1, R: 2 }` equals
// `{ R: 2, G: 1 }`.

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  const bo = b as Record<string, unknown>;
  const ao = a as Record<string, unknown>;
  return ak.length === bk.length && ak.every((k) => k in bo && deepEqual(ao[k], bo[k]));
}

/**
 * Every key of `want` is in `have` with a matching value; other keys of `have` don't matter. A nested map matches
 * the same way, on its own keys given (`effect: { controller: p1 }`); anything else (a list, a number) must be equal.
 */
export function partialMatch(have: Record<string, unknown>, want: Record<string, unknown>): boolean {
  return Object.entries(want).every(([k, v]) => {
    const h = have[k];
    return isMap(v) && isMap(h) ? partialMatch(h, v) : deepEqual(h, v);
  });
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
