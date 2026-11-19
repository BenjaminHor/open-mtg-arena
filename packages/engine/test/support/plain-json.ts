// Finds anything in a value that isn't plain JSON data: the GameState invariant in CLAUDE.md.
// Returns the paths of the problems, so a failing test says exactly where they are.
// The fuzzer (M1-18) will run this after every action.

export function plainJsonProblems(value: unknown, path = "state"): string[] {
  if (value === null || typeof value === "string" || typeof value === "boolean") return [];
  if (typeof value === "number") {
    // JSON turns NaN and Infinity into null, so they wouldn't survive a save.
    if (!Number.isFinite(value)) return [`${path} is ${value}`];
    // JSON writes -0 as 0, so it comes back as a different value.
    return Object.is(value, -0) ? [`${path} is -0`] : [];
  }
  if (value === undefined) return [`${path} is undefined`];
  if (typeof value !== "object") return [`${path} is a ${typeof value}`];
  if (Array.isArray(value)) {
    // Index by index, because flatMap skips the holes of a sparse array, which JSON turns into null.
    const problems: string[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) problems.push(`${path}[${i}] is a hole in a sparse array`);
      else problems.push(...plainJsonProblems(value[i], `${path}[${i}]`));
    }
    return problems;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return [`${path} is a ${value.constructor?.name ?? "non-plain object"}, not a plain object`];
  }
  return Object.entries(value).flatMap(([key, item]) => plainJsonProblems(item, `${path}.${key}`));
}
