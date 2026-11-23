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
    case "ANSWER":
      return answerLabel(action.answer, name, target);
  }
}

type Answer = Extract<Action, { type: "ANSWER" }>["answer"];

/** Every kind of answer by name, so a new one is a compile error until it has a label. */
function answerLabel(a: Answer, name: (id: ObjectId) => string, target: (t: Target) => string): string {
  switch (a.kind) {
    case "chooseStartingPlayer":
      return `${a.player} goes first`;
    case "mulligan":
      return a.choice === "keep" ? "Keep hand" : "Mulligan";
    case "mulliganBottom":
      return `Bottom ${name(a.object)}`;
    case "discardToHandSize":
      return `Discard ${name(a.object)}`;
    case "chooseSacrifice":
      return `Sacrifice ${name(a.object)}`;
    case "chooseTarget":
      return `Target ${target(a.target)}`;
    case "chooseNewTarget":
      return a.target === null ? "Keep the target" : `New target ${target(a.target)}`;
    case "announceX":
      return `X = ${a.value}`;
    case "chooseTargetCount":
      return `${a.count} target${a.count === 1 ? "" : "s"}`;
    case "divide":
    case "assignDamage":
      return `${a.amount} damage`;
    case "payMana":
      return "Pay from the mana pool";
    case "cancelCast":
      return "Cancel";
    case "declareAttacker":
      return `Attack with ${name(a.attack.attacker)}`;
    case "declareBlocker":
      return `Block ${name(a.block.attacker)} with ${name(a.block.blocker)}`;
    case "finishDeclaring":
    case "finishChoosing":
      return "Done";
    case "takeBack":
      return "Take back";
    case "orderTrigger":
      return `Put trigger ${a.index + 1} on the stack next`;
    case "chooseCard":
      return `Choose card ${a.option + 1}`;
    case "chooseYesNo":
      return a.yes ? "Yes" : "No";
    case "chooseReplacement":
      return `Apply effect ${a.option + 1} first`;
    case "chooseName":
      return `Name ${a.name}`;
  }
}
