// `do <file> <n | step>`: take legal action number n (from `actions`), or a scenario step written as YAML
// (`"cast: Lightning Bolt, targets: [p2], pay: auto"`, docs/testing.md). A step without a player is taken by the
// pending player. All or nothing: if any action of the step fails, the file isn't changed.

import { type Action, applyAction, type CardDatabase, type GameState } from "@mtg/engine";
import { parseStepText, takeStep } from "@mtg/scenarios";
import { currentState, readGameFile, writeGameFile } from "../game-file.ts";
import { showGame } from "../show.ts";
import { numberedActions } from "./actions.ts";

export function doCommand(file: string, what: string, cards: CardDatabase): string {
  const game = readGameFile(file);
  const state = currentState(game, cards);
  // Only a concession needs no pending decision, and the game being over refuses even that (CR 104.1).
  if (state.result !== null) throw new Error("the game is over");
  const done = /^\d+$/.test(what.trim()) ? numbered(Number(what), state, cards) : step(what, state, cards);
  writeGameFile(file, { ...game, actions: [...game.actions, ...done.actions], state: done.state });
  return showGame(done.state, cards);
}

function numbered(n: number, state: GameState, cards: CardDatabase): { state: GameState; actions: Action[] } {
  const action = numberedActions(state, cards)[n - 1];
  if (action === undefined) throw new Error(`no action ${n}: run \`pnpm cli actions\``);
  const result = applyAction(state, action, cards);
  if (!result.ok) throw new Error(`rejected: ${result.error.message}`);
  return { state: result.state, actions: [action] };
}

/** The step, taken by the scenario runner itself (so `do` and scenarios mean the same thing), and its actions. */
function step(text: string, state: GameState, cards: CardDatabase): { state: GameState; actions: Action[] } {
  const parsed = parseStepText(text, state.pending?.player ?? null);
  if (parsed.kind === "expect" || parsed.kind === "expectError" || parsed.kind === "unsupported") {
    throw new Error(`"${text}" isn't a step that acts`);
  }
  const actions: Action[] = [];
  const after = takeStep({ state, events: [] }, parsed, cards, (_game, action) => actions.push(action));
  return { state: after.state, actions };
}
