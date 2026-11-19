// The engine's invariants (CLAUDE.md "Hard invariants", docs/testing.md "Invariant fuzzing"), checked on a state.
// The scenario runner checks every state it sees; the fuzzer (M1-18) will reuse this.

import { applyAction, type CardDatabase, type GameState, legalActions } from "@mtg/engine";

/** Everything wrong with a state, as readable messages. Empty when it holds every invariant. */
export function invariantProblems(state: GameState, cards: CardDatabase): string[] {
  const problems = [...plainJsonProblems(state, "state")];
  if (state.pending === null && state.result === null) problems.push("the game is stalled: nothing pending, no result");
  const listed = [
    ...Object.values(state.zones.players).flatMap((z) => [...z.library, ...z.hand, ...z.graveyard]),
    ...state.zones.battlefield,
    ...state.zones.stack,
    ...state.zones.exile,
    ...state.zones.command,
  ];
  const objects = Object.keys(state.objects);
  for (const id of listed) if (!(id in state.objects)) problems.push(`zone entry ${id} isn't an object`);
  for (const id of objects) {
    const count = listed.filter((x) => x === id).length;
    if (count !== 1) problems.push(`object ${id} is in ${count} zones`);
  }
  for (const p of state.turnOrder) {
    for (const [type, amount] of Object.entries(state.players[p]?.manaPool ?? {})) {
      if (!Number.isInteger(amount) || amount < 0) problems.push(`${p}'s mana pool has ${amount} ${type}`);
    }
  }
  for (const obj of Object.values(state.objects)) {
    if (obj.kind === "card" && (obj.choices === null) === state.zones.stack.includes(obj.id)) {
      problems.push(`${obj.id}: a card has casting choices exactly when it's on the stack`);
    }
  }
  for (const player of state.turnOrder) {
    for (const action of legalActions(state, player, cards)) {
      const result = applyAction(state, action, cards);
      if (!result.ok) problems.push(`listed action rejected: ${JSON.stringify(action)} (${result.error.message})`);
    }
  }
  return problems;
}

/** Anything that isn't plain JSON data, with its path. */
export function plainJsonProblems(value: unknown, path: string): string[] {
  if (value === null || typeof value === "string" || typeof value === "boolean") return [];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return [`${path} is ${value}`];
    return Object.is(value, -0) ? [`${path} is -0`] : [];
  }
  if (value === undefined) return [`${path} is undefined`];
  if (typeof value !== "object") return [`${path} is a ${typeof value}`];
  if (Array.isArray(value)) {
    const problems: string[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) problems.push(`${path}[${i}] is a hole in a sparse array`);
      else problems.push(...plainJsonProblems(value[i], `${path}[${i}]`));
    }
    return problems;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return [`${path} isn't a plain object`];
  return Object.entries(value).flatMap(([key, item]) => plainJsonProblems(item, `${path}.${key}`));
}
