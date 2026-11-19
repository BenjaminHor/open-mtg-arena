// The declare blockers step's turn-based action (CR 509.1).

import type { CardDatabase } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import type { Progress } from "../game/progress.ts";
import { currentTurn } from "../game/turn.ts";
import { queueWork } from "../game/work.ts";
import { attacksInCombat, canBlock } from "../rules/combat.ts";
import { controllerOf } from "../rules/controller.ts";
import type { Block } from "../state/combat.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";

/**
 * The defending player: the player the declared attackers attack, even if those attackers have since left combat (in a
 * two-player game, simply the nonactive player, CR 506.2). Several defending players (multiplayer, later: CR 802) would
 * each declare blockers, which isn't built.
 */
export function defendingPlayer(state: GameState): PlayerId | null {
  const all = (state.combat?.attacks ?? []).map((a) => a.defender);
  const defenders = all.filter((p, i) => all.indexOf(p) === i);
  if (defenders.length > 1) throw new Error("Attacks on several players aren't supported yet");
  return defenders[0] ?? null;
}

/**
 * Every block the defending player could still add: each of their creatures not chosen yet, against each attacker
 * attacking them that it can block (CR 509.1a–b). A creature blocks only one attacker (CR 509.1a).
 */
export function possibleBlocks(state: GameState, chosen: readonly Block[], cards: CardDatabase): Block[] {
  const defender = defendingPlayer(state);
  if (defender === null) return [];
  const attackers = attacksInCombat(state, cards)
    .filter((a) => a.defender === defender)
    .map((a) => a.attacker);
  return state.zones.battlefield
    .filter((id) => controllerOf(state, id) === defender && !chosen.some((b) => b.blocker === id))
    .flatMap((blocker) =>
      attackers
        .filter((attacker) => canBlock(state, blocker, attacker, cards))
        .map((attacker) => ({ blocker, attacker })),
    );
}

/** Asks the defending player for blocks, one at a time, until they finish (CR 509.1). No one is asked if none could. */
export function declareBlockers(state: GameState, chosen: Block[], cards: CardDatabase): Progress {
  const defender = defendingPlayer(state);
  if (defender === null || (chosen.length === 0 && possibleBlocks(state, chosen, cards).length === 0)) {
    return finishBlockers(state, defender, []);
  }
  return { state: waitFor(state, defender, { kind: "declareBlockers", chosen }), events: [] };
}

/** Why this block can't be added, or null. */
export function blockProblem(state: GameState, chosen: readonly Block[], block: Block, cards: CardDatabase) {
  const ok = possibleBlocks(state, chosen, cards).some(
    (b) => b.blocker === block.blocker && b.attacker === block.attacker,
  );
  return ok ? null : `${block.blocker} can't block ${block.attacker} (CR 509.1a–b)`;
}

/**
 * The declaration is complete (no restrictions or requirements beyond evasion in the pool, CR 509.1b–c). Each attacker
 * is now blocked or unblocked for good (CR 509.1h); then the active player gets priority (CR 509.2).
 */
export function finishBlockers(state: GameState, defender: PlayerId | null, chosen: readonly Block[]): Progress {
  const active = currentTurn(state).activePlayer;
  const combat = state.combat ?? { attacks: [], blocks: [] };
  const declared: GameState = { ...state, combat: { ...combat, blocks: [...chosen] } };
  return {
    state: queueWork(declared, { kind: "givePriority", player: active }),
    events: defender === null ? [] : [{ type: "BLOCKERS_DECLARED", player: defender, blocks: [...chosen] }],
  };
}
