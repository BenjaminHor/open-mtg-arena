// How much choosing a target is worth, given what the spell or ability does to it (`intents.ts`). Harm is worth the
// most on an opponent's best permanent, and less than nothing on its own; help the other way round. Damage counts only
// where it kills (a creature, a planeswalker) or hits a player.

import type { CardDatabase, PlayerId, SeatView, SeenCard, Target } from "@mtg/engine";
import { lifeOf, permanentValue, toughnessLeft } from "./board.ts";
import type { Intent } from "./intents.ts";

/** Below this, a harmful spell isn't worth casting: it would only scratch something. */
export const WORTH_CASTING = 1;

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
    case "help":
      return mine ? helpScore(seen, cards) : -permanentValue(seen, cards);
    case "harm": {
      const onStack = shown.view.zones.stack.includes(target.object);
      const worth = onStack ? spellWorth(seen, cards) : harmWorth(seen, intent, cards);
      return mine ? -worth : worth;
    }
  }
}

function helpScore(card: SeenCard, cards: CardDatabase): number {
  return card.characteristics.types.includes("creature") ? permanentValue(card, cards) : 0.5;
}

/** What harming this permanent is worth: all of it if the harm removes it, a little if the damage doesn't kill it. */
function harmWorth(card: SeenCard, intent: Extract<Intent, { kind: "harm" }>, cards: CardDatabase): number {
  const value = permanentValue(card, cards);
  if (intent.damage === null) return value;
  const types = card.characteristics.types;
  const left = types.includes("creature") ? toughnessLeft(card) : (card.counters.loyalty ?? 0);
  return intent.damage >= left ? value : 0.1;
}

/** A spell on the stack is worth countering by what it would add once resolved, guessed from what it is. */
function spellWorth(card: SeenCard, cards: CardDatabase): number {
  return 1 + permanentValue(card, cards);
}

function playerScore(shown: SeatView, player: PlayerId, intent: Intent): number {
  const me = player === shown.player;
  switch (intent.kind) {
    case "neutral":
      return 0;
    case "help":
      return me ? 1 : -1;
    case "harm": {
      if (intent.damage === null) return me ? -1 : 1;
      const life = lifeOf(shown, player);
      // Damage to a player is worth the game when it's lethal, a point a point once they're low, and little before:
      // a burn spell does more on a creature until then.
      const worth = intent.damage >= life ? 100 : life - intent.damage <= LOW_LIFE ? intent.damage : intent.damage / 4;
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
