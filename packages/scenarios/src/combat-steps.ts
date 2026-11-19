// The combat steps, `attack`, `block` and `assign` (docs/testing.md, "Steps"), as engine actions. Each is a sequence
// of answers: one per attacker or block, then finishing; or one amount per blocker but the last.

import type { Action, CardDatabase, GameState, ObjectId, PlayerId } from "@mtg/engine";
import type { ScenarioStep } from "./format.ts";
import { parseRef, resolveRef } from "./names.ts";

export type CombatStep = Extract<ScenarioStep, { kind: "attack" | "block" | "assign" }>;

/** The i-th action of a combat step, built from the current state, or null when the step has no more actions. */
export function combatAction(state: GameState, step: CombatStep, cards: CardDatabase, i: number): Action | null {
  const decisionId = state.pending?.id ?? "d0";
  const player = step.player as PlayerId;
  const other = otherPlayer(state, player);
  const finish: Action = { type: "ANSWER", decisionId, player, answer: { kind: "finishDeclaring" } };
  switch (step.kind) {
    case "attack": {
      if (i === step.attackers.length) return finish;
      const name = step.attackers[i];
      if (name === undefined) return null;
      const attack = { attacker: permanent(state, player, name, cards), defender: other };
      return { type: "ANSWER", decisionId, player, answer: { kind: "declareAttacker", attack } };
    }
    case "block": {
      if (i === step.blocks.length) return finish;
      const pair = step.blocks[i];
      if (pair === undefined) return null;
      const block = {
        blocker: permanent(state, player, pair[0], cards),
        attacker: permanent(state, other, pair[1], cards),
      };
      return { type: "ANSWER", decisionId, player, answer: { kind: "declareBlocker", block } };
    }
    case "assign": {
      // One answer per blocker but the last, in the decision's order; the last gets what's left (CR 510.1c).
      const pending = state.pending;
      if (pending?.kind !== "assignDamage") {
        if (i === 0) throw new Error(`nothing to assign: the game waits for ${pending?.kind ?? "nothing"}`);
        return null;
      }
      if (i === 0) checkDivision(state, step, other, pending, cards);
      if (i >= pending.blockers.length - 1) return null;
      const blocker = pending.blockers[i];
      const amount = step.division.find(([name]) => permanent(state, other, name, cards) === blocker)?.[1] ?? 0;
      return { type: "ANSWER", decisionId, player, answer: { kind: "assignDamage", amount } };
    }
  }
}

/** The step must name every blocker once, with amounts that add up to the attacker's damage (CR 510.1c, 510.1e). */
function checkDivision(
  state: GameState,
  step: Extract<CombatStep, { kind: "assign" }>,
  other: PlayerId,
  pending: { blockers: ObjectId[]; amount: number },
  cards: CardDatabase,
): void {
  const named = step.division.map(([name]) => permanent(state, other, name, cards));
  if (named.length !== pending.blockers.length || pending.blockers.some((b) => !named.includes(b))) {
    throw new Error("assign names each blocking creature exactly once");
  }
  const total = step.division.reduce((sum, [, n]) => sum + n, 0);
  if (total !== pending.amount) throw new Error(`the division must add up to ${pending.amount}, not ${total}`);
}

/** The one other player: combat steps in scenarios are two-player. */
function otherPlayer(state: GameState, player: PlayerId): PlayerId {
  const others = state.turnOrder.filter((p) => p !== player);
  if (others.length !== 1) throw new Error("combat steps in scenarios need exactly two players");
  return others[0] as PlayerId;
}

/** A permanent `controller` controls, by name or reference (`Grizzly Bears#2`). */
function permanent(state: GameState, controller: PlayerId, name: string, cards: CardDatabase): ObjectId {
  const ref = parseRef(`${controller}:${name}`);
  const id = ref === null ? null : resolveRef(state, ref, cards);
  if (id === null) throw new Error(`${controller} controls no ${name}`);
  return id;
}
