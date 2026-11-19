// `ai <file> --until p1`: an agent decides for the other players until p1 must decide (or the game ends).
// `auto <file> --ai both --max-turns 30`: agents decide for everyone, to the end; prints a log of the game's events.

import type { CardDatabase, PlayerId } from "@mtg/engine";
import { type PlayLimits, playAgents } from "../agent-play.ts";
import { agentNamed } from "../agents.ts";
import { logLines } from "../event-log.ts";
import { currentState, readGameFile, writeGameFile } from "../game-file.ts";
import { showGame } from "../show.ts";

export type AgentOptions = {
  agent?: string | undefined;
  seed?: string | undefined;
  "max-actions"?: string | undefined;
  "max-turns"?: string | undefined;
};

function limits(options: AgentOptions): PlayLimits {
  const num = (value: string | undefined, fallback: number, what: string) => {
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`--${what} is a whole number`);
    return n;
  };
  return {
    maxActions: num(options["max-actions"], 10_000, "max-actions"),
    maxTurns: num(options["max-turns"], 200, "max-turns"),
  };
}

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
  const seed = Number(options.seed ?? 1);
  const played = playAgents(start, (p) => p !== until, agentNamed(options.agent), seed, limits(options), cards);
  writeGameFile(file, { ...game, actions: [...game.actions, ...played.actions], state: played.state });
  return `${STOPPED[played.stopped]} (${played.actions.length} actions)\n${showGame(played.state, cards)}`;
}

export function autoCommand(file: string, who: string | undefined, options: AgentOptions, cards: CardDatabase): string {
  if (who !== undefined && who !== "both") throw new Error("auto plays every player: --ai both");
  const game = readGameFile(file);
  const start = currentState(game, cards);
  const seed = Number(options.seed ?? 1);
  const played = playAgents(start, () => true, agentNamed(options.agent), seed, limits(options), cards);
  const actions = [...game.actions, ...played.actions];
  writeGameFile(file, { ...game, actions, state: played.state });
  const log = logLines(game.setup, actions, cards, true).slice(-2000);
  return [...log, STOPPED[played.stopped], showGame(played.state, cards)].join("\n");
}
