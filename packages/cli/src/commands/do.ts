// `do <file> <n | step>`: take legal action number n (from `actions`), or a scenario step written as YAML
// (`"cast: Lightning Bolt, targets: [p2], pay: auto"`, docs/testing.md). A step without a player is taken by the
// pending player. All or nothing: if any action of the step fails, the file isn't changed.

import { type Action, applyAction, type CardDatabase } from "@mtg/engine";
import { parseStepText, takeStep } from "@mtg/scenarios";
import { currentState, readGameFile, writeGameFile } from "../game-file.ts";
import { showGame } from "../show.ts";
import { numberedActions } from "./actions.ts";

export function doCommand(file: string, what: string, cards: CardDatabase): string {
  const game = readGameFile(file);
  const state = currentState(game, cards);
  const taken = /^\d+$/.test(what.trim()) ? [numbered(Number(what), state, cards)] : stepActions(what, game, cards);
  let next = state;
  for (const action of taken) {
    const result = applyAction(next, action, cards);
    if (!result.ok) throw new Error(`rejected: ${result.error.message}`);
    next = result.state;
  }
  writeGameFile(file, { ...game, actions: [...game.actions, ...taken], state: next });
  return showGame(next, cards);
}

function numbered(n: number, state: Parameters<typeof numberedActions>[0], cards: CardDatabase): Action {
  const action = numberedActions(state, cards)[n - 1];
  if (action === undefined) throw new Error(`no action ${n}: run \`pnpm cli actions\``);
  return action;
}

/** The actions a step takes, found by the scenario runner itself, so `do` and scenarios mean the same thing. */
function stepActions(text: string, game: ReturnType<typeof readGameFile>, cards: CardDatabase): Action[] {
  const state = currentState(game, cards);
  const player = state.pending?.player;
  const withPlayer =
    /^\s*(\{\s*)?(p\d+ |all pass)/.test(text) || player === undefined ? text : `${player} ${text.trim()}`;
  const step = parseStepText(withPlayer);
  if (step.kind === "expect" || step.kind === "expectError" || step.kind === "unsupported") {
    throw new Error(`"${text}" isn't a step that acts`);
  }
  const taken: Action[] = [];
  takeStep({ state, events: [] }, step, cards, (_game, action) => taken.push(action));
  return taken;
}
