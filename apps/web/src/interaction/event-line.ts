// What a frame of the host's run shows, in a line ("Opponent cast Lightning Bolt"), while it holds (D-172; ui.md, "The
// game never jumps"). Its most telling event says it: the one held longest (`pacing.ts`), the first of those. Objects
// are named from the views on either side of the frame, since a resolved spell or a dead creature is only in the one
// before; hidden events say only what's public (D-062).

import type { ObjectId, PlayerId, SeatView, Target, ViewEvent } from "@mtg/engine";
import { objectName, who } from "./names.ts";
import { eventHold } from "./pacing.ts";

export function eventLine(events: readonly ViewEvent[], before: SeatView | null, after: SeatView): string | null {
  const me = after.player;
  let telling: ViewEvent | null = null;
  for (const e of events) {
    if (eventHold(e, me) > (telling === null ? 0 : eventHold(telling, me))) telling = e;
  }
  return telling === null ? null : lineOf(telling, before, after);
}

function lineOf(e: ViewEvent, before: SeatView | null, after: SeatView): string | null {
  const name = (id: ObjectId) => named(id, before, after);
  const player = (p: PlayerId) => who(after, p);
  switch (e.type) {
    case "SPELL_CAST":
      return `${player(e.player)} cast ${name(e.object)}`;
    case "ABILITY_ACTIVATED":
      return `${player(e.player)} activated ${name(e.object)}`;
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
      return `${name(e.source)} dealt ${e.amount} damage to ${target(e.to, before, after)}`;
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

/** An object by name from whichever side of the frame has it: "a card" when neither does (it's hidden). */
function named(id: ObjectId, before: SeatView | null, after: SeatView): string {
  if (after.seen[id] !== undefined) return objectName(after, id);
  if (before?.seen[id] !== undefined) return objectName(before, id);
  return "a card";
}

function target(t: Target, before: SeatView | null, after: SeatView): string {
  if (t.kind === "player") return t.player === after.player ? "you" : "your opponent";
  return named(t.object, before, after);
}

/** One name, or "Grizzly Bears and 2 others". */
function count(names: readonly string[]): string {
  const [first] = names;
  if (first === undefined) return "nothing";
  return names.length === 1 ? first : `${first} and ${names.length - 1} other${names.length === 2 ? "" : "s"}`;
}
