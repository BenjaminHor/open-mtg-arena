// What the person can do right now, and where on screen they do it (M3-04b; ui.md "Touch interaction", "Mouse and
// keyboard too"). Every legal option in the seat view becomes a control: a tap on a card or a portrait, the main
// button, a small button beside it, or a choice in a prompt. Nothing here decides legality: each control sends one of
// `shown.options`' actions, as the engine listed it (ui.md: "it never invents its own legality"). Pure, so a test can
// check over many games that no option is left without a control.

import type { Action, ObjectId, PlayerId, SeatView } from "@mtg/engine";
import { optionLabel } from "../app/option-label.ts";
import { mainButton } from "../hud/main-button.ts";
import { abilityLabel } from "./ability-label.ts";

type Answer = Extract<Action, { type: "ANSWER" }>["answer"];

/** One thing a tap or a menu entry sends. */
export type Choice = { label: string; action: Action };

/** What a tap on a card does now. */
export type Tap =
  /** Sends this action. */
  | { kind: "send"; choice: Choice }
  /** Lifts a hand card, or picks a blocker, so a second tap says what to do with it. */
  | { kind: "select" }
  /** Puts it down again. */
  | { kind: "deselect" }
  /** Several things it can do: a small menu by the card. */
  | { kind: "menu"; choices: Choice[] };

/** The UI's own state of a choice under way: the hand card lifted, or the blocker picked before its attacker. */
export type Selection = ObjectId | null;

export type Controls = {
  /** Each card a tap does something on, with what it does and a label for screen readers and tests. */
  cards: Record<ObjectId, { label: string; tap: Tap }>;
  /** A player a tap picks, as a target. */
  players: Record<PlayerId, Choice[]>;
  /** The main button's action (`main-button.ts`). */
  main: Action | null;
  /** Small buttons beside the main one: take back the last pick, cancel a cast or activation. */
  secondary: Choice[];
  /** The rest, in a prompt with a title saying what's awaited. Null when nothing is left for one. */
  prompt: { title: string; choices: Choice[] } | null;
  /** Conceding is always possible (CR 104.3a): a control of its own, in the settings menu. */
  concede: Action | null;
};

export function controls(shown: SeatView, selection: Selection): Controls {
  const name = (id: ObjectId) => {
    const seen = shown.seen[id];
    return seen?.kind === "card" ? seen.characteristics.name : "it";
  };
  const hand = new Set(shown.view.zones.players[shown.player]?.hand ?? []);
  // A card is tapped where the board draws it: on the battlefield or in the person's hand. A card anywhere else (a
  // graveyard, under the top of the stack) isn't drawn yet (M3-04c), so a choice of it goes to the prompt instead.
  const onScreen = (id: ObjectId) => hand.has(id) || shown.view.zones.battlefield.includes(id);
  const onCard = new Map<ObjectId, Choice[]>();
  const blocks = new Map<ObjectId, Choice[]>();
  const players: Record<PlayerId, Choice[]> = {};
  const secondary: Choice[] = [];
  const leftover: Choice[] = [];
  const main = mainButton(shown).action;
  const add = (map: Map<ObjectId, Choice[]>, id: ObjectId, choice: Choice) => {
    if (map === onCard && !onScreen(id)) leftover.push(choice);
    else map.set(id, [...(map.get(id) ?? []), choice]);
  };

  for (const option of shown.options) {
    const action = option.action;
    const label = optionLabel(shown, action);
    if (sameAction(action, main)) continue;
    switch (action.type) {
      case "PASS_PRIORITY":
        // Passing is the main button's whenever it's offered; reached only if the button shows something else.
        leftover.push({ label, action });
        break;
      case "CONCEDE":
        // Not listed among the options (D-042): conceding is the settings menu's, below.
        break;
      case "PLAY_LAND":
      case "CAST_SPELL":
        // A spell the person's mana surely can't pay for stays in hand untouched (D-144's hint; the cyan outline too).
        if (option.mightPay !== false) add(onCard, action.object, { label, action });
        break;
      case "ACTIVATE_ABILITY":
        if (option.mightPay !== false) {
          const what = option.ability === null ? label : abilityLabel(option.ability, action.color);
          add(onCard, action.object, { label: what, action });
        }
        break;
      case "ANSWER":
        answerControl(action, action.answer, label, name, { add, onCard, blocks, players, secondary, leftover });
        break;
    }
  }

  const cards: Controls["cards"] = {};
  for (const [id, choices] of onCard) {
    const only = choices.length === 1 ? choices[0] : undefined;
    // A hand card lifts first [R]: the first tap shows it large, a second tap plays it.
    if (hand.has(id) && selection !== id && shown.view.decision?.kind === "priority") {
      cards[id] = { label: `${name(id)}: lift`, tap: { kind: "select" } };
    } else {
      cards[id] = {
        label: only === undefined ? `${name(id)}: choose` : `${name(id)}: ${only.label}`,
        tap: only === undefined ? { kind: "menu", choices } : { kind: "send", choice: only },
      };
    }
  }
  // Blocking takes two taps [R]: the blocker, then the attacker it blocks (or one, when it can block only one).
  for (const [blocker, choices] of blocks) {
    const only = choices.length === 1 ? choices[0] : undefined;
    if (only !== undefined)
      cards[blocker] = { label: `${name(blocker)}: ${only.label}`, tap: { kind: "send", choice: only } };
    else if (selection === blocker) cards[blocker] = { label: `${name(blocker)}: put down`, tap: { kind: "deselect" } };
    else cards[blocker] = { label: `${name(blocker)}: pick to block`, tap: { kind: "select" } };
  }
  if (selection !== null && blocks.has(selection)) {
    for (const choice of blocks.get(selection) ?? []) {
      if (choice.action.type !== "ANSWER" || choice.action.answer.kind !== "declareBlocker") continue;
      const attacker = choice.action.answer.block.attacker;
      cards[attacker] = { label: `${name(attacker)}: blocked by ${name(selection)}`, tap: { kind: "send", choice } };
    }
  }
  // Any other hand card lifts too, to be read, while priority waits; a second tap puts it down.
  if (shown.view.decision?.kind === "priority") {
    for (const id of hand) {
      if (cards[id] !== undefined) continue;
      cards[id] =
        selection === id
          ? { label: `${name(id)}: put down`, tap: { kind: "deselect" } }
          : { label: `${name(id)}: lift`, tap: { kind: "select" } };
    }
  }
  return {
    cards,
    players,
    main,
    secondary,
    prompt: leftover.length === 0 ? null : { title: promptTitle(shown), choices: leftover },
    // A player may concede at any time (CR 104.3a); the engine doesn't list it among the options (D-042).
    concede: shown.view.result === null ? { type: "CONCEDE", player: shown.player } : null,
  };
}

type Sinks = {
  add: (map: Map<ObjectId, Choice[]>, id: ObjectId, choice: Choice) => void;
  onCard: Map<ObjectId, Choice[]>;
  blocks: Map<ObjectId, Choice[]>;
  players: Record<PlayerId, Choice[]>;
  secondary: Choice[];
  leftover: Choice[];
};

/** Where an answer's control goes: on a card, a portrait, beside the main button, or in the prompt. */
function answerControl(action: Action, a: Answer, label: string, name: (id: ObjectId) => string, to: Sinks): void {
  switch (a.kind) {
    case "chooseTarget":
      if (a.target.kind === "object") to.add(to.onCard, a.target.object, { label, action });
      else to.players[a.target.player] = [...(to.players[a.target.player] ?? []), { label, action }];
      return;
    case "mulliganBottom":
    case "discardToHandSize":
    case "chooseSacrifice":
      to.add(to.onCard, a.object, { label, action });
      return;
    case "declareAttacker":
      to.add(to.onCard, a.attack.attacker, { label: attackLabel(a.attack.attacked ?? null, name), action });
      return;
    case "declareBlocker":
      to.add(to.blocks, a.block.blocker, { label: `Block ${name(a.block.attacker)}`, action });
      return;
    case "takeBack":
      to.secondary.push({ label: "Undo", action });
      return;
    case "cancelCast":
      to.secondary.push({ label: "Cancel", action });
      return;
    // The rest have no card to tap: the prompt asks (bespoke prompts for each are M3-04b's slice 2).
    case "chooseStartingPlayer":
    case "mulligan":
    case "announceX":
    case "chooseTargetCount":
    case "divide":
    case "payMana":
    case "finishDeclaring":
    case "orderTrigger":
    case "assignDamage":
    case "chooseCard":
    case "finishChoosing":
    case "chooseYesNo":
    case "chooseNewTarget":
    case "chooseReplacement":
    case "chooseName":
      to.leftover.push({ label, action });
      return;
  }
}

function attackLabel(planeswalker: ObjectId | null, name: (id: ObjectId) => string): string {
  return planeswalker === null ? "Attack" : `Attack ${name(planeswalker)}`;
}

/** What the prompt asks, by the decision waiting (ui.md: always say what the game is waiting for). */
export function promptTitle(shown: SeatView): string {
  const kind = shown.view.decision?.kind;
  switch (kind) {
    case "chooseStartingPlayer":
      return "Who goes first?";
    case "mulligan":
      return "Keep this hand?";
    case "mulliganBottom":
      return "Put a card on the bottom";
    case "discardToHandSize":
      return "Discard down to your hand size";
    case "chooseTarget":
      return "Choose a target";
    case "announceX":
      return "Choose X";
    case "chooseTargetCount":
      return "How many targets?";
    case "divide":
      return "Divide it among the targets";
    case "assignDamage":
      return "Assign combat damage";
    case "payMana":
      return "Pay the cost";
    case "chooseSacrifice":
      return "Choose what to sacrifice";
    case "chooseCards":
      return "Choose cards";
    case "orderTriggers":
      return "Which goes on the stack first?";
    case "chooseYesNo":
      return "Do you want to?";
    case "keepLegend":
      return "Choose the legend to keep";
    case "chooseReplacement":
      return "Which effect applies first?";
    case "chooseName":
      return "Name a card";
    case "chooseNewTarget":
      return "Choose a new target for the copy";
    case "declareAttackers":
      return "Choose attackers";
    case "declareBlockers":
      return "Choose blockers";
    case "priority":
    case undefined:
      return "Choose";
  }
}

/** Two actions are the same choice: plain JSON, compared by their contents. */
export function sameAction(a: Action | null, b: Action | null): boolean {
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
}
