// Checks a GameSetup before a game is created from it. Returns readable problems; empty means it can start.

import { cardDataByOracleId, isCardName } from "../cards/card-data.ts";
import type { CardDatabase } from "../cards/types.ts";
import { MANA_TYPES } from "../state/mana.ts";
import { isBasicLandType } from "../state/objects.ts";
import type { GameSetup } from "../state/setup.ts";
import type { Step } from "../state/turn.ts";
import { skipsFirstDrawStep } from "./turn-steps.ts";

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
  // Multiplayer start-of-game rules (later: CR 103.5c, 103.8c) aren't built, so only two-player games are allowed for
  // now.
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
      if (cardDataByOracleId(oracleId, cards) === undefined) problems.push(`${player.id}: unknown card ${oracleId}`);
    }
    if (!Number.isSafeInteger(player.life)) problems.push(`${player.id}: life must be an integer`);
    for (const type of MANA_TYPES) {
      const amount = player.manaPool[type];
      if (!Number.isSafeInteger(amount) || amount < 0)
        problems.push(`${player.id}: mana pool ${type} must be 0 or more`);
    }
    for (const [i, permanent] of player.battlefield.entries()) {
      if (!Number.isSafeInteger(permanent.damage) || permanent.damage < 0) {
        problems.push(`${player.id}: damage must be 0 or more`);
      }
      // A planeswalker set up on the battlefield never entered, so nothing gives it loyalty counters (CR 306.5b): the
      // setup must say how many, or it would go at once (CR 704.5i). Every host sets them; none fills them in silently.
      if (
        cardDataByOracleId(permanent.oracleId, cards)?.printed.loyalty !== undefined &&
        !("loyalty" in permanent.counters)
      )
        problems.push(`${player.id}: a planeswalker on the battlefield needs its loyalty counters (CR 306.5b)`);
      // A name chosen as it entered (CR 614.12a) only for a permanent that chooses one, and a card's name (CR 201.4).
      if (permanent.chosenName !== undefined) {
        const chooses = (cardDataByOracleId(permanent.oracleId, cards)?.def.replacements ?? []).some(
          (r) => r.kind === "asEntersChoose" && r.what === "cardName",
        );
        if (!chooses) problems.push(`${player.id}: only a permanent that chooses a card name as it enters has one`);
        if (!isCardName(permanent.chosenName, cards))
          problems.push(`${player.id}: no card is named ${permanent.chosenName} (CR 201.4)`);
      }
      // Likewise a basic land type (CR 205.3i), only for a permanent that chooses one as it enters.
      if (permanent.chosenLandType !== undefined) {
        const chooses = (cardDataByOracleId(permanent.oracleId, cards)?.def.replacements ?? []).some(
          (r) => r.kind === "asEntersChoose" && r.what === "basicLandType",
        );
        if (!chooses) problems.push(`${player.id}: only a permanent that chooses a land type as it enters has one`);
        if (!isBasicLandType(permanent.chosenLandType))
          problems.push(`${player.id}: ${permanent.chosenLandType} isn't a basic land type (CR 205.3i)`);
      }
      const host = permanent.attachedTo;
      if (host === undefined) continue;
      // Only an Aura or Equipment can be attached; anything else enters unattached (CR 303.4h).
      const subtypes = cardDataByOracleId(permanent.oracleId, cards)?.printed.subtypes ?? [];
      if (!subtypes.includes("Aura") && !subtypes.includes("Equipment"))
        problems.push(`${player.id}: only an Aura or Equipment can start attached (CR 303.4h)`);
      const hosts = setup.players.find((p) => p.id === host.player)?.battlefield ?? [];
      if (!Number.isSafeInteger(host.index) || host.index < 0 || host.index >= hosts.length)
        problems.push(`${player.id}: a permanent is attached to nothing on ${host.player}'s battlefield`);
      else if (host.player === player.id && host.index === i)
        problems.push(`${player.id}: a permanent can't be attached to itself (CR 303.4d)`);
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
