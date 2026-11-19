// `show <file> [--as p2]`: print the game.

import type { CardDatabase, PlayerId } from "@mtg/engine";
import { currentState, readGameFile } from "../game-file.ts";
import { showGame } from "../show.ts";

export function showCommand(file: string, as: string | undefined, cards: CardDatabase): string {
  const state = currentState(readGameFile(file), cards);
  if (as !== undefined && !state.turnOrder.includes(as as PlayerId)) throw new Error(`--as: no player ${as}`);
  return showGame(state, cards, (as ?? null) as PlayerId | null);
}
