// What the card view shows (M3-04c; arena-research.md, "The Examined view"): a card large, and beside it the panels
// Arena calls hangers, one per thing worth knowing that the card's face doesn't say: what each keyword does, its
// counters and damage, what's attached to it, that it entered this turn, who controls it. Pure, from the seat view, so
// it shows only what the person may see (D-062). No rulings: Arena's view has none (D-160).

import type { Keyword, ObjectId, OracleId, SeatView } from "@mtg/engine";
import { cardInfo } from "../board-model/card-info.ts";

export type CardDetails = {
  name: string;
  /** The full card image to show large, or null (a token, a card with no image): then the text is shown instead. */
  image: string | null;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  /** Power/toughness now, when it's a creature: "5/5". */
  powerToughness: string | null;
  /** The hangers: a heading and a line each, in the order they're shown. */
  hangers: { title: string; text: string }[];
};

/**
 * What each keyword does, in a line, in our own words (CR 702). Arena's "keyword reminders" [R]; the card's own text
 * is shown as printed beside it.
 */
const REMINDERS: Record<Keyword, string> = {
  deathtouch: "Any damage it deals to a creature is enough to destroy it.",
  defender: "It can't attack.",
  "double strike": "It deals combat damage twice: in the first-strike step and in the regular one.",
  "first strike": "It deals combat damage before creatures without first strike.",
  flash: "It can be cast any time you could cast an instant.",
  flying: "It can be blocked only by creatures with flying or reach.",
  forestwalk: "It can't be blocked while the defending player controls a Forest.",
  haste: "It can attack and use its {T} abilities the turn it comes under its controller's control.",
  indestructible: 'Damage and effects that say "destroy" don\'t destroy it.',
  lifelink: "Damage it deals also makes its controller gain that much life.",
  reach: "It can block creatures with flying.",
  shroud: "It can't be the target of spells or abilities.",
  swampwalk: "It can't be blocked while the defending player controls a Swamp.",
  trample: "Combat damage beyond what its blockers need can be dealt to the player or planeswalker it attacks.",
  vigilance: "Attacking doesn't cause it to tap.",
};

/**
 * The card view's contents for an object the person can see, or null for one they can't. An ability on the stack shows
 * the card it came from, as the stack draws it; when that card has left (a "dies" trigger), its printed card.
 */
export function cardDetails(shown: SeatView, id: ObjectId): CardDetails | null {
  const object = shown.seen[id];
  if (object?.kind === "ability") {
    const source = shown.seen[object.source];
    return source?.kind === "card" ? cardDetails(shown, source.id) : printedDetails(object.sourceOracleId);
  }
  const seen = object;
  if (seen?.kind !== "card") return null;
  const c = seen.characteristics;
  const info = cardInfo(seen.oracleId);
  const hangers: CardDetails["hangers"] = [];
  for (const keyword of c.keywords) hangers.push({ title: capitalize(keyword), text: REMINDERS[keyword] });
  for (const quality of c.protections) {
    const from = quality.kind === "color" ? colorName(quality.color) : `${quality.subtype}s`;
    hangers.push({
      title: `Protection from ${from}`,
      text: `It can't be blocked by, targeted by or dealt damage by ${from}, nor enchanted or equipped by them.`,
    });
  }
  const onBattlefield = shown.view.zones.battlefield.includes(seen.id);
  if (onBattlefield) {
    // CR 302.6: true from when it comes under its controller's control until their next turn begins, so also through
    // the opponent's turn in between.
    if (seen.summoningSick) {
      hangers.push({
        title: "Summoning sick",
        text: "Its controller hasn't controlled it since their turn began: it can't attack or use {T} abilities yet.",
      });
    }
    for (const [kind, count] of Object.entries(seen.counters)) {
      if (count > 0) hangers.push({ title: "Counters", text: `${count} ${kind} counter${count === 1 ? "" : "s"}` });
    }
    if (seen.damage > 0) hangers.push({ title: "Damage", text: `${seen.damage} damage marked this turn` });
    if (seen.regenerationShields > 0) {
      hangers.push({
        title: "Regeneration",
        text: `${seen.regenerationShields} shield${seen.regenerationShields === 1 ? "" : "s"} this turn`,
      });
    }
    if (seen.attachedTo !== null) hangers.push({ title: "Attached to", text: nameOf(shown, seen.attachedTo) });
    const attached = shown.view.zones.battlefield.filter((other) => {
      const o = shown.seen[other];
      return o?.kind === "card" && o.attachedTo === seen.id;
    });
    if (attached.length > 0) {
      hangers.push({ title: "Attached", text: attached.map((other) => nameOf(shown, other)).join(", ") });
    }
    if (c.controller !== seen.owner) {
      hangers.push({
        title: "Control",
        text: `${who(shown, c.controller)} control${c.controller === shown.player ? "" : "s"} it; ${who(shown, seen.owner).toLowerCase()} own${seen.owner === shown.player ? "" : "s"} it.`,
      });
    }
  }
  if (seen.chosen !== null) hangers.push({ title: "Chosen", text: seen.chosen });
  if (seen.token)
    hangers.push({ title: "Token", text: "Not a card: it ceases to exist when it leaves the battlefield." });
  if (seen.copy) hangers.push({ title: "Copy", text: "A copy of a spell, not a card." });
  // Against the printed numbers only when there are some: not for a printed "*" or a noncreature made a creature.
  const printed =
    info === null || info.power === null || info.toughness === null ? null : `${info.power}/${info.toughness}`;
  const now = c.power === null || c.toughness === null ? null : `${c.power}/${c.toughness}`;
  if (now !== null && printed !== null && now !== printed && onBattlefield) {
    hangers.push({ title: "Power/toughness", text: `${now} now (printed ${printed})` });
  }
  return {
    name: c.name,
    image: info?.image ?? null,
    manaCost: info?.manaCost ?? "",
    typeLine: info?.typeLine ?? typeLine(c.supertypes, c.types, c.subtypes),
    oracleText: info?.oracleText ?? "",
    powerToughness: now,
    hangers,
  };
}

/** A card by its printed face alone: an ability's source that has left the zones the person can see. */
function printedDetails(oracleId: OracleId): CardDetails | null {
  const info = cardInfo(oracleId);
  if (info === null) return null;
  return {
    name: info.name,
    image: info.image,
    manaCost: info.manaCost,
    typeLine: info.typeLine,
    oracleText: info.oracleText,
    powerToughness: info.power === null || info.toughness === null ? null : `${info.power}/${info.toughness}`,
    hangers: [],
  };
}

/**
 * A type line from the characteristics, for a card with no printed one (a token): "Creature — Soldier" (CR 205.1).
 * Later: a token's ability text, which the seat view doesn't carry yet (status.md, Known issues).
 */
function typeLine(supertypes: readonly string[], types: readonly string[], subtypes: readonly string[]): string {
  const front = [...supertypes, ...types].map(capitalize).join(" ");
  return subtypes.length === 0 ? front : `${front} — ${subtypes.join(" ")}`;
}

function nameOf(shown: SeatView, id: ObjectId): string {
  const seen = shown.seen[id];
  return seen?.kind === "card" ? seen.characteristics.name : "a hidden card";
}

/** A player as the person reads them. Two players for now: later, with more (CR 800), by name. */
function who(shown: SeatView, player: string): string {
  return player === shown.player ? "You" : "Your opponent";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function colorName(color: string): string {
  return ({ W: "white", U: "blue", B: "black", R: "red", G: "green" } as Record<string, string>)[color] ?? color;
}
