// `brief <file> --as p1 [--text] [--json]`: everything p1 may know when they decide, the events they saw since they
// last acted, and their legal actions (M2-15f). `--json` is for programs, such as an AI agent playing through the CLI.

import type { CardDatabase, PlayerId } from "@mtg/engine";
import { briefOf } from "../brief/brief.ts";
import { briefText } from "../brief/brief-text.ts";
import { recentLines } from "../brief/recent-events.ts";
import { currentState, readGameFile } from "../game-file.ts";

export function briefCommand(
  file: string,
  options: { as: string | undefined; text: boolean; json: boolean },
  cards: CardDatabase,
): string {
  const game = readGameFile(file);
  const state = currentState(game, cards);
  const viewer = options.as as PlayerId | undefined;
  // A brief is one player's: there's no omniscient one (`show` without --as is that).
  if (viewer === undefined) throw new Error("brief needs --as <player>");
  if (!state.turnOrder.includes(viewer)) throw new Error(`--as: no player ${viewer}`);
  const brief = briefOf(state, viewer, recentLines(game.setup, game.actions, viewer, cards), cards);
  return options.json ? JSON.stringify(brief, null, 2) : briefText(brief, options.text);
}
