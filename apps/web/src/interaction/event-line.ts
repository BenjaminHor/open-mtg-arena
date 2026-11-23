// What a frame of the host's run shows, in a line ("Opponent cast Lightning Bolt"), while it holds (D-172; ui.md, "The
// game never jumps"). Its most telling event says it: the one held longest (`pacing.ts`), the first of those. Objects
// are named from the views on either side of the frame, since a resolved spell or a dead creature is only in the one
// before; hidden events say only what's public (D-062).

import type { ObjectId, PlayerId, SeatView, Target, ViewEvent } from "@mtg/engine";
import { nameOf } from "../board-model/card-info.ts";
import { objectName, who } from "./names.ts";
import { eventHold } from "./pacing.ts";

export function eventLine(events: readonly ViewEvent[], before: SeatView | null, after: SeatView): string | null {
  const me = after.player;
  const moved = movedNames(events);
  // Among the events with a line: a new turn's (no line, its banner says it) never hides the land played after it.
  let best: { line: string; hold: number } | null = null;
  for (const e of events) {
    const hold = eventHold(e, me);
    if (hold === 0 || (best !== null && hold <= best.hold)) continue;
    const line = summed(e, events, after) ?? lineOf(e, before, after, moved);
    if (line !== null) best = { line, hold };
  }
  return best?.line ?? null;
}

/**
 * What several events of a kind in one frame add up to, said as one line: combat damage from several attackers as
 * what a player took in all ("Your opponent took 8 damage"), several tokens as their count ("Your opponent created 3
 * Soldier Tokens"). Null when the event stands alone (`lineOf` says it).
 */
function summed(e: ViewEvent, events: readonly ViewEvent[], after: SeatView): string | null {
  if (e.type === "DAMAGE_DEALT" && e.to.kind === "player") {
    const to = e.to.player;
    const hits = events.filter((d) => d.type === "DAMAGE_DEALT" && d.to.kind === "player" && d.to.player === to);
    if (hits.length < 2) return null;
    const total = hits.reduce((sum, d) => sum + (d.type === "DAMAGE_DEALT" ? d.amount : 0), 0);
    return `${who(after, to)} took ${total} damage`;
  }
  if (e.type === "TOKEN_CREATED") {
    const made = events.filter((t) => t.type === "TOKEN_CREATED" && t.player === e.player);
    if (made.length < 2) return null;
    // Named when they're all the same seen token ("Soldier Tokens"), else just "tokens".
    const names = new Set(
      made.map((t) => {
        const seen = t.type === "TOKEN_CREATED" ? after.seen[t.object] : undefined;
        return seen?.kind === "card" ? seen.characteristics.name : null;
      }),
    );
    const [name] = names;
    return `${who(after, e.player)} created ${made.length} ${names.size === 1 && typeof name === "string" ? `${name}s` : "tokens"}`;
  }
  return null;
}

/**
 * The names of the objects that changed zones in these events, by their ids before the move: a spell that resolved is
 * in neither view by that id once the frame is cut (it's a card in a graveyard now, a new object, CR 400.7).
 */
function movedNames(events: readonly ViewEvent[]): ReadonlyMap<ObjectId, string> {
  const names = new Map<ObjectId, string>();
  for (const e of events) {
    if (e.type !== "ZONE_CHANGED") continue;
    const name = nameOf(e.object.oracleId);
    if (name !== null) names.set(e.oldId, name);
  }
  return names;
}

function lineOf(
  e: ViewEvent,
  before: SeatView | null,
  after: SeatView,
  moved: ReadonlyMap<ObjectId, string>,
): string | null {
  const name = (id: ObjectId) => named(id, before, after, moved);
  const player = (p: PlayerId) => who(after, p);
  switch (e.type) {
    case "SPELL_CAST":
      return `${player(e.player)} cast ${name(e.object)}`;
    case "ABILITY_ACTIVATED":
      // "Ajani Goldmane's ability", not "Ajani Goldmane ability" (UX review).
      return `${player(e.player)} activated ${name(e.object).replace(/ ability$/, "'s ability")}`;
    case "ABILITY_TRIGGERED":
      return `${name(e.object)} triggered`;
    case "LAND_PLAYED":
      return `${player(e.player)} played ${name(e.newId)}`;
    case "ATTACKERS_DECLARED":
      return e.attacks.length === 0
        ? `${player(e.player)} didn't attack`
        : `${player(e.player)} attacked with ${count(e.attacks.map((a) => name(a.attacker)))}`;
    case "BLOCKERS_DECLARED":
      return e.blocks.length === 0
        ? `${player(e.player)} didn't block`
        : `${player(e.player)} blocked with ${count(e.blocks.map((b) => name(b.blocker)))}`;
    case "SPELL_RESOLVED":
    case "ABILITY_RESOLVED":
      return `${name(e.object)} resolved`;
    case "SPELL_COUNTERED":
    case "ABILITY_COUNTERED":
      return `${name(e.object)} was countered`;
    case "SPELL_DID_NOT_RESOLVE":
    case "ABILITY_DID_NOT_RESOLVE":
      return `${name(e.object)} did nothing: its targets are gone`;
    case "DAMAGE_DEALT":
      return `${name(e.source)} dealt ${e.amount} damage to ${target(e.to, before, after, moved)}`;
    case "PERMANENT_DESTROYED":
      return `${name(e.object)} was destroyed`;
    case "PERMANENT_SACRIFICED":
      return `${player(e.player)} sacrificed ${name(e.object)}`;
    case "TOKEN_CREATED":
      return `${player(e.player)} created ${name(e.object)}`;
    // A new turn has its own banner; nothing else is held on its own (`pacing.ts`).
    default:
      return null;
  }
}

/**
 * An object by name from whichever side of the frame has it, or from the move that took it out of both: "a card" when
 * none does (it's hidden).
 */
function named(id: ObjectId, before: SeatView | null, after: SeatView, moved: ReadonlyMap<ObjectId, string>): string {
  if (after.seen[id] !== undefined) return objectName(after, id);
  if (before?.seen[id] !== undefined) return objectName(before, id);
  return moved.get(id) ?? "a card";
}

function target(t: Target, before: SeatView | null, after: SeatView, moved: ReadonlyMap<ObjectId, string>): string {
  // Mid-sentence: "you", "your opponent" (`who`, which says how more players would be named).
  if (t.kind === "player") return who(after, t.player).toLowerCase();
  return named(t.object, before, after, moved);
}

/** One name, or "Grizzly Bears and 2 others". */
function count(names: readonly string[]): string {
  const [first] = names;
  if (first === undefined) return "nothing";
  return names.length === 1 ? first : `${first} and ${names.length - 1} other${names.length === 2 ? "" : "s"}`;
}
