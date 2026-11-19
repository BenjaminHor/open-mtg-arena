// `ai <file> --until p1`: an agent decides for the other players until p1 must decide (or the game ends).
// `auto <file> --ai both --max-turns 30`: agents decide for everyone, to the end; prints a log of the game's events.

import type { CardDatabase, PlayerId } from "@mtg/engine";
import { type PlayLimits, playAgents } from "../agent-play.ts";
import { agentNamed } from "../agents.ts";
import { logLines } from "../event-log.ts";
import { currentState, readGameFile, writeGameFile } from "../game-file.ts";
import { wholeNumber } from "../numbers.ts";
import { showGame } from "../show.ts";

export type AgentOptions = {
  agent?: string | undefined;
  seed?: string | undefined;
  "max-actions"?: string | undefined;
  "max-turns"?: string | undefined;
};

function limits(options: AgentOptions): PlayLimits {
  return {
    maxActions: wholeNumber(options["max-actions"], 10_000, "max-actions"),
    maxTurns: wholeNumber(options["max-turns"], 200, "max-turns"),
  };
}

/** How much of the log `auto` prints: the end of the game; `pnpm cli log` has all of it. */
const LOG_LINES = 2000;

const STOPPED = {
  gameOver: "the game is over",
  yourDecision: "your decision",
  maxActions: "stopped: the action limit was reached (a loop?)",
  maxTurns: "stopped: the turn limit was reached",
} as const;

export function aiCommand(file: string, until: string | undefined, options: AgentOptions, cards: CardDatabase): string {
  if (until === undefined) throw new Error("ai needs --until <player>: the player the agent doesn't play");
  const game = readGameFile(file);
  const start = currentState(game, cards);
  if (!start.turnOrder.includes(until as PlayerId)) throw new Error(`--until: no player ${until}`);
  const seed = wholeNumber(options.seed, 1, "seed");
  const played = playAgents(start, (p) => p !== until, agentNamed(options.agent), seed, limits(options), cards);
  writeGameFile(file, { ...game, actions: [...game.actions, ...played.actions], state: played.state });
  return `${STOPPED[played.stopped]} (${played.actions.length} actions)\n${showGame(played.state, cards)}`;
}

export function autoCommand(file: string, who: string | undefined, options: AgentOptions, cards: CardDatabase): string {
  if (who !== undefined && who !== "both") throw new Error("auto plays every player: --ai both");
  const game = readGameFile(file);
  const start = currentState(game, cards);
  const seed = wholeNumber(options.seed, 1, "seed");
  const played = playAgents(start, () => true, agentNamed(options.agent), seed, limits(options), cards);
  const actions = [...game.actions, ...played.actions];
  writeGameFile(file, { ...game, actions, state: played.state });
  const log = logLines(game.setup, actions, cards, true);
  const shown = log.slice(-LOG_LINES);
  const cut = log.length > shown.length ? [`(${log.length - shown.length} earlier lines: run \`pnpm cli log\`)`] : [];
  return [...cut, ...shown, STOPPED[played.stopped], showGame(played.state, cards)].join("\n");
}
