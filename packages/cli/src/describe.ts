// Actions and objects in words, for `actions`, `show` and `log`. Permanents are named as scenarios name them
// (`p2:Grizzly Bears#2`), so what the CLI prints can be pasted into a scenario or into `do`.

import type {
  AbilityRef,
  Action,
  Answer,
  Attack,
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
import { cardDataByOracleId, replacementEffectCard } from "@mtg/engine";
import { graveyardRef, nameOf, refOf } from "@mtg/scenarios";

/** A permanent's reference, a graveyard card's (`graveyard:p1:Name`), or else the object's name. */
export function objectText(state: GameState, id: ObjectId, cards: CardDatabase): string {
  return refOf(state, id, cards) ?? graveyardRef(state, id, cards) ?? nameOf(state, id, cards);
}

/** What an attack was declared against: the defending player, or the planeswalker of theirs (CR 508.1b). */
export function attackedText(state: GameState, attack: Attack, cards: CardDatabase): string {
  return attack.attacked === undefined ? attack.defender : objectText(state, attack.attacked, cards);
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
    case "chooseNewTarget":
      return answer.target === null ? "keep the target" : `new target ${targetText(state, answer.target, cards)}`;
    case "chooseTargetCount":
      return `${answer.count} target${answer.count === 1 ? "" : "s"}`;
    case "announceX":
      return `X = ${answer.value}`;
    case "chooseSacrifice":
      return `sacrifice ${objectText(state, answer.object, cards)}`;
    case "divide": {
      const pending = state.pending;
      const target = pending?.kind === "divide" ? pending.targets[pending.shares.length] : undefined;
      return `give ${answer.amount} to ${target === undefined ? "the next target" : targetText(state, target, cards)}`;
    }
    case "payMana":
      return `pay ${manaText(answer.payment)}`;
    case "cancelCast":
      return "cancel";
    case "declareAttacker":
      return `attack ${attackedText(state, answer.attack, cards)} with ${objectText(state, answer.attack.attacker, cards)}`;
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
      const options = pending?.kind === "chooseCards" || pending?.kind === "keepLegend" ? pending.options : [];
      const option = options[answer.option];
      const card = option === undefined ? `option ${answer.option}` : nameOf(state, option, cards);
      // The legend rule: the permanent kept, by reference, as the options share a name (CR 704.5j).
      if (pending?.kind === "keepLegend" && option !== undefined) return `keep ${objectText(state, option, cards)}`;
      if (pending?.kind !== "chooseCards") return `choose ${card}`;
      // A permanent to copy, by reference: yours and theirs may share a name (all on the battlefield, public).
      const forName = pending.for === null ? "it" : nameOf(state, pending.for, cards);
      if (pending.purpose === "copy" && option !== undefined)
        return choiceText(pending.purpose, objectText(state, option, cards), forName);
      return choiceText(pending.purpose, card, forName);
    }
    case "finishChoosing":
      return state.pending?.kind === "chooseCards" && state.pending.purpose === "copy"
        ? "copy nothing"
        : "done choosing";
    case "chooseYesNo":
      return answer.yes ? "yes" : "no";
    case "chooseName":
      return state.pending?.kind === "chooseName" && state.pending.what === "basicLandType"
        ? `choose ${answer.name}`
        : `name ${answer.name}`;
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
        trigger === undefined
          ? `trigger ${answer.index}`
          : (cardDataByOracleId(trigger.sourceOracleId, cards)?.printed.name ?? "?");
      return `put ${name}'s triggered ability on the stack next`;
    }
  }
}

/** How long an effect lasts, in words (CR 611.2a). */
export function durationText(duration: Duration): string {
  switch (duration) {
    case "endOfTurn":
      return "until end of turn";
    case "endOfGame":
      return "for the rest of the game";
    case "whileSourceOnBattlefield":
      return "while its source remains on the battlefield";
    // The change's own text names the untap step ("doesn't untap during p2's next untap step").
    case "nextUntapStep":
      return "";
  }
}

/** What choosing a card for this purpose does, in words. */
function choiceText(purpose: ChoosePurpose, card: string, forName: string): string {
  switch (purpose) {
    case "enchant":
      return `${forName} enchants ${card}`;
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
    case "choose":
      return `choose ${card}`;
    case "copy":
      return `${forName} enters as a copy of ${card}`;
  }
}

/** A replacement effect a player may choose, by what it is: a card's own text, a regeneration shield, a prevention. */
export function replacementText(state: GameState, ref: ReplacementRef, cards: CardDatabase): string {
  switch (ref.kind) {
    case "ownText":
      return `${nameOf(state, ref.object, cards)}'s replacement ${ref.index + 1}`;
    case "regenerationShield":
      return `regenerating ${nameOf(state, ref.object, cards)}`;
    case "protection":
      return `${nameOf(state, ref.object, cards)}'s protection`;
    case "resolvedEffect": {
      // Named by the card that made it: its spell is usually gone (CR 400.7).
      const oracleId = replacementEffectCard(state, ref.id);
      return `${(oracleId === null ? undefined : cardDataByOracleId(oracleId, cards)?.printed.name) ?? ref.id}'s effect`;
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
