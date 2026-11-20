// Actions and objects in words, for `actions`, `show` and `log`. Permanents are named as scenarios name them
// (`p2:Grizzly Bears#2`), so what the CLI prints can be pasted into a scenario or into `do`.

import type {
  AbilityRef,
  Action,
  Answer,
  CardDatabase,
  ChoiceFor,
  ChoosePurpose,
  Duration,
  GameState,
  ManaPool,
  ObjectId,
  ReplacementRef,
  Target,
} from "@mtg/engine";
import { replacementEffectCard } from "@mtg/engine";
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
      const color = action.color === undefined ? "" : ` for {${action.color}}`;
      return `activate ${objectText(state, action.object, cards)} (${abilityText(action.ability)})${color}`;
    }
    case "CONCEDE":
      return `${action.player} concedes`;
    case "ANSWER":
      return answerText(state, action.answer, cards);
  }
}

function abilityText(ref: AbilityRef): string {
  switch (ref.kind) {
    case "printed":
      return `ability ${ref.index + 1}`;
    case "basicLandType":
      return "{T}: add mana";
    case "triggered":
      return `triggered ability ${ref.index + 1}`;
    case "delayed":
      return "delayed triggered ability";
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
    case "chooseTargetCount":
      return `${answer.count} target${answer.count === 1 ? "" : "s"}`;
    case "announceX":
      return `X = ${answer.value}`;
    case "chooseSacrifice":
      return `sacrifice ${objectText(state, answer.object, cards)}`;
    case "divide": {
      const pending = state.pending;
      if (pending?.kind === "divideRedirect") {
        const entry = pending.entries[pending.shares.length];
        return `redirect ${answer.amount} of ${entry === undefined ? "the next damage" : choiceForText(state, entry, cards)}`;
      }
      const target = pending?.kind === "divide" ? pending.targets[pending.shares.length] : undefined;
      return `give ${answer.amount} to ${target === undefined ? "the next target" : targetText(state, target, cards)}`;
    }
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
    case "takeBack":
      return "take back the last one declared";
    case "assignDamage": {
      const pending = state.pending;
      const to = pending?.kind === "assignDamage" ? pending.recipients[pending.assigned.length] : undefined;
      const name =
        to === undefined
          ? "the next recipient"
          : to.kind === "player"
            ? to.player
            : objectText(state, to.object, cards);
      return `assign ${answer.amount} to ${name}`;
    }
    case "chooseCard": {
      // By name only: an option from a hidden zone is shown without its id (D-062).
      const pending = state.pending;
      const option = pending?.kind === "chooseCards" ? pending.options[answer.option] : undefined;
      const card = option === undefined ? `option ${answer.option}` : nameOf(state, option, cards);
      return pending?.kind === "chooseCards" ? choiceText(pending.purpose, card) : `choose ${card}`;
    }
    case "finishChoosing":
      return "done choosing";
    case "chooseYesNo":
      return answer.yes ? "yes" : "no";
    case "chooseReplacement": {
      const pending = state.pending;
      if (pending?.kind !== "chooseReplacement") return `replacement ${answer.option} first`;
      const ref = pending.options[answer.option];
      const first = ref === undefined ? `replacement ${answer.option}` : replacementText(state, ref, cards);
      return `${first} first, for ${choiceForText(state, pending.for, cards)}`;
    }
    case "orderTrigger": {
      const pending = state.pending;
      const trigger = pending?.kind === "orderTriggers" ? pending.batch[answer.index] : undefined;
      const name =
        trigger === undefined ? `trigger ${answer.index}` : (cards[trigger.sourceOracleId]?.printed.name ?? "?");
      return `put ${name}'s triggered ability on the stack next`;
    }
  }
}

/** How long an effect lasts, in words (CR 611.2a). */
export function durationText(duration: Duration): string {
  switch (duration) {
    case "endOfTurn":
      return "until end of turn";
  }
}

/** What choosing a card for this purpose does, in words. */
function choiceText(purpose: ChoosePurpose, card: string): string {
  switch (purpose) {
    case "putOntoBattlefield":
      return `put ${card} onto the battlefield`;
    case "sacrifice":
      return `sacrifice ${card}`;
    case "discard":
      return `discard ${card}`;
    case "search":
      return `find ${card}`;
    case "putOnTop":
      return `put ${card} back next from the top`;
    case "damageSource":
      return `choose ${card} as the source`;
  }
}

/** A replacement effect a player may choose, by what it is: a card's own text, a regeneration shield, a prevention. */
export function replacementText(state: GameState, ref: ReplacementRef, cards: CardDatabase): string {
  switch (ref.kind) {
    case "ownText":
      return `${nameOf(state, ref.object, cards)}'s replacement ${ref.index + 1}`;
    case "regenerationShield":
      return `regenerating ${nameOf(state, ref.object, cards)}`;
    case "resolvedEffect": {
      // Named by the card that made it: its spell is usually gone (CR 400.7).
      const oracleId = replacementEffectCard(state, ref.id);
      return `${(oracleId === null ? undefined : cards[oracleId]?.printed.name) ?? ref.id}'s effect`;
    }
  }
}

/** What a choice between replacement effects is for: the event's object, or one source's damage to one recipient. */
function choiceForText(state: GameState, choiceFor: ChoiceFor, cards: CardDatabase): string {
  switch (choiceFor.kind) {
    case "object":
      return nameOf(state, choiceFor.object, cards);
    case "damage":
      return `${nameOf(state, choiceFor.source, cards)}'s damage to ${targetText(state, choiceFor.to, cards)}`;
  }
}
