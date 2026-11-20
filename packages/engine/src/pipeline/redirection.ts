// Redirection effects with an amount (Harm's Way: "the next 2 damage that a source of your choice would deal to you
// and/or permanents you control this turn is dealt to any target instead"; CR 614.9). What each one takes from the
// damage event's own entries is settled before they're replaced, one effect after another: when the source would deal
// more to its controller and their permanents than the effect has left, its controller chooses how much of each entry,
// 1 to each of two recipients if they like (its ruling). Each entry then sees a fixed share, so the entries stay
// independent (D-090). What an effect has left after those shares can still take damage that replacement redirects to
// its controller (another player's Harm's Way sending it back, CR 616.1f): `leftForRedirectedDamage`.

import type { CardDatabase } from "../cards/types.ts";
import { canBeDealtDamage, isYouOrYourPermanent } from "../rules/damage-recipients.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { sameTarget } from "../state/objects.ts";
import {
  type DamageEntryKey,
  type ReplacementChoice,
  type ReplacementEffect,
  sameChoiceFor,
} from "../state/replacements.ts";
import type { Damage } from "./proposed.ts";
import type { Ask } from "./replacements.ts";

export type RedirectEffect = Extract<ReplacementEffect, { kind: "redirectDamage" }>;

/** A damage entry still to be replaced, with its key. */
export type Entry = { entry: Damage; key: DamageEntryKey };

/** How much of one entry one redirection effect takes. */
export type Share = { effect: ObjectId; entry: DamageEntryKey; amount: number };

/** The shares settled so far, and the splits still to be chosen (asked before anything is replaced). */
export type Shares = { taken: Share[]; asks: Ask[] };

export function redirectShares(
  state: GameState,
  entries: readonly Entry[],
  cards: CardDatabase,
  choices: readonly ReplacementChoice[],
): Shares {
  const taken: Share[] = [];
  const asks: Ask[] = [];
  // What earlier effects already took from an entry isn't there for a later one (CR 616.1f).
  const left = (e: Entry) =>
    e.entry.amount - taken.reduce((sum, s) => (sameChoiceFor(s.entry, e.key) ? sum + s.amount : sum), 0);
  for (const effect of state.replacements) {
    if (effect.kind !== "redirectDamage" || !isUsable(state, effect, cards)) continue;
    const eligible = entries.filter((e) => redirects(state, effect, e.entry) && left(e) > 0);
    if (eligible.length === 0) continue;
    const amounts = eligible.map(left);
    const total = amounts.reduce((sum, n) => sum + n, 0);
    const take = (shares: readonly number[]) => {
      eligible.forEach((e, i) => {
        taken.push({ effect: effect.id, entry: e.key, amount: shares[i] ?? 0 });
      });
    };
    // All of it fits, or one entry takes what's left: nothing to choose.
    if (total <= effect.remaining) take(amounts);
    else if (eligible.length === 1) take([effect.remaining]);
    else {
      const keys = eligible.map((e) => e.key);
      const split = choices.find(
        (c) =>
          c.kind === "redirectSplit" &&
          c.effect === effect.id &&
          c.shares.length === keys.length &&
          c.shares.every((s, i) => keys[i] !== undefined && sameChoiceFor(s.entry, keys[i])),
      );
      if (split?.kind === "redirectSplit") take(split.shares.map((s) => s.amount));
      else
        asks.push({
          kind: "divideRedirect",
          player: effect.controller,
          effect: effect.id,
          amount: effect.remaining,
          entries: keys,
          maxima: amounts,
        });
    }
  }
  return { taken, asks };
}

/** What an effect has left for damage redirected to its controller during this event, after its shares. */
export function leftForRedirectedDamage(
  effect: RedirectEffect,
  shares: readonly Share[],
  usedOnRedirected: number,
): number {
  const reserved = shares.reduce((sum, s) => (s.effect === effect.id ? sum + s.amount : sum), 0);
  return effect.remaining - reserved - usedOnRedirected;
}

/**
 * Whether the effect can redirect anything now: some left, and a target that can be dealt damage. Otherwise it does
 * nothing (CR 614.9) and isn't used up (its ruling; CR 609.7b).
 */
export function isUsable(state: GameState, effect: RedirectEffect, cards: CardDatabase): boolean {
  return effect.remaining > 0 && canBeDealtDamage(state, effect.to, cards);
}

/**
 * Whether this effect would redirect this damage: from its chosen source, to its controller or a permanent they
 * control. Damage to the target itself isn't redirected: redirection deals damage to *another* recipient (CR 614.9).
 */
export function redirects(state: GameState, effect: RedirectEffect, entry: Damage): boolean {
  if (entry.source !== effect.from) return false;
  if (sameTarget(entry.to, effect.to)) return false;
  return isYouOrYourPermanent(state, entry.to, effect.controller);
}
