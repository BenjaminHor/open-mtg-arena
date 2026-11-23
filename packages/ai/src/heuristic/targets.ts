// How much choosing a target is worth, given what the spell or ability does to it (`intents.ts`). Harm is worth the
// most on an opponent's best permanent, and less than nothing on its own; help the other way round. Damage counts only
// where it kills (a creature, a planeswalker) or hits a player.

import type { CardDatabase, PlayerId, SeatView, SeenCard, Target } from "@mtg/engine";
import { lifeOf, permanentValue, toughnessLeft } from "./board.ts";
import { type Intent, stackIntents } from "./intents.ts";
import { pumpsValue } from "./tricks.ts";

/** Below this, a harmful spell isn't worth casting: it would only scratch something. */
export const WORTH_CASTING = 1;

/** What winning (or losing) the game is worth, against which everything else is small. */
const LETHAL = 100;

/** A player at this much life or less is in burn range. */
const LOW_LIFE = 5;

export function targetScore(shown: SeatView, target: Target, intent: Intent, cards: CardDatabase): number {
  if (target.kind === "player") return playerScore(shown, target.player, intent);
  const seen = shown.seen[target.object];
  if (seen === undefined) return 0;
  if (seen.kind === "ability") return 0;
  const mine = seen.characteristics.controller === shown.player;
  switch (intent.kind) {
    case "neutral":
      return 0;
    case "help": {
      if (!mine) return -permanentValue(seen, cards);
      // A pump until end of turn is a combat trick: worth what it changes in combat now, nothing outside it.
      if (intent.untilEndOfTurn)
        return intent.pump === undefined ? 0 : pumpsValue(shown, [{ creature: seen, pump: intent.pump }]);
      return helpScore(seen, cards);
    }
    case "harm": {
      // A spell on the stack is scored from the heuristic's side already: stopping its own is a loss.
      if (shown.view.zones.stack.includes(target.object)) return stopScore(shown, seen, mine, cards);
      const worth = harmWorth(seen, intent, cards);
      return mine ? -worth : worth;
    }
  }
}

/** Helping a creature is worth the creature; helping anything else (untapping a land) only if it's tapped. */
function helpScore(card: SeenCard, cards: CardDatabase): number {
  if (card.characteristics.types.includes("creature")) return permanentValue(card, cards);
  return card.tapped ? 0.5 : 0;
}

/** What harming this permanent is worth: all of it if the harm removes it, a little if the damage doesn't kill it. */
function harmWorth(card: SeenCard, intent: Extract<Intent, { kind: "harm" }>, cards: CardDatabase): number {
  const value = permanentValue(card, cards);
  if (intent.damage === null) return value;
  const types = card.characteristics.types;
  const left = types.includes("creature") ? toughnessLeft(card) : (card.counters.loyalty ?? 0);
  return intent.damage >= left ? value : 0.1;
}

/**
 * What stopping a spell on the stack (countering it, CR 701.5a) is worth to the heuristic. A permanent spell: what the
 * permanent would be worth to its controller. Any other: its card, and what it would do on its chosen targets, for or
 * against the heuristic, so a spell that only hurts its own caster's side isn't worth answering, and its own spells
 * are never worth stopping. Only reads down the stack: a spell targets older objects (later: a cycle needs a guard once
 * a card can change a spell's targets to a newer one, Redirect).
 */
function stopScore(shown: SeatView, spell: SeenCard, mine: boolean, cards: CardDatabase): number {
  const types = spell.characteristics.types;
  if (!types.includes("instant") && !types.includes("sorcery")) {
    const value = 1 + permanentValue(spell, cards);
    return mine ? -value : value;
  }
  const intents = stackIntents(shown, spell.id, cards);
  const chosen = spell.choices?.targets ?? [];
  const forMe = chosen.reduce(
    (sum, group, i) =>
      sum + group.reduce((s, t) => s + targetScore(shown, t, intents[i] ?? { kind: "neutral" }, cards), 0),
    0,
  );
  return mine ? -(1 + forMe) : 1 - forMe;
}

function playerScore(shown: SeatView, player: PlayerId, intent: Intent): number {
  const me = player === shown.player;
  switch (intent.kind) {
    case "neutral":
      return 0;
    case "help": {
      const loss = intent.lifeLoss ?? 0;
      if (!me) return -1;
      // Paying life for it: never the last of it, and only grudgingly once low.
      if (loss >= lifeOf(shown, player)) return -LETHAL;
      return lifeOf(shown, player) - loss <= LOW_LIFE ? -1 : 1;
    }
    case "harm": {
      if (intent.fromHand === true && (shown.view.zones.players[player]?.handSize ?? 0) === 0) return 0;
      if (intent.damage === null) return me ? -1 : 1;
      const life = lifeOf(shown, player);
      // Damage to a player is worth the game when it's lethal, a point a point once they're low, and little before:
      // a burn spell does more on a creature until then.
      const worth =
        intent.damage >= life ? LETHAL : life - intent.damage <= LOW_LIFE ? intent.damage : intent.damage / 4;
      return me ? -worth : worth;
    }
  }
}

/** The best of the legal targets for one instance of "target", by score: the first listed wins a tie. */
export function bestTarget(
  shown: SeatView,
  targets: readonly Target[],
  intent: Intent,
  cards: CardDatabase,
): { target: Target; score: number } | null {
  let best: { target: Target; score: number } | null = null;
  for (const target of targets) {
    const score = targetScore(shown, target, intent, cards);
    if (best === null || score > best.score) best = { target, score };
  }
  return best;
}
