// autoPay: a deterministic way to pay a mana cost, for the scenario runner (`pay: auto`), the CLI and the AI (D-034).
// The rules don't choose for a player; this proposes a choice, and the engine still checks it.

import type { CardDatabase, Color, Effect, ManaCost } from "../cards/types.ts";
import { permanentsFittingFor } from "../effects/subjects.ts";
import { tapsForCost } from "../game/tap-costs.ts";
import { abilitiesOf, isManaAbility } from "../rules/abilities.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { controllerOf } from "../rules/controller.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { MANA_TYPES, type ManaType } from "../state/mana.ts";
import type { AbilityRef } from "../state/objects.ts";
import { manaAbilityProblem, manaKinds } from "./activate.ts";
import type { ManaPayment } from "./payment.ts";

export type AutoPayment = {
  /** Mana abilities to activate first, in order (CR 601.2g), with the color chosen for "any color" ones (D-068). */
  activations: { object: ObjectId; ability: AbilityRef; color?: Color }[];
  /** Then the mana to spend from the pool (CR 601.2h). */
  payment: ManaPayment;
};

/** Spend generic from the pool in this order: colorless first, since it can only ever pay generic costs. */
const GENERIC_ORDER: readonly ManaType[] = ["C", "W", "U", "B", "R", "G"];

/**
 * A way for the player to pay the cost, or null if there's none. Mana already in the pool is used first. Then mana
 * abilities: lands before creatures (keeping creatures free to attack), each group in battlefield order. Colored symbols
 * are paid before generic. A source with a choice of color is used only after the fixed-color ones, and a two-color one
 * ("{G} or {W}") before one of any color (Birds of Paradise). That always finds a payment when one exists for a cost of
 * one color, which every Magic 2010 cost is; a cost of two colors with two-color sources, or a source of several mana
 * or with a mana cost, will need a search (future-rules).
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
    // Lands before creatures, keeping creatures free to attack; then the source with the fewest choices: one fixed
    // color, then two ("{G} or {W}"), then any color, so a source keeps its choice for a color nothing else makes.
    const candidates = sources
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => !used.includes(i) && s.makes.some((t) => allowed.includes(t)))
      .sort((a, b) => Number(!a.s.land) - Number(!b.s.land) || a.s.makes.length - b.s.makes.length);
    const best = candidates[0];
    if (best === undefined) return false;
    used.push(best.i);
    const mana = allowed.find((t) => best.s.makes.includes(t));
    if (mana === undefined) return false;
    const { object, ability } = best.s;
    // A choice of color comes with the activation (D-068); colorless is never a choice.
    activations.push(best.s.chooses && mana !== "C" ? { object, ability, color: mana } : { object, ability });
    payment[mana] += 1;
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

/**
 * A permanent's mana ability that makes one mana: the kinds it can make, whether its activation chooses one, and
 * whether the permanent is a land.
 */
type Source = { object: ObjectId; ability: AbilityRef; makes: readonly ManaType[]; chooses: boolean; land: boolean };

/**
 * The most mana the player could have right now: what's in their pool, and what each permanent whose mana ability they
 * could activate makes, counted now ("{G} for each Elf you control", Elvish Archdruid). Only a guide (`legalActions`
 * lists values of X up to it), not a rule. Auto pay uses only the sources that make one mana (`manaSources`). A
 * permanent counts once, by the mana ability that makes the most: activating one taps it.
 */
export function manaAvailable(state: GameState, player: PlayerId, cards: CardDatabase): number {
  const pool = state.players[player]?.manaPool;
  const inPool = pool === undefined ? 0 : MANA_TYPES.reduce((sum, t) => sum + pool[t], 0);
  let fromPermanents = 0;
  for (const object of usablePermanents(state, player, cards)) {
    const amounts = usableManaAbilities(state, player, object, cards).map(({ effect }) =>
      typeof effect.amount === "number"
        ? effect.amount
        : permanentsFittingFor(state, effect.amount.count, player, cards).length,
    );
    fromPermanents += Math.max(0, ...amounts);
  }
  return inPool + fromPermanents;
}

/** The player's permanents whose mana abilities could be activated now: not ones the cost being paid taps (CR 107.5). */
function usablePermanents(state: GameState, player: PlayerId, cards: CardDatabase): ObjectId[] {
  const tappedByCost = tapsForCost(state, cards);
  return state.zones.battlefield.filter(
    (object) => controllerOf(state, object, cards) === player && !tappedByCost.includes(object),
  );
}

type AddMana = Extract<Effect, { op: "addMana" }>;

/** A permanent's mana abilities the player could activate now, each with its "add mana" effect. */
function usableManaAbilities(
  state: GameState,
  player: PlayerId,
  object: ObjectId,
  cards: CardDatabase,
): { ref: AbilityRef; effect: AddMana }[] {
  return abilitiesOf(state, object, cards).flatMap(({ ref, def }) => {
    if (!isManaAbility(def) || manaAbilityProblem(state, player, object, ref, cards) !== null) return [];
    const effect = def.effects.find((e): e is AddMana => e.op === "addMana");
    return effect === undefined ? [] : [{ ref, effect }];
  });
}

/** The player's permanents that can make one mana now, lands first, each group in battlefield order. */
function manaSources(state: GameState, player: PlayerId, cards: CardDatabase): Source[] {
  const sources: Source[] = [];
  for (const object of usablePermanents(state, player, cards)) {
    // One mana ability per permanent: activating it taps the permanent.
    const one = usableManaAbilities(state, player, object, cards).find(({ effect }) => effect.amount === 1);
    if (one === undefined) continue;
    sources.push({
      object,
      ability: one.ref,
      ...manaKinds(one.effect.mana),
      land: cardTypesOf(state, object, cards).includes("land"),
    });
  }
  return [...sources.filter((s) => s.land), ...sources.filter((s) => !s.land)];
}
