// What `brief` says about each object a player can see (M2-15f): a card's name, cost, type line and Oracle text, and
// for a permanent its current characteristics and status. Read only for objects in the viewer's `playerView`, so it
// says nothing about a hidden card. Characteristics are derived values the view doesn't carry; the host computes them
// from the full state for public objects (D-135), as M3's match host will.

import {
  type CardDatabase,
  type CardObject,
  type Color,
  cardDataByOracleId,
  cardDataOf,
  characteristics,
  controllerOf,
  type GameState,
  isAttacking,
  isBlocking,
  isFreeOfSummoningSickness,
  isToken,
  type ManaCost,
  type ObjectId,
  type PlayerId,
  type ProtectionQuality,
} from "@mtg/engine";
import { nameOf, refOf } from "@mtg/scenarios";
import { attackedText, objectText, targetText } from "../describe.ts";

/** A card or token as anyone who sees it may read it. */
export type CardInfo = {
  id: ObjectId;
  name: string;
  /** `{1}{R}`; null when it has no mana cost (a land, CR 202.1b). */
  manaCost: string | null;
  /** `Creature — Goblin Warrior`, as its characteristics are now. */
  typeLine: string;
  /** Its Oracle text, as its definition was written against (a Clone's is what it copied). */
  text: string;
};

/** A permanent: the card, plus what it is and how it stands now (CR 110.5, 613). */
export type PermanentInfo = CardInfo & {
  /** How `do` steps name it: `p2:Grizzly Bears`. */
  ref: string;
  controller: PlayerId;
  owner: PlayerId;
  token: boolean;
  power: number | null;
  toughness: number | null;
  /** Keywords and protections it has now, granted ones included (layer 6). */
  keywords: string[];
  tapped: boolean;
  /** A creature that can't attack or use {T} abilities yet (CR 302.6). */
  summoningSick: boolean;
  damage: number;
  counters: Record<string, number>;
  /** What it's attached to (an Aura or Equipment, CR 303.4, 301.5), by reference. */
  attachedTo: string | null;
  /** What it's attacking (a player or planeswalker), while it's an attacking creature (CR 506.4). */
  attacking: string | null;
  /** The attackers it blocks, while it's a blocking creature. */
  blocking: string[];
  /** A name or basic land type chosen as it entered (CR 614.12a). */
  chosen: string | null;
};

/** A spell or ability on the stack. */
export type StackInfo = {
  id: ObjectId;
  name: string;
  kind: "spell" | "copy" | "ability";
  controller: PlayerId;
  targets: string[];
  /** The value announced for X (CR 107.3a), if it has one. */
  x: number | null;
  /** A spell's Oracle text, or the text of the card an ability comes from. */
  text: string;
};

export function cardInfo(state: GameState, id: ObjectId, cards: CardDatabase): CardInfo {
  const obj = state.objects[id];
  const data = obj?.kind === "card" ? cardDataOf(obj, cards) : undefined;
  const c = characteristics(state, id, cards);
  const subtypes = c.subtypes.length > 0 ? ` — ${c.subtypes.join(" ")}` : "";
  return {
    id,
    name: nameOf(state, id, cards),
    manaCost: data?.printed.manaCost == null ? null : manaCostText(data.printed.manaCost),
    typeLine: `${[...c.supertypes, ...c.types].map(capitalized).join(" ")}${subtypes}`,
    text: data?.def.oracle ?? "",
  };
}

export function permanentInfo(state: GameState, id: ObjectId, cards: CardDatabase): PermanentInfo {
  const obj = state.objects[id] as CardObject;
  const c = characteristics(state, id, cards);
  const blocks = isBlocking(state, id, cards) ? (state.combat?.blocks ?? []).filter((b) => b.blocker === id) : [];
  const attack = isAttacking(state, id, cards) ? state.combat?.attacks.find((a) => a.attacker === id) : undefined;
  return {
    ...cardInfo(state, id, cards),
    ref: refOf(state, id, cards) ?? nameOf(state, id, cards),
    controller: c.controller,
    owner: obj.owner,
    token: isToken(obj),
    power: c.power,
    toughness: c.toughness,
    keywords: [...c.keywords, ...c.protections.map((q) => `protection from ${protectionText(q)}`)],
    tapped: obj.tapped,
    summoningSick: c.types.includes("creature") && !isFreeOfSummoningSickness(state, id, cards),
    damage: obj.damage,
    counters: obj.counters,
    attachedTo: obj.attachedTo === undefined ? null : objectText(state, obj.attachedTo, cards),
    attacking: attack === undefined ? null : attackedText(state, attack, cards),
    blocking: blocks.map((b) => objectText(state, b.attacker, cards)),
    chosen: obj.chosenName ?? obj.chosenLandType ?? null,
  };
}

export function stackInfo(state: GameState, id: ObjectId, cards: CardDatabase): StackInfo {
  const obj = state.objects[id];
  const choices = obj?.kind === "ability" ? obj.choices : obj?.kind === "card" ? obj.choices : null;
  const text =
    obj?.kind === "ability"
      ? (cardDataByOracleId(obj.sourceOracleId, cards)?.def.oracle ?? "")
      : obj?.kind === "card"
        ? (cardDataOf(obj, cards)?.def.oracle ?? "")
        : "";
  return {
    id,
    name: nameOf(state, id, cards),
    kind: obj?.kind === "ability" ? "ability" : obj?.kind === "card" && obj.copy === true ? "copy" : "spell",
    controller: controllerOf(state, id, cards),
    targets: (choices?.targets ?? []).flat().map((t) => targetText(state, t, cards)),
    x: choices?.x ?? null,
    text,
  };
}

/** `{X}{1}{R}`. */
export function manaCostText(cost: ManaCost): string {
  return cost.map(symbolText).join("");
}

function symbolText(s: ManaCost[number]): string {
  switch (s.kind) {
    case "generic":
      return `{${s.amount}}`;
    case "x":
      return "{X}";
    case "colored":
      return `{${s.color}}`;
  }
}

/** "protection from black", "protection from Demons" (CR 702.16a). */
function protectionText(q: ProtectionQuality): string {
  switch (q.kind) {
    case "color":
      return COLOR_NAMES[q.color];
    case "subtype":
      return `${q.subtype}s`;
  }
}

const COLOR_NAMES: Record<Color, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
