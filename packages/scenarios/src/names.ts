// The words scenarios use for steps, cards and objects, and how they map to the engine's.

import {
  type CardDatabase,
  cardDataByOracleId,
  cardDataOf,
  controllerOf,
  type GameState,
  type ObjectId,
  type PlayerId,
  type Step,
} from "@mtg/engine";

/** Scenario step names (docs/testing.md) and the engine's CR names (CR 500.1). */
export const STEP_NAMES: Record<string, Step> = {
  untap: "untap",
  upkeep: "upkeep",
  draw: "draw",
  main1: "precombatMain",
  "combat.beginning": "beginningOfCombat",
  "combat.declareAttackers": "declareAttackers",
  "combat.declareBlockers": "declareBlockers",
  "combat.damage": "combatDamage",
  "combat.end": "endOfCombat",
  main2: "postcombatMain",
  end: "end",
  cleanup: "cleanup",
};

export function engineStep(name: string): Step {
  const step = STEP_NAMES[name];
  if (step === undefined) throw new Error(`Unknown step "${name}". Steps: ${Object.keys(STEP_NAMES).join(", ")}`);
  return step;
}

export function scenarioStep(step: Step): string {
  return Object.entries(STEP_NAMES).find(([, s]) => s === step)?.[0] ?? step;
}

/** A reference to a permanent: `p2:Grizzly Bears` (the only one p2 controls) or `p2:Grizzly Bears#2` (the second). */
export type PermanentRef = { player: PlayerId; card: string; nth: number };

export function parseRef(text: string): PermanentRef | null {
  const match = /^(p\d+):(.+?)(?:#(\d+))?$/.exec(text);
  if (match === null) return null;
  const [, player = "", card = "", nth = "1"] = match;
  return { player: player as PlayerId, card, nth: Number(nth) };
}

/** The permanents a player controls, in battlefield order (asking the engine who controls each). */
export function battlefieldOf(state: GameState, player: PlayerId, cards: CardDatabase): ObjectId[] {
  return state.zones.battlefield.filter((id) => controllerOf(state, id, cards) === player);
}

/** The permanent a reference names, or null. */
export function resolveRef(state: GameState, ref: PermanentRef, cards: CardDatabase): ObjectId | null {
  return (
    battlefieldOf(state, ref.player, cards).filter((id) => nameOf(state, id, cards) === ref.card)[ref.nth - 1] ?? null
  );
}

/**
 * The reference that names this permanent: `p2:Grizzly Bears`, or `p2:Grizzly Bears#2` when its controller has more
 * than one with that name (the inverse of `resolveRef`). Null if it isn't on the battlefield.
 */
export function refOf(state: GameState, id: ObjectId, cards: CardDatabase): string | null {
  if (!state.zones.battlefield.includes(id)) return null;
  const player = controllerOf(state, id, cards);
  const name = nameOf(state, id, cards);
  const same = battlefieldOf(state, player, cards).filter((x) => nameOf(state, x, cards) === name);
  return same.length > 1 ? `${player}:${name}#${same.indexOf(id) + 1}` : `${player}:${name}`;
}

/** The oracle id for a card name in the database. */
export function oracleIdOf(cards: CardDatabase, name: string): string {
  const found = Object.values(cards).find((c) => c.printed.name === name);
  if (found === undefined) throw new Error(`No card named "${name}" in the pool`);
  return found.oracleId;
}

/**
 * How a scenario names an object: its card name, or "<source> ability" for an ability on the stack. A card that left
 * the battlefield is named from its last known information while the engine keeps it (CR 608.2h).
 */
export function nameOf(state: GameState, id: ObjectId, cards: CardDatabase): string {
  const obj = state.objects[id] ?? state.lastKnown[id];
  if (obj === undefined) return `(gone ${id})`;
  if (obj.kind === "ability")
    return `${cardDataByOracleId(obj.sourceOracleId, cards)?.printed.name ?? obj.sourceOracleId} ability`;
  return cardDataOf(obj, cards)?.printed.name ?? obj.oracleId;
}
