// `actions <file>`: the pending player's legal actions, numbered from 1, for `do <file> <n>`. Conceding is always
// allowed and never listed (D-042): `do <file> "p1 concede: now"`.

import { type Action, type CardDatabase, type GameState, legalActions } from "@mtg/engine";
import { actionText } from "../describe.ts";
import { currentState, readGameFile } from "../game-file.ts";

/** The legal actions `actions` numbers, in `legalActions` order. */
export function numberedActions(state: GameState, cards: CardDatabase): Action[] {
  const pending = state.pending;
  return pending === null ? [] : legalActions(state, pending.player, cards);
}

export function actionsCommand(file: string, cards: CardDatabase): string {
  const state = currentState(readGameFile(file), cards);
  const pending = state.pending;
  if (pending === null) return "no actions: the game is over";
  const lines = [`${pending.player} — ${pending.kind}:`];
  numberedActions(state, cards).forEach((action, i) => {
    lines.push(`${String(i + 1).padStart(3)}. ${actionText(state, action, cards)}`);
  });
  return lines.join("\n");
}
