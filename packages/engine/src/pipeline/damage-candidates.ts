// The prevention and redirection effects that would apply to one damage entry now (`damage-replacements.ts`, D-088,
// D-090): those made by resolving spells (`GameState.replacements`: Fog, Safe Passage, Harm's Way) and those in the
// text of permanents on the battlefield (Guardian Seraph), with what amount-limited ones already used in this event.

import type { CardDatabase, ReplacementDef } from "../cards/types.ts";
import { replacementsOf } from "../rules/abilities.ts";
import { controllerNowOrLastKnown, controllerOf } from "../rules/controller.ts";
import { isYouOrYourCreature } from "../rules/damage-recipients.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId } from "../state/ids.ts";
import { sameTarget, type Target } from "../state/objects.ts";
import {
  type DamageEntryKey,
  type ReplacementEffect,
  type ReplacementRef,
  sameChoiceFor,
} from "../state/replacements.ts";
import type { Damage } from "./proposed.ts";
import { isUsable, leftForRedirectedDamage, redirects, type Share } from "./redirection.ts";

/**
 * What amount-limited effects have used so far in this event: a permanent's "prevent N" per source and recipient
 * (Guardian Seraph, CR 615.10), and what redirection effects took from damage redirected to their controllers.
 */
export type Spent = {
  limited: { effect: string; source: ObjectId; to: Target; amount: number }[];
  redirected: { effect: ObjectId; amount: number }[];
};

/** A prevention or redirection effect that would apply to a damage entry. */
export type Candidate = {
  ref: ReplacementRef;
  /** Effects with the same identity can't differ in order: the same text, with the same "you" where it matters. */
  identity: string;
  /** The card whose effect it is, to say what prevented or redirected the damage. */
  by: OracleId;
} & (
  | { kind: "prevent"; prevents: number | "all"; limited: boolean }
  | { kind: "redirect"; effect: ObjectId; share: number; to: Target }
);

/** A stable name for an effect, to count what it used. */
export function refKey(ref: ReplacementRef): string {
  return JSON.stringify(ref);
}

/** The prevention and redirection effects that would apply to this entry now. */
export function candidatesFor(
  state: GameState,
  entry: Damage,
  key: DamageEntryKey,
  cards: CardDatabase,
  shares: readonly Share[],
  spent: Spent,
): Candidate[] {
  const fromSpells = state.replacements.flatMap((effect) =>
    resolvedEffectCandidates(state, effect, entry, key, cards, shares, spent),
  );
  const fromPermanents = state.zones.battlefield.flatMap((permanent) =>
    replacementsOf(state, permanent, cards).flatMap((def, index): Candidate[] => {
      const ref: ReplacementRef = { kind: "ownText", object: permanent, index };
      const prevents = preventsForPermanent(state, def, permanent, entry);
      const obj = state.objects[permanent];
      if (prevents === null || obj?.kind !== "card") return [];
      // "Prevent N of that damage" counts per source and recipient in the event, whatever entries it comes in.
      const used = spent.limited.reduce(
        (sum, u) =>
          u.effect === refKey(ref) && u.source === entry.source && sameTarget(u.to, entry.to) ? sum + u.amount : sum,
        0,
      );
      if (prevents - used <= 0) return [];
      return [
        {
          kind: "prevent",
          ref,
          identity: JSON.stringify({ def, you: controllerOf(state, permanent) }),
          prevents: prevents - used,
          limited: true,
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
  key: DamageEntryKey,
  cards: CardDatabase,
  shares: readonly Share[],
  spent: Spent,
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
          limited: false,
          by: effect.sourceOracleId,
        },
      ];
    }
    case "redirectDamage": {
      if (!isUsable(state, effect, cards) || !redirects(state, effect, entry)) return [];
      // The event's own entries take their settled shares; a part redirected here takes what's left beyond them.
      const share =
        key.hop === 0
          ? shares.reduce((sum, s) => (s.effect === effect.id && sameChoiceFor(s.entry, key) ? sum + s.amount : sum), 0)
          : leftForRedirectedDamage(
              effect,
              shares,
              spent.redirected.reduce((sum, u) => (u.effect === effect.id ? sum + u.amount : sum), 0),
            );
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
