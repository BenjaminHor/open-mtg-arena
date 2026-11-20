// Prevention effects on damage (CR 615). A damage event stays one event (CR 120.4, D-067): each of its entries (a
// source dealing damage to a recipient) is replaced on its own inside it, with its own candidates and its own chooser,
// the recipient player or the recipient object's controller (CR 616.1). What's prevented is never dealt (CR 615.6),
// so lifelink and "deals damage" triggers see only what's left; it's still told, as a `damagePrevented` event.
//
// Candidates: prevention effects made by resolving spells (`GameState.replacements`: Fog, Safe Passage), and those in
// the text of permanents on the battlefield (Guardian Seraph). Identical ones (two Guardian Seraphs) are applied
// without asking, as no order between them can differ (like D-077); all of them still apply, each once.

import type { CardDatabase, ReplacementDef } from "../cards/types.ts";
import { replacementsOf } from "../rules/abilities.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { controllerNowOrLastKnown, controllerOf } from "../rules/controller.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import { type ReplacementChoice, type ReplacementRef, sameReplacement } from "../state/replacements.ts";
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
  const dealt: Damage[] = [];
  const asks: Ask[] = [];
  for (const entry of damage) {
    // A source that would deal 0 damage deals none, so there's nothing to prevent (CR 120.8).
    if (entry.amount <= 0) continue;
    const key = damageKey(entry);
    const refs = choices.filter((c) => c.for === key).map((c) => c.ref);
    const result = preventEntry(state, entry, cards, refs);
    if (result.kind === "choose")
      asks.push({ kind: "choose", player: result.player, for: key, options: result.options });
    else {
      prevented.push(...result.prevented);
      if (result.amount > 0) dealt.push({ ...entry, amount: result.amount });
    }
  }
  const ask = firstInApnapOrder(state, asks);
  if (ask !== null) return ask;
  return { kind: "replaced", events: [...prevented, { kind: "dealDamage", damage: dealt }] };
}

/** What a choice for this damage entry is for: its source and recipient. */
function damageKey(entry: Damage): string {
  return `damage:${entry.source}>${entry.to.kind === "player" ? entry.to.player : entry.to.object}`;
}

/** A prevention effect that would apply to a damage entry. */
type Candidate = {
  ref: ReplacementRef;
  /** Effects with the same identity can't differ in order: the same text, under the same controller. */
  identity: string;
  /** How much it prevents: all of it, or up to a number. */
  prevents: number | "all";
  /** The card whose effect it is, to say what prevented the damage. */
  by: OracleId;
};

type EntryResult =
  | { kind: "prevented"; amount: number; prevented: SingleEvent[] }
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
  while (amount > 0) {
    const candidates = candidatesFor(state, entry, cards).filter(
      (c) => !applied.some((done) => sameReplacement(done, c.ref)),
    );
    const [first] = candidates;
    if (first === undefined) break;
    const allIdentical = candidates.every((c) => c.identity === first.identity);
    // The earliest choice not yet applied that's among the candidates: choices are applied in the order made.
    const next = choices.find(
      (ch) => !applied.some((a) => sameReplacement(a, ch)) && candidates.some((c) => sameReplacement(c.ref, ch)),
    );
    const chosen = allIdentical ? first : candidates.find((c) => next !== undefined && sameReplacement(c.ref, next));
    if (chosen === undefined)
      return { kind: "choose", player: recipientChooser(state, entry.to), options: candidates.map((c) => c.ref) };
    applied.push(chosen.ref);
    const stopped = chosen.prevents === "all" ? amount : Math.min(amount, chosen.prevents);
    amount -= stopped;
    prevented.push({ kind: "damagePrevented", source: entry.source, to: entry.to, amount: stopped, by: chosen.by });
  }
  return { kind: "prevented", amount, prevented };
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
    return [
      {
        ref: { kind: "prevention", id: effect.id },
        identity: JSON.stringify({ kind: "preventAllDamage", combatOnly, protects, controller }),
        prevents: "all",
        by: effect.sourceOracleId,
      },
    ];
  });
  const fromPermanents = state.zones.battlefield.flatMap((permanent) =>
    replacementsOf(state, permanent, cards).flatMap((def, index): Candidate[] => {
      if (!preventsForPermanent(state, def, permanent, entry)) return [];
      const obj = state.objects[permanent];
      if (obj?.kind !== "card" || def.kind !== "preventDamageToYou") return [];
      return [
        {
          ref: { kind: "ownText", object: permanent, index },
          identity: JSON.stringify({ def, controller: controllerOf(state, permanent) }),
          prevents: def.amount,
          by: obj.oracleId,
        },
      ];
    }),
  );
  return [...fromSpells, ...fromPermanents];
}

/** Whether a permanent's own prevention text applies to this damage entry. */
function preventsForPermanent(state: GameState, def: ReplacementDef, permanent: ObjectId, entry: Damage): boolean {
  switch (def.kind) {
    case "preventDamageToYou": {
      // "If a source an opponent controls would deal damage to you": to its controller, from an opponent's source.
      const you = controllerOf(state, permanent);
      if (entry.to.kind !== "player" || entry.to.player !== you) return false;
      // A gone source's controller is as it last was (CR 608.2h); one without a controller counts by its owner (its
      // ruling), which `controllerOf` gives for a card outside the battlefield and the stack.
      const sourceController = controllerNowOrLastKnown(state, entry.source);
      // An opponent (CR 102.2); teams would change this (later: CR 102.3).
      return sourceController !== null && sourceController !== you;
    }
    case "entersTapped":
    case "graveyardToLibrary":
      return false;
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
