// `log <file> [--brief]`: the game's events so far, one per line, by turn. Replays the game (events aren't stored).

import type { CardDatabase } from "@mtg/engine";
import { logLines } from "../event-log.ts";
import { readGameFile } from "../game-file.ts";

export function logCommand(file: string, brief: boolean, cards: CardDatabase): string {
  const game = readGameFile(file);
  return logLines(game.setup, game.actions, cards, brief).join("\n");
}
