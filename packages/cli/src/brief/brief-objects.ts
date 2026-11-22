// What `brief` says about each object a player can see (M2-15f): a card's name, cost, type line and Oracle text, and
// for a permanent its current characteristics and status. Read only for objects in the viewer's `playerView`, so it
// says nothing about a hidden card. The derived values come from the engine's `seenObjects` (D-135), the one source the
// UI and every AI read too (D-137); this file only puts them into words.

import {
  type CardDatabase,
  type Color,
  cardDataByOracleId,
  cardDataOf,
  type GameState,
  type ManaCost,
  type ObjectId,
  type PlayerId,
  type ProtectionQuality,
  type SeenCard,
  type SeenObject,
} from "@mtg/engine";
import { nameOf, refOf } from "@mtg/scenarios";
import { objectText, targetText } from "../describe.ts";

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

export function cardInfo(state: GameState, seen: SeenCard, cards: CardDatabase): CardInfo {
  const obj = state.objects[seen.id];
  const data = obj?.kind === "card" ? cardDataOf(obj, cards) : undefined;
  const c = seen.characteristics;
  const subtypes = c.subtypes.length > 0 ? ` — ${c.subtypes.join(" ")}` : "";
  return {
    id: seen.id,
    name: nameOf(state, seen.id, cards),
    manaCost: data?.printed.manaCost == null ? null : manaCostText(data.printed.manaCost),
    typeLine: `${[...c.supertypes, ...c.types].map(capitalized).join(" ")}${subtypes}`,
    text: data?.def.oracle ?? "",
  };
}

/** A permanent's description, from what the viewer sees of it (`seenObjects`, D-135). */
export function permanentInfo(state: GameState, seen: SeenCard, cards: CardDatabase): PermanentInfo {
  const c = seen.characteristics;
  return {
    ...cardInfo(state, seen, cards),
    ref: refOf(state, seen.id, cards) ?? nameOf(state, seen.id, cards),
    controller: c.controller,
    owner: seen.owner,
    token: seen.token,
    power: c.power,
    toughness: c.toughness,
    keywords: [...c.keywords, ...c.protections.map((q) => `protection from ${protectionText(q)}`)],
    tapped: seen.tapped,
    summoningSick: seen.summoningSick,
    damage: seen.damage,
    counters: seen.counters,
    attachedTo: seen.attachedTo === null ? null : objectText(state, seen.attachedTo, cards),
    attacking: seen.attacking === null ? null : targetText(state, seen.attacking, cards),
    blocking: seen.blocking.map((attacker) => objectText(state, attacker, cards)),
    chosen: seen.chosen,
  };
}

export function stackInfo(state: GameState, seen: SeenObject, cards: CardDatabase): StackInfo {
  const text = stackText(state, seen, cards);
  return {
    id: seen.id,
    name: nameOf(state, seen.id, cards),
    kind: stackKind(seen),
    controller: seen.kind === "ability" ? seen.controller : seen.characteristics.controller,
    targets: (seen.choices?.targets ?? []).flat().map((t) => targetText(state, t, cards)),
    x: seen.choices?.x ?? null,
    text,
  };
}

/** A spell's Oracle text, or the text of the card an ability comes from. */
function stackText(state: GameState, seen: SeenObject, cards: CardDatabase): string {
  if (seen.kind === "ability") return cardDataByOracleId(seen.sourceOracleId, cards)?.def.oracle ?? "";
  const obj = state.objects[seen.id];
  return obj?.kind === "card" ? (cardDataOf(obj, cards)?.def.oracle ?? "") : "";
}

/** An ability, a copy of a spell (CR 707.10) or a spell. */
function stackKind(seen: SeenObject): StackInfo["kind"] {
  if (seen.kind === "ability") return "ability";
  return seen.copy ? "copy" : "spell";
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
