// Prevention effects on damage (CR 615). A damage event stays one event (CR 120.4, D-067): each of its entries (a
// source dealing damage to a recipient) is replaced on its own inside it, with its own candidates and its own chooser,
// the recipient player or the recipient object's controller (CR 616.1). What's prevented is never dealt (CR 615.6),
// so lifelink and "deals damage" triggers see only what's left; it's still told, as a `damagePrevented` event.
//
// Candidates: prevention effects made by resolving spells (`GameState.replacements`: Fog, Safe Passage), those in the
// text of permanents on the battlefield (Guardian Seraph), and the recipient's protection (CR 702.16e). Identical ones (two Guardian Seraphs) are one option:
// no order among them can differ (like D-077). Choosing it applies one of them, and the rest are checked again
// (CR 616.1f), so every order the rules allow can still be chosen.

import type { CardDatabase, ReplacementDef } from "../cards/types.ts";
import { replacementsOf } from "../rules/abilities.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { controllerNowOrLastKnown, controllerOf } from "../rules/controller.ts";
import { canBeDealtDamage } from "../rules/damage-recipients.ts";
import { isProtectedFrom } from "../rules/protection.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import {
  type ChoiceFor,
  type ReplacementChoice,
  type ReplacementRef,
  sameChoiceFor,
  sameReplacement,
} from "../state/replacements.ts";
import type { Damage, SingleEvent } from "./proposed.ts";
import { type Ask, firstInApnapOrder, type Replaced } from "./replacements.ts";

/** The damage event with prevention applied to each entry, or the first choice needed, in APNAP order (CR 616.1). */
export function replaceDamage(
  state: GameState,
  damage: readonly Damage[],
  cards: CardDatabase,
  choices: readonly ReplacementChoice[],
): Replaced {
  const prevented: SingleEvent[] = [];
  const afterwards: SingleEvent[] = [];
  const dealt: Damage[] = [];
  const asks: Ask[] = [];
  damage.forEach((entry, index) => {
    // A source that would deal 0 damage deals none (CR 120.8), and damage to a recipient that can't be dealt it (one
    // that left) isn't dealt (CR 101.3): neither is there to prevent, so no effect is used up on it (later: CR 609.7b).
    if (entry.amount <= 0 || !canBeDealtDamage(state, entry.to, cards)) return;
    const key: ChoiceFor = { kind: "damage", index, source: entry.source, to: entry.to };
    const refs = choices.filter((c) => sameChoiceFor(c.for, key)).map((c) => c.ref);
    const result = preventEntry(state, entry, cards, refs);
    if (result.kind === "choose") {
      asks.push({ kind: "choose", player: result.player, for: key, options: result.options });
      return;
    }
    prevented.push(...result.prevented);
    afterwards.push(...result.afterwards);
    if (result.amount > 0) dealt.push({ ...entry, amount: result.amount });
  });
  const ask = firstInApnapOrder(state, asks);
  if (ask !== null) return ask;
  // What a prevention also does comes right after the damage event (CR 615.5).
  return { kind: "replaced", events: [...prevented, { kind: "dealDamage", damage: dealt }, ...afterwards] };
}

/** A prevention effect that would apply to a damage entry. */
type Candidate = {
  ref: ReplacementRef;
  /** Effects with the same identity can't differ in order: the same text, with the same "you" where it matters. */
  identity: string;
  /** How much it prevents: all of it, or up to a number. */
  prevents: number | "all";
  /** The card whose effect it is, to say what prevented the damage. */
  by: OracleId;
  /** What it does right after the prevention, with the amount it prevented (CR 615.5): Protean Hydra's counters. */
  afterwards?: { kind: "removeCounters"; object: ObjectId; counter: string };
};

type EntryResult =
  | { kind: "prevented"; amount: number; prevented: SingleEvent[]; afterwards: SingleEvent[] }
  | { kind: "choose"; player: PlayerId; options: ReplacementRef[] };

/**
 * One entry's prevention: the effects that apply, one at a time, each once, the rest checked again after each
 * (CR 616.1f), until none applies or nothing is left to prevent.
 */
function preventEntry(
  state: GameState,
  entry: Damage,
  cards: CardDatabase,
  choices: readonly ReplacementRef[],
): EntryResult {
  let amount = entry.amount;
  const applied: ReplacementRef[] = [];
  const prevented: SingleEvent[] = [];
  const afterwards: SingleEvent[] = [];
  while (amount > 0) {
    const candidates = candidatesFor(state, entry, cards).filter(
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
      return { kind: "choose", player: recipientChooser(state, entry.to), options: options.map((c) => c.ref) };
    applied.push(chosen.ref);
    const stopped = chosen.prevents === "all" ? amount : Math.min(amount, chosen.prevents);
    amount -= stopped;
    prevented.push({ kind: "damagePrevented", source: entry.source, to: entry.to, amount: stopped, by: chosen.by });
    // "That many": the damage it applied to (all that was left), which is what it stopped until damage can't be
    // prevented (later: CR 615.12).
    if (chosen.afterwards !== undefined) afterwards.push({ ...chosen.afterwards, amount: stopped });
  }
  return { kind: "prevented", amount, prevented, afterwards };
}

/** Who chooses for damage to this recipient: the player, or the object's controller (CR 616.1). */
function recipientChooser(state: GameState, to: Target): PlayerId {
  return to.kind === "player" ? to.player : controllerOf(state, to.object);
}

/** The prevention effects that would apply to this entry now. */
function candidatesFor(state: GameState, entry: Damage, cards: CardDatabase): Candidate[] {
  const fromSpells = state.replacements.flatMap((effect): Candidate[] => {
    if (effect.kind !== "preventAllDamage") return [];
    if (effect.combatOnly && !entry.combat) return [];
    if (effect.protects === "controllerAndCreatures" && !isYouOrYourCreature(state, entry.to, effect.controller, cards))
      return [];
    const { combatOnly, protects, controller } = effect;
    // Whose effect it is matters only when it protects its controller's things: two players' Fogs are the same.
    const you = protects === "everyone" ? null : controller;
    return [
      {
        ref: { kind: "resolvedEffect", id: effect.id },
        identity: JSON.stringify({ kind: "preventAllDamage", combatOnly, protects, you }),
        prevents: "all",
        by: effect.sourceOracleId,
      },
    ];
  });
  const fromPermanents = state.zones.battlefield.flatMap((permanent) =>
    replacementsOf(state, permanent, cards).flatMap((def, index): Candidate[] => {
      const prevents = preventsForPermanent(state, def, permanent, entry);
      const obj = state.objects[permanent];
      if (prevents === null || obj?.kind !== "card") return [];
      const afterwards =
        def.kind === "preventDamageToSelfRemovingCounters"
          ? { afterwards: { kind: "removeCounters", object: permanent, counter: def.counter } as const }
          : {};
      return [
        {
          ref: { kind: "ownText", object: permanent, index },
          identity: JSON.stringify({ def, you: controllerOf(state, permanent) }),
          prevents,
          by: obj.oracleId,
          ...afterwards,
        },
      ];
    }),
  );
  return [...fromSpells, ...fromPermanents, ...protectionCandidates(state, entry, cards)];
}

/**
 * Damage from a source with the quality to a permanent with protection from it is prevented (CR 702.16e): one candidate
 * however many of its protections match, as they'd prevent the same.
 */
function protectionCandidates(state: GameState, entry: Damage, cards: CardDatabase): Candidate[] {
  if (entry.to.kind !== "object" || !isProtectedFrom(state, entry.to.object, entry.source, cards)) return [];
  const obj = state.objects[entry.to.object];
  // Always a card here: only permanents have protection; this gets its oracle id to name it.
  if (obj?.kind !== "card") return [];
  const object = entry.to.object;
  return [
    {
      ref: { kind: "protection", object },
      identity: JSON.stringify({ kind: "protection", object }),
      prevents: "all",
      by: obj.oracleId,
    },
  ];
}

/** How much of this damage entry a permanent's own text prevents, or null if it doesn't apply. */
function preventsForPermanent(
  state: GameState,
  def: ReplacementDef,
  permanent: ObjectId,
  entry: Damage,
): number | "all" | null {
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
    case "preventDamageToSelfRemovingCounters":
      // "If damage would be dealt to this creature": all of it (its ruling).
      return entry.to.kind === "object" && entry.to.object === permanent ? "all" : null;
    case "entersTapped":
    case "graveyardToLibrary":
    case "entersWithCounters":
      return null;
  }
}

/** Whether the recipient is this player, or a creature on the battlefield they control. */
function isYouOrYourCreature(state: GameState, to: Target, you: PlayerId, cards: CardDatabase): boolean {
  if (to.kind === "player") return to.player === you;
  return (
    state.zones.battlefield.includes(to.object) &&
    cardTypesOf(state, to.object, cards).includes("creature") &&
    controllerOf(state, to.object) === you
  );
}
