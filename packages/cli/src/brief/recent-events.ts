// What one player saw happen since they last acted, as lines (`brief`, M2-15f). The events go through the engine's
// `eventsFor` (D-044) first, so a line never names a card the viewer couldn't see: another player's draw is "p2 draws a
// card", never which.

import {
  type Action,
  applyAction,
  type CardDatabase,
  createGame,
  eventsFor,
  type GameSetup,
  type GameState,
  type ObjectId,
  type PlayerId,
  type ViewEvent,
  type ZoneRef,
} from "@mtg/engine";
import { refOf } from "@mtg/scenarios";
import { eventText, nameIn } from "../event-log.ts";

/** At most this many lines, the latest kept: a whole opponent's turn fits, a whole game doesn't. */
const MOST = 60;

/**
 * The events from the viewer's last action on, as the viewer may see them, with the turn: `T6 p2 casts Shock`. Before
 * the viewer's first action, everything since the game began. Priority passes and steps beginning are left out, as in
 * `log --brief`.
 */
export function recentLines(
  setup: GameSetup,
  actions: readonly Action[],
  viewer: PlayerId,
  cards: CardDatabase,
): string[] {
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
  const last = actions.findLastIndex((a) => a.player === viewer);
  let lines: string[] = [];
  const add = (events: Parameters<typeof eventsFor>[0], before: GameState, after: GameState) => {
    const name = (id: ObjectId) =>
      refOf(before, id, cards) ?? refOf(after, id, cards) ?? nameIn(before, after, id, cards);
    let turn = before.turn?.number ?? 0;
    const seen = eventsFor(events, viewer);
    for (const [i, event] of seen.entries()) {
      if (event.type === "TURN_BEGAN") turn = event.turn;
      if (event.type === "PRIORITY_PASSED" || event.type === "STEP_BEGAN") continue;
      // A draw is a move from library to hand and then the draw: one line, "p1 draws Plains".
      if (movesToHand(event) && isDrawn(seen[i + 1])) continue;
      lines.push(`T${turn} ${viewEventText(event, name, cards)}`);
    }
  };
  if (last === -1) add(created.events, created.state, created.state);
  let state = created.state;
  for (const [i, action] of actions.entries()) {
    const result = applyAction(state, action, cards);
    if (!result.ok) throw new Error(`action ${i + 1} is rejected: ${result.error.message}`);
    if (i >= last) add(result.events, state, result.state);
    state = result.state;
  }
  lines = collapsed(lines);
  if (lines.length > MOST) lines = [`(${lines.length - MOST} earlier lines left out)`, ...lines.slice(-MOST)];
  return lines;
}

/** The same line several times in a row is written once, with how many: `T0 p2 draws a card (x7)`. */
function collapsed(lines: readonly string[]): string[] {
  const out: string[] = [];
  let run = 0;
  for (const [i, line] of lines.entries()) {
    run += 1;
    if (lines[i + 1] === line) continue;
    out.push(run > 1 ? `${line} (x${run})` : line);
    run = 0;
  }
  return out;
}

/** A view event in words: the hidden-card kinds `eventsFor` makes, or else the event as `log` writes it. */
function viewEventText(e: ViewEvent, name: (id: ObjectId) => string, cards: CardDatabase): string {
  switch (e.type) {
    case "HIDDEN_CARD_DRAWN":
      return `${e.player} draws a card`;
    case "CARD_DRAWN":
      return `${e.player} draws ${name(e.newId)}`;
    case "HIDDEN_CARD_MOVED":
      return `a card moves from ${zoneText(e.from)} to ${zoneText(e.to)}`;
    case "CARD_CAME_INTO_VIEW":
      return `${name(e.newId)} comes from ${zoneText(e.from)} to ${zoneText(e.to)}`;
    case "CARD_LEFT_VIEW":
      return `${name(e.oldId)} moves from ${zoneText(e.from)} to ${zoneText(e.to)}`;
    case "HIDDEN_TOKEN_CEASED_TO_EXIST":
      return `a token in ${zoneText(e.from)} ceases to exist`;
    default:
      return eventText(e, name, cards);
  }
}

/** A card moved into a hand, seen or not: the first half of a draw. */
function movesToHand(e: ViewEvent): boolean {
  switch (e.type) {
    case "ZONE_CHANGED":
    case "CARD_CAME_INTO_VIEW":
    case "HIDDEN_CARD_MOVED":
      return e.to.zone === "hand";
    default:
      return false;
  }
}

function isDrawn(next: ViewEvent | undefined): boolean {
  return next?.type === "CARD_DRAWN" || next?.type === "HIDDEN_CARD_DRAWN";
}

function zoneText(ref: ZoneRef): string {
  return "player" in ref ? `${ref.player}'s ${ref.zone}` : `the ${ref.zone}`;
}
