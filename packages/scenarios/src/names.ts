// The words scenarios use for steps, cards and objects, and how they map to the engine's.

import { type CardDatabase, controllerOf, type GameState, type ObjectId, type PlayerId, type Step } from "@mtg/engine";

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
export function battlefieldOf(state: GameState, player: PlayerId): ObjectId[] {
  return state.zones.battlefield.filter((id) => controllerOf(state, id) === player);
}

/** The permanent a reference names, or null. */
export function resolveRef(state: GameState, ref: PermanentRef, cards: CardDatabase): ObjectId | null {
  return battlefieldOf(state, ref.player).filter((id) => nameOf(state, id, cards) === ref.card)[ref.nth - 1] ?? null;
}

/** The oracle id for a card name in the database. */
export function oracleIdOf(cards: CardDatabase, name: string): string {
  const found = Object.values(cards).find((c) => c.printed.name === name);
  if (found === undefined) throw new Error(`No card named "${name}" in the pool`);
  return found.oracleId;
}

/** How a scenario names an object: its card name, or "<source> ability" for an ability on the stack. */
export function nameOf(state: GameState, id: ObjectId, cards: CardDatabase): string {
  const obj = state.objects[id];
  if (obj === undefined) return `(gone ${id})`;
  if (obj.kind === "ability") return `${cards[obj.sourceOracleId]?.printed.name ?? obj.sourceOracleId} ability`;
  return cards[obj.oracleId]?.printed.name ?? obj.oracleId;
}
