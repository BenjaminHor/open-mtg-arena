// `replay <file> [--step N]`: play the game again from its setup, ignoring any cached state, and show it after N
// actions (all by default). Says if the cached state differs from the replay, which would mean the file came from
// another build of the engine (D-043).

import type { CardDatabase } from "@mtg/engine";
import { readGameFile, replay } from "../game-file.ts";
import { showGame } from "../show.ts";

export function replayCommand(file: string, step: string | undefined, cards: CardDatabase): string {
  const game = readGameFile(file);
  const upTo = step === undefined ? game.actions.length : Number(step);
  if (!Number.isSafeInteger(upTo) || upTo < 0 || upTo > game.actions.length) {
    throw new Error(`--step is a number from 0 to ${game.actions.length}`);
  }
  const { state } = replay(game.setup, game.actions, cards, upTo);
  const lines = [`replayed ${upTo} of ${game.actions.length} actions`];
  if (
    upTo === game.actions.length &&
    game.state !== undefined &&
    JSON.stringify(game.state) !== JSON.stringify(state)
  ) {
    lines.push("warning: the cached state differs from the replay (a file from another build of the engine?)");
  }
  lines.push(showGame(state, cards));
  return lines.join("\n");
}
