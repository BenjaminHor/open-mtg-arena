// Actions and objects in words, for `actions`, `show` and `log`. Permanents are named as scenarios name them
// (`p2:Grizzly Bears#2`), so what the CLI prints can be pasted into a scenario or into `do`.

import type { Action, Answer, CardDatabase, GameState, ManaPool, ObjectId, Target } from "@mtg/engine";
import { nameOf, refOf } from "@mtg/scenarios";

/** A permanent's reference, or the object's name if it isn't on the battlefield. */
export function objectText(state: GameState, id: ObjectId, cards: CardDatabase): string {
  return refOf(state, id, cards) ?? nameOf(state, id, cards);
}

export function targetText(state: GameState, target: Target, cards: CardDatabase): string {
  switch (target.kind) {
    case "player":
      return target.player;
    case "object":
      return objectText(state, target.object, cards);
  }
}

/** A payment or pool as mana symbols, `{R}{R}{G}`; `{0}` for nothing. */
export function manaText(pool: ManaPool): string {
  const symbols = (["W", "U", "B", "R", "G", "C"] as const).flatMap((t) =>
    Array.from({ length: pool[t] }, () => `{${t}}`),
  );
  return symbols.length === 0 ? "{0}" : symbols.join("");
}

export function actionText(state: GameState, action: Action, cards: CardDatabase): string {
  switch (action.type) {
    case "PASS_PRIORITY":
      return "pass";
    case "PLAY_LAND":
      return `play ${nameOf(state, action.object, cards)}`;
    case "CAST_SPELL":
      return `cast ${nameOf(state, action.object, cards)}`;
    case "ACTIVATE_ABILITY": {
      const which = action.ability.kind === "printed" ? `ability ${action.ability.index + 1}` : "mana ability";
      return `activate ${objectText(state, action.object, cards)} (${which})`;
    }
    case "CONCEDE":
      return `${action.player} concedes`;
    case "ANSWER":
      return answerText(state, action.answer, cards);
  }
}

function answerText(state: GameState, answer: Answer, cards: CardDatabase): string {
  switch (answer.kind) {
    case "chooseStartingPlayer":
      return `${answer.player} goes first`;
    case "mulligan":
      return answer.choice;
    case "mulliganBottom":
      return `put ${nameOf(state, answer.object, cards)} on the bottom`;
    case "discardToHandSize":
      return `discard ${nameOf(state, answer.object, cards)}`;
    case "chooseTarget":
      return `target ${targetText(state, answer.target, cards)}`;
    case "payMana":
      return `pay ${manaText(answer.payment)}`;
    case "cancelCast":
      return "cancel";
    case "declareAttacker":
      return `attack ${answer.attack.defender} with ${objectText(state, answer.attack.attacker, cards)}`;
    case "declareBlocker":
      return `block ${objectText(state, answer.block.attacker, cards)} with ${objectText(state, answer.block.blocker, cards)}`;
    case "finishDeclaring":
      return "done declaring";
    case "assignDamage": {
      const pending = state.pending;
      const blocker = pending?.kind === "assignDamage" ? pending.blockers[pending.assigned.length] : undefined;
      return `assign ${answer.amount} to ${blocker === undefined ? "the next blocker" : objectText(state, blocker, cards)}`;
    }
  }
}
