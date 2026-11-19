// `show`: the whole situation at a glance (docs/testing.md, section 2). Plain, stable text, so tests and Claude Code
// can read it.

import {
  type CardDatabase,
  characteristics,
  type GameState,
  legalActions,
  type ObjectId,
  type PlayerId,
} from "@mtg/engine";
import { nameOf, scenarioStep } from "@mtg/scenarios";
import { manaText, objectText, targetText } from "./describe.ts";

/**
 * Whether `viewer` may see the cards in `owner`'s hand. With no viewer (debug), everything shows. The one place the
 * CLI hides information; the engine's `playerView` (architecture.md) arrives with the AI that needs it (M2).
 */
export function canSeeHand(viewer: PlayerId | null, owner: PlayerId): boolean {
  return viewer === null || viewer === owner;
}

export function showGame(state: GameState, cards: CardDatabase, viewer: PlayerId | null = null): string {
  const lines = [headline(state)];
  // The player at the bottom is the viewer, or else the active player; the others are above, as across a table.
  const bottom = viewer ?? state.turn?.activePlayer ?? state.turnOrder[0];
  const others = state.turnOrder.filter((p) => p !== bottom);
  for (const p of others) lines.push(...playerLines(state, p, viewer, cards));
  lines.push(`stack: ${stackText(state, cards)}`);
  if (bottom !== undefined) lines.push(...playerLines(state, bottom, viewer, cards));
  lines.push(pendingLine(state, cards));
  return lines.join("\n");
}

function headline(state: GameState): string {
  const turn = state.turn;
  if (turn === null) return "Before the first turn";
  const holder = state.pending?.kind === "priority" ? ` · ${state.pending.player} has priority` : "";
  return `Turn ${turn.number} · ${turn.activePlayer} · ${scenarioStep(turn.step)}${holder}`;
}

function playerLines(state: GameState, player: PlayerId, viewer: PlayerId | null, cards: CardDatabase): string[] {
  const ps = state.players[player];
  const zones = state.zones.players[player];
  if (ps === undefined || zones === undefined) return [];
  const pool = Object.values(ps.manaPool).some((n) => n > 0) ? `  mana ${manaText(ps.manaPool)}` : "";
  const lines = [
    `${player}  life ${ps.life}  hand ${zones.hand.length}  library ${zones.library.length}  graveyard ${zones.graveyard.length}${pool}`,
  ];
  const permanents = state.zones.battlefield.filter((id) => characteristics(state, id, cards).controller === player);
  lines.push(
    `    battlefield: ${permanents.length === 0 ? "(none)" : permanents.map((id) => permanentText(state, id, cards)).join(", ")}`,
  );
  if (canSeeHand(viewer, player) && zones.hand.length > 0) {
    lines.push(`    hand: ${zones.hand.map((id) => nameOf(state, id, cards)).join(", ")}`);
  }
  if (zones.graveyard.length > 0) {
    lines.push(`    graveyard: ${zones.graveyard.map((id) => nameOf(state, id, cards)).join(", ")}`);
  }
  return lines;
}

/** `Grizzly Bears 2/2 (T, sick, 1 damage, attacking)`. */
function permanentText(state: GameState, id: ObjectId, cards: CardDatabase): string {
  const obj = state.objects[id];
  const c = characteristics(state, id, cards);
  const pt = c.power !== null && c.toughness !== null ? ` ${c.power}/${c.toughness}` : "";
  const notes: string[] = [];
  if (obj?.kind === "card") {
    if (obj.tapped) notes.push("T");
    // Summoning sick: can't attack or use {T} yet (CR 302.6); haste ignores that (CR 702.10).
    if (c.types.includes("creature") && !obj.controlledSinceTurnStart && !c.keywords.includes("haste"))
      notes.push("sick");
    if (obj.damage > 0) notes.push(`${obj.damage} damage`);
  }
  if (state.combat?.attacks.some((a) => a.attacker === id)) notes.push("attacking");
  const blocking = state.combat?.blocks.find((b) => b.blocker === id);
  if (blocking !== undefined) notes.push(`blocking ${objectText(state, blocking.attacker, cards)}`);
  return `${c.name}${pt}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
}

/** Bottom to top, with each spell's or ability's targets and controller. */
function stackText(state: GameState, cards: CardDatabase): string {
  if (state.zones.stack.length === 0) return "(empty)";
  return state.zones.stack
    .map((id) => {
      const obj = state.objects[id];
      const targets = (obj?.choices?.targets ?? []).flat().map((t) => targetText(state, t, cards));
      const arrow = targets.length > 0 ? ` → ${targets.join(", ")}` : "";
      return `${nameOf(state, id, cards)}${arrow} (${obj?.baseController ?? "?"})`;
    })
    .join(", ");
}

function pendingLine(state: GameState, cards: CardDatabase): string {
  const result = state.result;
  if (result !== null) {
    const losses = result.losses.map((l) => `${l.player}: ${l.reason}`).join(", ");
    const outcome = result.winner === null ? "a draw" : `${result.winner} wins`;
    return `game over: ${outcome} (${losses}) on turn ${result.turn}`;
  }
  const pending = state.pending;
  if (pending === null) return "pending: nothing";
  const count = legalActions(state, pending.player, cards).length;
  return `pending: ${pending.kind} (${pending.player}) — ${count} legal actions; run \`pnpm cli actions\``;
}
