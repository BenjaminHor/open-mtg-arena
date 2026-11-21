// The engine's invariants (CLAUDE.md "Hard invariants", docs/testing.md "Invariant fuzzing"), checked on a state.
// The scenario runner checks every state it sees; the fuzzer (M1-18) will reuse this.

import {
  applyAction,
  type CardDatabase,
  type GameState,
  legalActions,
  type ObjectId,
  phaseOf,
  type ZoneRef,
} from "@mtg/engine";

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
  const pending = state.pending;
  // State-based actions happen before anyone gets priority (CR 117.5), so no token is left outside the battlefield
  // (CR 704.5d).
  if (pending?.kind === "priority") {
    for (const obj of Object.values(state.objects)) {
      if (obj.kind === "card" && obj.token !== undefined && !state.zones.battlefield.includes(obj.id))
        problems.push(`${obj.id}: a token outside the battlefield with priority to give`);
    }
  }
  // Cards a decision shows by identity (D-062) are in the fixed order and really in that zone: never the zone's own
  // order, never cards from elsewhere.
  if (pending?.kind === "chooseCards" && pending.seen !== null) {
    const shown = pending.seen.cards;
    const inZone = zoneOf(state, pending.seen.from).map((id) => {
      const obj = state.objects[id];
      return obj?.kind === "card" ? obj.oracleId : "";
    });
    if (JSON.stringify(shown) !== JSON.stringify([...shown].sort()))
      problems.push("a decision shows cards out of order");
    if (!shown.every((card) => inZone.splice(inZone.indexOf(card), inZone.includes(card) ? 1 : 0).length === 1))
      problems.push("a decision shows cards that aren't in the zone it names");
  }
  // "This way" results belong to one resolution: they exist only while that object's resolution is still to finish.
  const resolving = state.resolution;
  if (resolving !== null && !state.work.some((w) => w.kind === "finishResolving" && w.object === resolving.object)) {
    problems.push(`a resolution record for ${resolving.object} outlives its resolution (CR 608.2c)`);
  }
  // Triggered abilities go on the stack before anyone gets priority (CR 117.5, 603.3).
  if (state.pending?.kind === "priority" && state.pendingTriggers.length > 0) {
    problems.push("a player has priority while triggered abilities wait to go on the stack (CR 603.3)");
  }
  // Last known information is kept only while something could still read it: an ability on the stack or waiting.
  if (state.pending?.kind === "priority" && state.zones.stack.length === 0 && Object.keys(state.lastKnown).length > 0) {
    problems.push("last known information outlives the stack emptying (CR 608.2h)");
  }
  const inCombat = state.turn !== null && phaseOf(state.turn.step) === "combat";
  if (state.result === null && (state.combat !== null) !== inCombat) {
    problems.push("combat state exists exactly during the combat phase (CR 506.1, 511.3)");
  }
  // A pending decision always has a way out: a trigger's targets can't be cancelled (CR 603.3d), so a count or division
  // offered that can't be completed would leave the game stuck.
  const waiting = state.pending;
  if (waiting !== null && state.result === null) {
    // Conceding is always allowed and never listed (D-042), so it's no way out here.
    const answers = legalActions(state, waiting.player, cards);
    if (answers.length === 0) problems.push(`${waiting.player} must decide ${waiting.kind} but has no legal action`);
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

/** The objects in a zone, by its reference. */
function zoneOf(state: GameState, ref: ZoneRef): readonly ObjectId[] {
  if (!("player" in ref)) return state.zones[ref.zone];
  return state.zones.players[ref.player]?.[ref.zone] ?? [];
}
