// A short label for each of the person's legal actions, for M3-03's plain list of buttons: enough to play a game
// through and to test the worker round trip. M3-04 replaces the list with real prompts (tap a card to cast it, drag to
// attack) and keeps this only as a fallback for decisions without their own screen yet.

import type { Action, ObjectId, SeatView, Target } from "@mtg/engine";

export function optionLabel(shown: SeatView, action: Action): string {
  const name = (id: ObjectId) => {
    const seen = shown.seen[id];
    return seen?.kind === "card" ? seen.characteristics.name : "ability";
  };
  const target = (t: Target) => (t.kind === "player" ? (t.player === shown.player ? "you" : t.player) : name(t.object));
  switch (action.type) {
    case "PASS_PRIORITY":
      return "Pass";
    case "PLAY_LAND":
      return `Play ${name(action.object)}`;
    case "CAST_SPELL":
      return `Cast ${name(action.object)}`;
    case "ACTIVATE_ABILITY":
      return `Activate ${name(action.object)}`;
    case "CONCEDE":
      return "Concede";
    case "ANSWER": {
      const a = action.answer;
      switch (a.kind) {
        case "mulligan":
          return a.choice === "keep" ? "Keep hand" : "Mulligan";
        case "declareAttacker":
          return `Attack with ${name(a.attack.attacker)}`;
        case "declareBlocker":
          return `Block ${name(a.block.attacker)} with ${name(a.block.blocker)}`;
        case "finishDeclaring":
          return "Done";
        case "chooseTarget":
          return `Target ${target(a.target)}`;
        case "mulliganBottom":
        case "discardToHandSize":
        case "chooseSacrifice":
          return `${a.kind === "mulliganBottom" ? "Bottom" : a.kind === "discardToHandSize" ? "Discard" : "Sacrifice"} ${name(a.object)}`;
        default:
          return a.kind;
      }
    }
  }
}
