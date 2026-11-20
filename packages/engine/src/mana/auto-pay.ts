// autoPay: a deterministic way to pay a mana cost, for the scenario runner (`pay: auto`), the CLI and the AI (D-034).
// The rules don't choose for a player; this proposes a choice, and the engine still checks it.

import type { CardDatabase, ManaCost } from "../cards/types.ts";
import { tapsForCost } from "../game/tap-costs.ts";
import { abilitiesOf, isManaAbility } from "../rules/abilities.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { controllerOf } from "../rules/controller.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { MANA_TYPES, type ManaType } from "../state/mana.ts";
import type { AbilityRef } from "../state/objects.ts";
import { manaAbilityProblem } from "./activate.ts";
import type { ManaPayment } from "./payment.ts";

export type AutoPayment = {
  /** Mana abilities to activate first, in order (CR 601.2g). */
  activations: { object: ObjectId; ability: AbilityRef }[];
  /** Then the mana to spend from the pool (CR 601.2h). */
  payment: ManaPayment;
};

/** Spend generic from the pool in this order: colorless first, since it can only ever pay generic costs. */
const GENERIC_ORDER: readonly ManaType[] = ["C", "W", "U", "B", "R", "G"];

/**
 * A way for the player to pay the cost, or null if there's none. Mana already in the pool is used first. Then mana
 * abilities: lands before creatures (keeping creatures free to attack), each group in battlefield order. Colored symbols
 * are paid before generic. With sources that each make one color (all M1 cards), this finds a payment whenever one
 * exists; sources with a choice of colors will need a search.
 */
export function autoPay(state: GameState, player: PlayerId, cost: ManaCost, cards: CardDatabase): AutoPayment | null {
  const pool = { ...(state.players[player]?.manaPool ?? { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }) };
  const sources = manaSources(state, player, cards);
  const used: number[] = [];
  const activations: AutoPayment["activations"] = [];
  const payment: ManaPayment = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

  const take = (allowed: readonly ManaType[]): boolean => {
    const fromPool = allowed.find((t) => pool[t] > 0);
    if (fromPool !== undefined) {
      pool[fromPool] -= 1;
      payment[fromPool] += 1;
      return true;
    }
    const at = sources.findIndex((s, i) => !used.includes(i) && allowed.includes(s.mana));
    const source = sources[at];
    if (source === undefined) return false;
    used.push(at);
    activations.push({ object: source.object, ability: source.ability });
    payment[source.mana] += 1;
    return true;
  };

  // Colored symbols first, then generic, so generic doesn't use up a color a symbol needs.
  const generic: number[] = [];
  for (const symbol of cost) {
    switch (symbol.kind) {
      case "colored":
        if (!take([symbol.color])) return null;
        break;
      case "generic":
        generic.push(symbol.amount);
        break;
      case "x":
        throw new Error("X must be announced before the cost is paid (CR 107.3a)");
    }
  }
  for (const amount of generic) for (let i = 0; i < amount; i++) if (!take(GENERIC_ORDER)) return null;
  return { activations, payment };
}

type Source = { object: ObjectId; ability: AbilityRef; mana: ManaType };

/**
 * The most mana the player could have right now: what's in their pool, and one for each permanent whose mana ability
 * they could activate. Only a guide (`legalActions` lists values of X up to it), not a rule.
 */
export function manaAvailable(state: GameState, player: PlayerId, cards: CardDatabase): number {
  const pool = state.players[player]?.manaPool;
  const inPool = pool === undefined ? 0 : MANA_TYPES.reduce((sum, t) => sum + pool[t], 0);
  return inPool + manaSources(state, player, cards).length;
}

/** The player's permanents that can make one mana now, lands first, each group in battlefield order. */
function manaSources(state: GameState, player: PlayerId, cards: CardDatabase): Source[] {
  const sources: (Source & { land: boolean })[] = [];
  // A permanent the cost being paid taps can't be tapped for mana for it too (CR 107.5).
  const tappedByCost = tapsForCost(state, cards);
  for (const object of state.zones.battlefield) {
    if (controllerOf(state, object) !== player || tappedByCost.includes(object)) continue;
    for (const { ref, def } of abilitiesOf(state, object, cards)) {
      if (!isManaAbility(def) || manaAbilityProblem(state, player, object, ref, cards) !== null) continue;
      const effect = def.effects.find((e) => e.op === "addMana");
      if (effect?.op !== "addMana" || effect.amount !== 1 || !MANA_TYPES.includes(effect.mana)) continue;
      sources.push({
        object,
        ability: ref,
        mana: effect.mana,
        land: cardTypesOf(state, object, cards).includes("land"),
      });
      break; // one mana ability per permanent: activating it taps the permanent
    }
  }
  return [...sources.filter((s) => s.land), ...sources.filter((s) => !s.land)].map(({ land: _land, ...s }) => s);
}
