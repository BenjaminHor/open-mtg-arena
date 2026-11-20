// Prevention and redirection effects on damage (CR 615, 614.9). A damage event stays one event (CR 120.4, D-067):
// each of its entries (a source dealing damage to a recipient) is replaced on its own inside it, with its own
// candidates and its own chooser, the recipient player or the recipient object's controller (CR 616.1). What's
// prevented is never dealt (CR 615.6), so lifelink and "deals damage" triggers see only what's left; it's still told,
// as a `damagePrevented` event. Redirected damage is the same damage dealt to another recipient (CR 614.9): its part
// of the entry becomes an entry of its own, combat damage if it was, replaced in turn for prevention (CR 616.1f).
//
// Candidates: prevention effects made by resolving spells (`GameState.replacements`: Fog, Safe Passage), those in the
// text of permanents on the battlefield (Guardian Seraph), and redirection effects (Harm's Way), whose share of each
// entry is settled first (`redirection.ts`). Identical ones (two Guardian Seraphs) are one option: no order among them
// can differ (like D-077). Choosing it applies one of them, and the rest are checked again (CR 616.1f), so every order
// the rules allow can still be chosen.

import type { CardDatabase, ReplacementDef } from "../cards/types.ts";
import { replacementsOf } from "../rules/abilities.ts";
import { controllerNowOrLastKnown, controllerOf } from "../rules/controller.ts";
import { canBeDealtDamage } from "../rules/damage-recipients.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import {
  type DamageEntryKey,
  type ReplacementChoice,
  type ReplacementEffect,
  type ReplacementRef,
  sameChoiceFor,
  sameReplacement,
} from "../state/replacements.ts";
import type { Damage, SingleEvent } from "./proposed.ts";
import { type Entry, isYouOrYourCreature, redirectShares } from "./redirection.ts";
import { type Ask, firstInApnapOrder, type Replaced } from "./replacements.ts";

/** The damage event with prevention and redirection applied to each entry, or the first choice needed (CR 616.1). */
export function replaceDamage(
  state: GameState,
  damage: readonly Damage[],
  cards: CardDatabase,
  choices: readonly ReplacementChoice[],
): Replaced {
  // A source that would deal 0 damage deals none (CR 120.8), and damage to a recipient that can't be dealt it (one
  // that left) isn't dealt (CR 101.3): neither is there to prevent, so no effect is used up on it (CR 609.7b).
  const entries = damage.flatMap((entry, index): Entry[] =>
    entry.amount > 0 && canBeDealtDamage(state, entry.to, cards)
      ? [{ entry, key: { kind: "damage", index, source: entry.source, to: entry.to } }]
      : [],
  );
  // How much each redirection effect takes from which entry, settled first so the entries stay independent (D-090).
  const shares = redirectShares(state, entries, cards, choices);
  const split = firstInApnapOrder(state, shares.asks);
  if (split !== null) return split;
  const events: SingleEvent[] = [];
  const dealt: Damage[] = [];
  const asks: Ask[] = [];
  for (const { entry, key } of entries) {
    const redirect = shares.taken.flatMap((s) =>
      sameChoiceFor(s.share.entry, key) ? [{ effect: s.effect, amount: s.share.amount }] : [],
    );
    const result = replaceEntry(state, entry, key, cards, choices, redirect, []);
    if (result.kind === "choose") asks.push(result);
    else {
      events.push(...result.events);
      dealt.push(...result.dealt);
    }
  }
  const ask = firstInApnapOrder(state, asks);
  if (ask !== null) return ask;
  return { kind: "replaced", events: [...events, { kind: "dealDamage", damage: dealt }] };
}

/** A redirection effect's share of one entry. */
type RedirectShareOf = { effect: ObjectId; amount: number };

/** A prevention or redirection effect that would apply to a damage entry. */
type Candidate = {
  ref: ReplacementRef;
  /** Effects with the same identity can't differ in order: the same text, with the same "you" where it matters. */
  identity: string;
  /** The card whose effect it is, to say what prevented or redirected the damage. */
  by: OracleId;
} & ({ kind: "prevent"; prevents: number | "all" } | { kind: "redirect"; effect: ObjectId; share: number; to: Target });

type EntryResult =
  | { kind: "done"; dealt: Damage[]; events: SingleEvent[] }
  | { kind: "choose"; player: PlayerId; for: DamageEntryKey; options: ReplacementRef[] };

/**
 * One entry's replacement: the effects that apply, one at a time, each once in the event (none could apply again to its own result yet; later: CR 614.5), the rest checked
 * again after each (CR 616.1f), until none applies or nothing is left. `applied` are those already applied to the
 * damage this entry came from, when it was redirected.
 */
function replaceEntry(
  state: GameState,
  entry: Damage,
  key: DamageEntryKey,
  cards: CardDatabase,
  allChoices: readonly ReplacementChoice[],
  redirect: readonly RedirectShareOf[],
  alreadyApplied: readonly ReplacementRef[],
): EntryResult {
  const choices = allChoices.flatMap((c) => (c.kind === "first" && sameChoiceFor(c.for, key) ? [c.ref] : []));
  let amount = entry.amount;
  const applied = [...alreadyApplied];
  const events: SingleEvent[] = [];
  const dealt: Damage[] = [];
  while (amount > 0) {
    const candidates = candidatesFor(state, entry, cards, redirect).filter(
      (c) => !applied.some((done) => sameReplacement(done, c.ref)),
    );
    // One option for each identity: its first candidate stands for the others.
    const options = candidates.filter((c, i) => candidates.findIndex((d) => d.identity === c.identity) === i);
    const [only, second] = options;
    if (only === undefined) break;
    // The earliest choice not yet applied that's among the options: choices are applied in the order made.
    const next = choices.find(
      (ch) => !applied.some((a) => sameReplacement(a, ch)) && options.some((c) => sameReplacement(c.ref, ch)),
    );
    const chosen =
      second === undefined ? only : options.find((c) => next !== undefined && sameReplacement(c.ref, next));
    // Any of them may be chosen first (CR 616.1e): none is a self-replacement (later: CR 616.1a).
    if (chosen === undefined)
      return {
        kind: "choose",
        player: recipientChooser(state, entry.to),
        for: key,
        options: options.map((c) => c.ref),
      };
    applied.push(chosen.ref);
    switch (chosen.kind) {
      case "prevent": {
        const stopped = chosen.prevents === "all" ? amount : Math.min(amount, chosen.prevents);
        amount -= stopped;
        events.push({ kind: "damagePrevented", source: entry.source, to: entry.to, amount: stopped, by: chosen.by });
        break;
      }
      case "redirect": {
        const moved = Math.min(amount, chosen.share);
        amount -= moved;
        const { source } = entry;
        events.push({
          kind: "damageRedirected",
          effect: chosen.effect,
          source,
          from: entry.to,
          to: chosen.to,
          amount: moved,
          by: chosen.by,
        });
        // The same damage, to another recipient (CR 614.9): replaced in turn, without what's already applied.
        const redirected: Damage = { ...entry, to: chosen.to, amount: moved };
        const redirectedKey: DamageEntryKey = { ...key, to: chosen.to };
        const result = replaceEntry(state, redirected, redirectedKey, cards, allChoices, [], applied);
        if (result.kind === "choose") return result;
        events.push(...result.events);
        dealt.push(...result.dealt);
        break;
      }
    }
  }
  return { kind: "done", dealt: amount > 0 ? [{ ...entry, amount }, ...dealt] : dealt, events };
}

/** Who chooses for damage to this recipient: the player, or the object's controller (CR 616.1). */
function recipientChooser(state: GameState, to: Target): PlayerId {
  return to.kind === "player" ? to.player : controllerOf(state, to.object);
}

/** The prevention and redirection effects that would apply to this entry now. */
function candidatesFor(
  state: GameState,
  entry: Damage,
  cards: CardDatabase,
  redirect: readonly RedirectShareOf[],
): Candidate[] {
  const fromSpells = state.replacements.flatMap((effect) =>
    resolvedEffectCandidates(state, effect, entry, cards, redirect),
  );
  const fromPermanents = state.zones.battlefield.flatMap((permanent) =>
    replacementsOf(state, permanent, cards).flatMap((def, index): Candidate[] => {
      const prevents = preventsForPermanent(state, def, permanent, entry);
      const obj = state.objects[permanent];
      if (prevents === null || obj?.kind !== "card") return [];
      return [
        {
          kind: "prevent",
          ref: { kind: "ownText", object: permanent, index },
          identity: JSON.stringify({ def, you: controllerOf(state, permanent) }),
          prevents,
          by: obj.oracleId,
        },
      ];
    }),
  );
  return [...fromSpells, ...fromPermanents];
}

/** A prevention or redirection effect made by a resolving spell, if it applies to this entry. */
function resolvedEffectCandidates(
  state: GameState,
  effect: ReplacementEffect,
  entry: Damage,
  cards: CardDatabase,
  redirect: readonly RedirectShareOf[],
): Candidate[] {
  switch (effect.kind) {
    case "preventAllDamage": {
      if (effect.combatOnly && !entry.combat) return [];
      if (
        effect.protects === "controllerAndCreatures" &&
        !isYouOrYourCreature(state, entry.to, effect.controller, cards)
      )
        return [];
      const { combatOnly, protects, controller } = effect;
      // Whose effect it is matters only when it protects its controller's things: two players' Fogs are the same.
      const you = protects === "everyone" ? null : controller;
      return [
        {
          kind: "prevent",
          ref: { kind: "resolvedEffect", id: effect.id },
          identity: JSON.stringify({ kind: "preventAllDamage", combatOnly, protects, you }),
          prevents: "all",
          by: effect.sourceOracleId,
        },
      ];
    }
    case "redirectDamage": {
      const share = redirect.find((r) => r.effect === effect.id)?.amount ?? 0;
      if (share <= 0) return [];
      const { from, to, controller } = effect;
      return [
        {
          kind: "redirect",
          ref: { kind: "resolvedEffect", id: effect.id },
          identity: JSON.stringify({ kind: "redirectDamage", from, to, controller, share }),
          effect: effect.id,
          share,
          to,
          by: effect.sourceOracleId,
        },
      ];
    }
    case "regenerationShield":
      return [];
  }
}

/** How much of this damage entry a permanent's own text prevents, or null if it doesn't apply. */
function preventsForPermanent(
  state: GameState,
  def: ReplacementDef,
  permanent: ObjectId,
  entry: Damage,
): number | null {
  switch (def.kind) {
    case "preventDamageToYou": {
      // "If a source an opponent controls would deal damage to you": to its controller, from an opponent's source.
      const you = controllerOf(state, permanent);
      if (entry.to.kind !== "player" || entry.to.player !== you) return null;
      // A source that left is as it last existed (CR 113.7a, 608.2h); one without a controller counts by its owner
      // (its ruling), which `controllerOf` gives for a card outside the battlefield and the stack.
      const sourceController = controllerNowOrLastKnown(state, entry.source);
      // An opponent (CR 102.2); teams would change this (later: CR 102.3).
      return sourceController !== null && sourceController !== you ? def.amount : null;
    }
    case "entersTapped":
    case "graveyardToLibrary":
      return null;
  }
}
