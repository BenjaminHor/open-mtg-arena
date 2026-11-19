// Finds anything in a value that isn't plain JSON data: the GameState invariant in CLAUDE.md.
// Returns the paths of the problems, so a failing test says exactly where they are.
// The fuzzer (M1-18) will run this after every action.

export function plainJsonProblems(value: unknown, path = "state"): string[] {
  if (value === null || typeof value === "string" || typeof value === "boolean") return [];
  if (typeof value === "number") {
    // JSON turns NaN and Infinity into null, so they wouldn't survive a save.
    return Number.isFinite(value) ? [] : [`${path} is ${value}`];
  }
  if (value === undefined) return [`${path} is undefined`];
  if (typeof value !== "object") return [`${path} is a ${typeof value}`];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => plainJsonProblems(item, `${path}[${i}]`));
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return [`${path} is a ${value.constructor?.name ?? "non-plain object"}, not a plain object`];
  }
  return Object.entries(value).flatMap(([key, item]) => plainJsonProblems(item, `${path}.${key}`));
}
