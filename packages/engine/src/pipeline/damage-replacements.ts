// Prevention and redirection effects on damage (CR 615, 614.9). A damage event stays one event (CR 120.4, D-067):
// each of its entries (a source dealing damage to a recipient) is replaced on its own inside it, with its own
// candidates and its own chooser, the recipient player or the recipient object's controller (CR 616.1). What's
// prevented is never dealt (CR 615.6), so lifelink and "deals damage" triggers see only what's left; it's still told,
// as a `damagePrevented` event. Redirected damage is the same damage dealt to another recipient (CR 614.9): its part
// of the entry becomes an entry of its own, combat damage if it was, replaced in turn for prevention (CR 616.1f).
//
// Candidates (`damage-candidates.ts`): prevention effects made by resolving spells (`GameState.replacements`: Fog, Safe Passage), those in the
// text of permanents on the battlefield (Guardian Seraph), and redirection effects (Harm's Way), whose share of each
// entry is settled first (`redirection.ts`). Identical ones (two Guardian Seraphs) are one option: no order among them
// can differ (like D-077). Choosing it applies one of them, and the rest are checked again (CR 616.1f), so every order
// the rules allow can still be chosen.

import type { CardDatabase } from "../cards/types.ts";
import { controllerOf } from "../rules/controller.ts";
import { canBeDealtDamage } from "../rules/damage-recipients.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { sameTarget, type Target } from "../state/objects.ts";
import {
  type DamageEntryKey,
  type ReplacementChoice,
  type ReplacementRef,
  sameChoiceFor,
  sameReplacement,
} from "../state/replacements.ts";
import { candidatesFor, refKey, type Spent } from "./damage-candidates.ts";
import type { Damage, SingleEvent } from "./proposed.ts";
import { type Entry, redirectShares, type Share } from "./redirection.ts";
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
      ? [{ entry, key: { kind: "damage", index, hop: 0, source: entry.source, to: entry.to } }]
      : [],
  );
  // How much each redirection effect takes from which entry, settled first so the entries stay independent (D-090).
  const shares = redirectShares(state, entries, cards, choices);
  const split = firstInApnapOrder(state, shares.asks);
  if (split !== null) return split;
  const events: SingleEvent[] = [];
  const dealt: Damage[] = [];
  const asks: Ask[] = [];
  // What amount-limited effects used on earlier entries: threaded through, in the event's order. An entry that asks
  // leaves it as it was; a choice that an earlier entry's answer makes impossible is skipped when the event is replaced
  // again from the start, and the entry asks again.
  let spent: Spent = { limited: [], redirected: [] };
  for (const { entry, key } of entries) {
    const result = replaceEntry(state, entry, key, cards, choices, { shares: shares.taken, alreadyApplied: [] }, spent);
    if (result.kind === "choose") asks.push(result);
    else {
      events.push(...result.events);
      dealt.push(...result.dealt);
      spent = result.spent;
    }
  }
  const ask = firstInApnapOrder(state, asks);
  if (ask !== null) return ask;
  return { kind: "replaced", events: [...events, { kind: "dealDamage", damage: merged(dealt) }] };
}

/**
 * One source's damage to one recipient in one event is dealt as one (a redirected part joining damage the source was
 * already dealing there): prevention counts it as one (CR 615.10), and "deals damage" triggers see it once (CR 603.2c).
 */
function merged(dealt: readonly Damage[]): Damage[] {
  const out: Damage[] = [];
  for (const d of dealt) {
    const i = out.findIndex((o) => o.source === d.source && o.combat === d.combat && sameTarget(o.to, d.to));
    const same = out[i];
    if (same === undefined) out.push(d);
    else out[i] = { ...same, amount: same.amount + d.amount };
  }
  return out;
}

type EntryResult =
  | { kind: "done"; dealt: Damage[]; events: SingleEvent[]; spent: Spent }
  | { kind: "choose"; player: PlayerId; for: DamageEntryKey; options: ReplacementRef[] };

/** The redirection shares settled for the event, and the effects already applied to the damage an entry came from. */
type EntryContext = { shares: readonly Share[]; alreadyApplied: readonly ReplacementRef[] };

/**
 * One entry's replacement: the effects that apply, one at a time, each once in the event (CR 614.5), the rest checked
 * again after each (CR 616.1f), until none applies or nothing is left. A redirected part is replaced in turn, without
 * the effects already applied to the damage it came from.
 */
function replaceEntry(
  state: GameState,
  entry: Damage,
  key: DamageEntryKey,
  cards: CardDatabase,
  allChoices: readonly ReplacementChoice[],
  context: EntryContext,
  spentBefore: Spent,
): EntryResult {
  const choices = allChoices.flatMap((c) => (c.kind === "first" && sameChoiceFor(c.for, key) ? [c.ref] : []));
  let amount = entry.amount;
  let spent = spentBefore;
  const applied = [...context.alreadyApplied];
  const events: SingleEvent[] = [];
  const dealt: Damage[] = [];
  while (amount > 0) {
    const candidates = candidatesFor(state, entry, key, cards, context.shares, spent).filter(
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
        if (chosen.limited) {
          const used = { effect: refKey(chosen.ref), source: entry.source, to: entry.to, amount: stopped };
          spent = { ...spent, limited: [...spent.limited, used] };
        }
        events.push({ kind: "damagePrevented", source: entry.source, to: entry.to, amount: stopped, by: chosen.by });
        break;
      }
      case "redirect": {
        const moved = Math.min(amount, chosen.share);
        amount -= moved;
        // A part already redirected uses what the effect has left beyond its shares of the event's own entries.
        if (key.hop > 0)
          spent = { ...spent, redirected: [...spent.redirected, { effect: chosen.effect, amount: moved }] };
        const { source, to: from } = entry;
        events.push({
          kind: "damageRedirected",
          effect: chosen.effect,
          source,
          from,
          to: chosen.to,
          amount: moved,
          by: chosen.by,
        });
        // The same damage, dealt to another recipient (CR 614.9): combat damage if it was, replaced in turn.
        const part: Damage = { ...entry, to: chosen.to, amount: moved };
        const partKey: DamageEntryKey = { ...key, hop: key.hop + 1, to: chosen.to };
        const result = replaceEntry(
          state,
          part,
          partKey,
          cards,
          allChoices,
          { ...context, alreadyApplied: applied },
          spent,
        );
        if (result.kind === "choose") return result;
        events.push(...result.events);
        dealt.push(...result.dealt);
        spent = result.spent;
        break;
      }
    }
  }
  return { kind: "done", dealt: amount > 0 ? [{ ...entry, amount }, ...dealt] : dealt, events, spent };
}

/** Who chooses for damage to this recipient: the player, or the object's controller (CR 616.1). */
function recipientChooser(state: GameState, to: Target): PlayerId {
  return to.kind === "player" ? to.player : controllerOf(state, to.object);
}
