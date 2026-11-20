// The combat steps, `attack`, `block` and `assign` (docs/testing.md, "Steps"), as engine actions. Each is a sequence
// of answers: one per attacker or block, then finishing; or one amount per recipient of damage but the last.

import type { Action, CardDatabase, GameState, ObjectId, PlayerId, Target } from "@mtg/engine";
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
      // One answer per recipient but the last, in the decision's order; the last gets what's left (CR 510.1c).
      const pending = state.pending;
      if (pending?.kind !== "assignDamage") {
        if (i === 0) throw new Error(`nothing to assign: the game waits for ${pending?.kind ?? "nothing"}`);
        return null;
      }
      if (i === 0) checkDivision(state, step, other, pending, cards);
      if (i >= pending.recipients.length - 1) return null;
      const to = pending.recipients[i];
      const amount = step.division.find(([name]) => sameTarget(recipient(state, other, name, cards), to))?.[1] ?? 0;
      return { type: "ANSWER", decisionId, player, answer: { kind: "assignDamage", amount } };
    }
  }
}

/** The step must name every recipient once, with amounts that add up to the attacker's damage (CR 510.1c, 510.1e). */
function checkDivision(
  state: GameState,
  step: Extract<CombatStep, { kind: "assign" }>,
  other: PlayerId,
  pending: { recipients: Target[]; amount: number },
  cards: CardDatabase,
): void {
  const named = step.division.map(([name]) => recipient(state, other, name, cards));
  if (
    named.length !== pending.recipients.length ||
    pending.recipients.some((r) => !named.some((n) => sameTarget(n, r)))
  ) {
    throw new Error("assign names each blocking creature (and for a trampler, the player) exactly once");
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

/** A recipient of combat damage: the player, by id, or a permanent `controller` controls. */
function recipient(state: GameState, controller: PlayerId, name: string, cards: CardDatabase): Target {
  if (state.turnOrder.includes(name as PlayerId)) return { kind: "player", player: name as PlayerId };
  return { kind: "object", object: permanent(state, controller, name, cards) };
}

function sameTarget(a: Target, b: Target | undefined): boolean {
  if (b === undefined) return false;
  return a.kind === "player"
    ? b.kind === "player" && b.player === a.player
    : b.kind === "object" && b.object === a.object;
}
