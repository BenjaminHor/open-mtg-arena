// Checks a GameSetup before a game is created from it. Returns readable problems; empty means it can start.

import type { CardDatabase } from "../cards/types.ts";
import { MANA_TYPES } from "../state/mana.ts";
import type { GameSetup } from "../state/setup.ts";
import type { Step } from "../state/turn.ts";
import { skipsFirstDrawStep } from "./steps.ts";

/** The starting hand size (CR 103.5). Rule modifiers may change it later. */
export const STARTING_HAND_SIZE = 7;

/**
 * Steps a `fixed` opening may start in. Untap and cleanup normally give no one priority (CR 502.4, 514.3), and the
 * combat steps after beginning of combat need combat state (attackers, blockers) the setup can't express yet.
 */
const FIXED_START_STEPS: readonly Step[] = [
  "upkeep",
  "draw",
  "precombatMain",
  "beginningOfCombat",
  "postcombatMain",
  "end",
];

export function setupProblems(setup: GameSetup, cards: CardDatabase): string[] {
  const problems: string[] = [];
  if (!Number.isSafeInteger(setup.seed) || setup.seed < 0) problems.push("seed must be a non-negative safe integer");
  // Multiplayer start-of-game rules (CR 103.5c, 103.8c) aren't built, so only two-player games are allowed for now.
  if (setup.players.length !== 2) problems.push("only two-player games are supported so far");
  const ids = setup.players.map((p) => p.id);
  if (ids.some((id, i) => ids.indexOf(id) !== i)) problems.push("player ids must be different");

  for (const player of setup.players) {
    if (!/^p[1-9][0-9]*$/.test(player.id)) problems.push(`"${player.id}" isn't a player id like p1`);
    const all = [
      ...player.library,
      ...player.hand,
      ...player.graveyard,
      ...player.exile,
      ...player.battlefield.map((b) => b.oracleId),
    ];
    for (const oracleId of all.filter((id, i) => all.indexOf(id) === i)) {
      if (cards[oracleId] === undefined) problems.push(`${player.id}: unknown card ${oracleId}`);
    }
    if (!Number.isSafeInteger(player.life)) problems.push(`${player.id}: life must be an integer`);
    for (const type of MANA_TYPES) {
      const amount = player.manaPool[type];
      if (!Number.isSafeInteger(amount) || amount < 0)
        problems.push(`${player.id}: mana pool ${type} must be 0 or more`);
    }
    for (const permanent of player.battlefield) {
      if (!Number.isSafeInteger(permanent.damage) || permanent.damage < 0) {
        problems.push(`${player.id}: damage must be 0 or more`);
      }
    }
    if (setup.opening.kind === "standard") {
      if (player.hand.length > 0)
        problems.push(`${player.id}: a standard opening draws the hand, so hand must be empty`);
      // Mana empties at the end of every step (CR 106.4), so none can be left over from before the game.
      if (MANA_TYPES.some((t) => player.manaPool[t] !== 0))
        problems.push(`${player.id}: a standard opening starts with no mana`);
      // Mulligans shuffle the hand back, so a library this big can never run out before the first turn.
      if (player.library.length < STARTING_HAND_SIZE) {
        problems.push(`${player.id}: the deck needs at least ${STARTING_HAND_SIZE} cards to draw an opening hand`);
      }
    }
  }

  const opening = setup.opening;
  if (opening.kind === "standard" && opening.firstPlayer !== null && !ids.includes(opening.firstPlayer)) {
    problems.push(`firstPlayer ${opening.firstPlayer} isn't a player`);
  }
  if (opening.kind === "fixed") {
    if (!ids.includes(opening.turn.activePlayer))
      problems.push(`active player ${opening.turn.activePlayer} isn't a player`);
    if (!Number.isSafeInteger(opening.turn.number) || opening.turn.number < 1)
      problems.push("turn number must be 1 or more");
    if (!FIXED_START_STEPS.includes(opening.turn.step)) {
      problems.push(`a fixed opening can't start in the ${opening.turn.step} step yet`);
    }
    if (opening.turn.step === "draw" && skipsFirstDrawStep(opening.turn.number, setup.players.length)) {
      problems.push("the starting player has no draw step on turn 1 (CR 103.8a)");
    }
  }
  for (const modifier of setup.ruleModifiers) {
    if (!ids.includes(modifier.controller)) problems.push(`rule modifier for unknown player ${modifier.controller}`);
  }
  return problems;
}
