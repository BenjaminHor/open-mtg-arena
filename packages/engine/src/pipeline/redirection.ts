// Redirection effects with an amount (Harm's Way: "the next 2 damage that a source of your choice would deal to you
// and/or permanents you control this turn is dealt to any target instead"; CR 614.9). What each one redirects from a
// damage event is settled before the event's entries are replaced, one decision per effect: when the source would deal
// more to its controller and their creatures than the effect has left, its controller chooses how much of each entry,
// 1 to each of two recipients if they like (its ruling, like a shield's choice, CR 615.7). Each entry then sees a fixed
// share, so the entries stay independent (D-090).

import type { CardDatabase } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import { queueWork } from "../game/work.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { controllerOf } from "../rules/controller.ts";
import { canBeDealtDamage } from "../rules/damage-recipients.ts";
import type { DecisionKind, PendingDecision } from "../state/decisions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import type { DamageEntryKey, RedirectShare, ReplacementChoice, ReplacementEffect } from "../state/replacements.ts";
import type { Damage } from "./proposed.ts";
import type { Ask } from "./replacements.ts";

type RedirectEffect = Extract<ReplacementEffect, { kind: "redirectDamage" }>;

/** A damage entry still to be replaced, with its key. */
export type Entry = { entry: Damage; key: DamageEntryKey };

/** What each redirection effect redirects from which entry, and the splits still to be chosen (asked first). */
export type Shares = { taken: { effect: ObjectId; share: RedirectShare }[]; asks: Ask[] };

export function redirectShares(
  state: GameState,
  entries: readonly Entry[],
  cards: CardDatabase,
  choices: readonly ReplacementChoice[],
): Shares {
  const shares: { effect: ObjectId; share: RedirectShare }[] = [];
  const asks: Ask[] = [];
  for (const effect of state.replacements) {
    if (effect.kind !== "redirectDamage" || effect.remaining <= 0) continue;
    // A target that can't be dealt damage now: the effect does nothing (CR 614.9), and isn't used up (CR 609.7b).
    if (!canBeDealtDamage(state, effect.to, cards)) continue;
    const eligible = entries.filter(({ entry }) => redirects(state, effect, entry, cards));
    const total = eligible.reduce((sum, { entry }) => sum + entry.amount, 0);
    if (eligible.length === 0) continue;
    const add = (key: DamageEntryKey, amount: number) =>
      shares.push({ effect: effect.id, share: { entry: key, amount } });
    const [only] = eligible;
    if (total <= effect.remaining) for (const { entry, key } of eligible) add(key, entry.amount);
    else if (eligible.length === 1 && only !== undefined) add(only.key, effect.remaining);
    else {
      const chosen = choices.find((c) => c.kind === "redirectSplit" && c.effect === effect.id);
      if (chosen?.kind === "redirectSplit") for (const s of chosen.shares) add(s.entry, s.amount);
      else
        asks.push({
          kind: "divideRedirect",
          player: effect.controller,
          effect: effect.id,
          amount: effect.remaining,
          entries: eligible.map((e) => e.key),
          maxima: eligible.map((e) => e.entry.amount),
        });
    }
  }
  return { taken: shares, asks };
}

/**
 * Whether this effect would redirect damage from this entry: from its chosen source, to its controller or a creature
 * they control. Damage already headed for its target isn't redirected: nothing would change.
 */
function redirects(state: GameState, effect: RedirectEffect, entry: Damage, cards: CardDatabase): boolean {
  if (entry.source !== effect.from) return false;
  if (sameRecipient(entry.to, effect.to)) return false;
  return isYouOrYourCreature(state, entry.to, effect.controller, cards);
}

function sameRecipient(a: Target, b: Target): boolean {
  return a.kind === "player"
    ? b.kind === "player" && a.player === b.player
    : b.kind === "object" && a.object === b.object;
}

/** Whether the recipient is this player, or a creature on the battlefield they control. */
export function isYouOrYourCreature(state: GameState, to: Target, you: PlayerId, cards: CardDatabase): boolean {
  if (to.kind === "player") return to.player === you;
  return (
    state.zones.battlefield.includes(to.object) &&
    cardTypesOf(state, to.object, cards).includes("creature") &&
    controllerOf(state, to.object) === you
  );
}

type DivideRedirect = Extract<DecisionKind, { kind: "divideRedirect" }>;

/**
 * The shares the next entry may get: at most its damage and what's left, and at least enough that the entries after
 * it can take the rest, so the whole amount is redirected (the shield redirects all it can, like CR 615.7).
 */
export function redirectShareRange(decision: DivideRedirect): { min: number; max: number } {
  const i = decision.shares.length;
  const rest = decision.amount - decision.shares.reduce((sum, n) => sum + n, 0);
  const later = decision.maxima.slice(i + 1).reduce((sum, n) => sum + n, 0);
  return { min: Math.max(0, rest - later), max: Math.min(decision.maxima[i] ?? 0, rest) };
}

/** Records one entry's share; after the second-to-last, the last gets the rest and the event is replaced again. */
export function answerDivideRedirect(answered: GameState, pending: PendingDecision, amount: number): GameState {
  if (pending.kind !== "divideRedirect") throw new Error("not a divideRedirect decision");
  const { id: _id, player, ...decision } = pending;
  const shares = [...decision.shares, amount];
  if (shares.length < decision.entries.length - 1) return waitFor(answered, player, { ...decision, shares });
  const rest = decision.amount - shares.reduce((sum, n) => sum + n, 0);
  const all = [...shares, rest];
  const split: ReplacementChoice = {
    kind: "redirectSplit",
    effect: decision.effect,
    shares: decision.entries.map((entry, i) => ({ entry, amount: all[i] ?? 0 })),
  };
  const { proposed, choices } = decision.resume;
  return queueWork(answered, { kind: "resumeEvent", proposed, choices: [...choices, split] });
}
