// The combat steps, `attack`, `block` and `assign` (docs/testing.md, "Steps"), as engine actions. Each is a sequence
// of answers: one per attacker or block, then finishing; or one division.

import type { Action, CardDatabase, GameState, ObjectId, PlayerId } from "@mtg/engine";
import type { ScenarioStep } from "./format.ts";
import { parseRef, resolveRef } from "./names.ts";

export type CombatStep = Extract<ScenarioStep, { kind: "attack" | "block" | "assign" }>;

/** The i-th action of a combat step, built from the current state, or null when the step has no more actions. */
export function combatAction(state: GameState, step: CombatStep, cards: CardDatabase, i: number): Action | null {
  const decisionId = state.pending?.id ?? "d0";
  const player = step.player as PlayerId;
  const other = otherPlayer(state, player);
  switch (step.kind) {
    case "attack": {
      const name = step.attackers[i];
      if (i === step.attackers.length)
        return { type: "ANSWER", decisionId, player, answer: { kind: "finishDeclaring" } };
      if (name === undefined) return null;
      const attack = { attacker: permanent(state, player, name, cards), defender: other };
      return { type: "ANSWER", decisionId, player, answer: { kind: "declareAttacker", attack } };
    }
    case "block": {
      const pair = step.blocks[i];
      if (i === step.blocks.length) return { type: "ANSWER", decisionId, player, answer: { kind: "finishDeclaring" } };
      if (pair === undefined) return null;
      const block = {
        blocker: permanent(state, player, pair[0], cards),
        attacker: permanent(state, other, pair[1], cards),
      };
      return { type: "ANSWER", decisionId, player, answer: { kind: "declareBlocker", block } };
    }
    case "assign": {
      if (i > 0) return null;
      const division = step.division.map(([name, amount]) => ({
        blocker: permanent(state, other, name, cards),
        amount,
      }));
      return { type: "ANSWER", decisionId, player, answer: { kind: "assignDamage", division } };
    }
  }
}

/** The one other player: combat steps in scenarios are two-player. */
function otherPlayer(state: GameState, player: PlayerId): PlayerId {
  const others = state.turnOrder.filter((p) => p !== player);
  if (others.length !== 1) throw new Error("combat steps in scenarios need exactly two players");
  return others[0] as PlayerId;
}

/** A permanent `owner` controls, by name or reference (`Grizzly Bears#2`). */
function permanent(state: GameState, controller: PlayerId, name: string, cards: CardDatabase): ObjectId {
  const ref = parseRef(`${controller}:${name}`);
  const id = ref === null ? null : resolveRef(state, ref, cards);
  if (id === null) throw new Error(`${controller} controls no ${name}`);
  return id;
}
