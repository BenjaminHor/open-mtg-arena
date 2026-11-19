// Finding what a scenario step names: cards, abilities, targets and payments, in a game's state.

import {
  type AbilityRef,
  abilitiesOf,
  type CardDatabase,
  type GameState,
  legalActions,
  type ManaPool,
  type ObjectId,
  type PlayerId,
  type Target,
} from "@mtg/engine";
import { deepEqual } from "./compare.ts";
import type { ScenarioStep } from "./format.ts";
import { isRecord } from "./format.ts";
import { battlefieldOf, nameOf, parseRef, resolveRef } from "./names.ts";

/** The card with this name in the player's hand (the first one), for an attempt that may be illegal. */
export function cardIn(state: GameState, player: PlayerId, name: string, cards: CardDatabase): ObjectId {
  const copy = handCopy(state, player, name, cards);
  const found = copy ?? (state.zones.players[player]?.hand ?? []).find((id) => nameOf(state, id, cards) === name);
  if (found === undefined) throw new Error(`${player} has no ${name} in hand`);
  return found;
}

/**
 * Whether a card in the player's hand is the one `name` means: any copy with that name, or with `#n` (`Forest#2`), the
 * n-th copy in hand order. Which copy matters for an exact replay: it changes the hand's order, and a mulligan's
 * shuffle with it (CR 103.5).
 */
export function isHandCard(state: GameState, player: string, id: ObjectId, name: string, cards: CardDatabase): boolean {
  const copy = handCopy(state, player as PlayerId, name, cards);
  return copy !== null ? copy === id : nameOf(state, id, cards) === name;
}

/** The copy a `Name#n` names in the player's hand, or null when the name has no `#n`. Throws if there's no such copy. */
function handCopy(state: GameState, player: PlayerId, name: string, cards: CardDatabase): ObjectId | null {
  const nth = /^(.+)#(\d+)$/.exec(name);
  if (nth === null) return null;
  const [, card = "", n = "1"] = nth;
  const hand = state.zones.players[player]?.hand ?? [];
  const copy = hand.filter((id) => nameOf(state, id, cards) === card)[Number(n) - 1];
  if (copy === undefined) throw new Error(`no ${name} in ${player}'s hand`);
  return copy;
}

/** A payment written in a scenario, like `{ R: 1 }`: only mana types, whole amounts. */
export function paymentFrom(value: unknown): ManaPool {
  if (!isRecord(value)) throw new Error('pay is "auto", "cancel", or a payment like { R: 1 }');
  const payment: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const [type, amount] of Object.entries(value)) {
    if (!(type in payment) || typeof amount !== "number" || !Number.isInteger(amount)) {
      throw new Error(`a payment is mana types and whole amounts, like { R: 1 }; got ${type}: ${String(amount)}`);
    }
    payment[type as keyof ManaPool] = amount;
  }
  return payment;
}

/**
 * A card with this name among the player's legal answers. With several identical cards (eight Forests), the first in
 * zone order that's still a legal answer is used, or `Forest#2` names the second Forest in the player's hand: which
 * copy goes to the bottom after a mulligan changes the hand's order, and so the next shuffle (CR 103.5). For an
 * illegal attempt (`expect error`), any card with the name, wherever it is.
 */
export function cardNamed(
  state: GameState,
  player: string,
  name: string,
  cards: CardDatabase,
  which: "legal" | "any",
): ObjectId {
  const answers = legalActions(state, player as PlayerId, cards).flatMap((a) =>
    a.type === "ANSWER" && "object" in a.answer ? [a.answer.object] : [],
  );
  const copy = handCopy(state, player as PlayerId, name, cards);
  if (copy !== null) {
    if (which === "legal" && !answers.includes(copy)) throw new Error(`${name} isn't a card ${player} can choose`);
    return copy;
  }
  const pool = which === "legal" ? answers : [...answers, ...(Object.keys(state.objects) as ObjectId[])];
  const found = pool.find((id) => nameOf(state, id, cards) === name);
  if (found === undefined) throw new Error(`no ${name} for ${player} to choose`);
  return found;
}

/**
 * The permanent and ability an `activate` step names. A plain name (`Mountain`) means a permanent the player controls:
 * the first, in battlefield order, whose ability they can activate now (or just the first, for an illegal attempt).
 * A reference (`p2:Mountain`, `p1:Mountain#2`) names exactly one. `ability: <n>` counts from 1 in the order
 * `abilitiesOf` lists them, and is needed only when the permanent has more than one.
 */
export function abilityNamed(
  state: GameState,
  step: Extract<ScenarioStep, { kind: "activate" }>,
  cards: CardDatabase,
  which: "legal" | "any" = "legal",
): { object: ObjectId; ability: AbilityRef } {
  const ref = parseRef(step.card);
  const candidates =
    ref !== null
      ? [resolveRef(state, ref, cards)].filter((x): x is ObjectId => x !== null)
      : battlefieldOf(state, step.player as PlayerId).filter((id) => nameOf(state, id, cards) === step.card);
  if (candidates.length === 0) throw new Error(`no ${step.card} for ${step.player} to activate`);
  const options = candidates.map((object) => {
    const abilities = abilitiesOf(state, object, cards);
    if (step.ability === null && abilities.length > 1)
      throw new Error(`${step.card} has ${abilities.length} abilities: say ability: <n>`);
    const chosen = abilities[(step.ability ?? 1) - 1];
    if (chosen === undefined) throw new Error(`${step.card} has no ability ${step.ability ?? 1}`);
    return { object, ability: chosen.ref };
  });
  const legal = legalActions(state, step.player as PlayerId, cards);
  const usable = options.find((o) =>
    legal.some((a) => a.type === "ACTIVATE_ABILITY" && a.object === o.object && deepEqual(a.ability, o.ability)),
  );
  const first = options[0];
  if (first === undefined) throw new Error(`no ${step.card} to activate`);
  return which === "legal" ? (usable ?? first) : first;
}

/** A target a scenario names: a player (`p2`) or a permanent reference (`p2:Grizzly Bears`). */
export function targetNamed(state: GameState, value: unknown, cards: CardDatabase): Target {
  const text = String(value);
  if (/^p\d+$/.test(text)) return { kind: "player", player: text as PlayerId };
  const ref = parseRef(text);
  const object = ref === null ? null : resolveRef(state, ref, cards);
  if (object === null) throw new Error(`no target "${text}": name a player (p2) or a permanent (p2:Grizzly Bears)`);
  return { kind: "object", object };
}
