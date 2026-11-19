// Turning scenario steps into engine actions (docs/testing.md, "Steps"). Every action comes from `legalActions()`, so
// a step that names something illegal fails, unless the next step is `expect error`.

import {
  type AbilityRef,
  type Action,
  type Answer,
  abilitiesOf,
  applyAction,
  autoPay,
  type CardDatabase,
  type GameEvent,
  type GameState,
  legalActions,
  type ObjectId,
  type PlayerId,
  type Target,
} from "@mtg/engine";
import { deepEqual } from "./compare.ts";
import type { ScenarioStep } from "./format.ts";
import { isRecord } from "./format.ts";
import { battlefieldOf, engineStep, nameOf, parseRef, resolveRef } from "./names.ts";

export type Game = { state: GameState; events: GameEvent[] };

/** A step that changes the game: passing or choosing. */
export type ActionStep = Extract<ScenarioStep, { kind: "pass" | "allPass" | "choose" | "activate" | "play" | "cast" }>;

/** The most passes `all pass: until` makes before giving up, so a step that never comes fails instead of hanging. */
const MAX_PASSES = 500;

/** Applies a step's actions, each checked by `afterEach`. Throws a readable message when the step can't be taken. */
export function takeStep(game: Game, step: ActionStep, cards: CardDatabase, afterEach: (g: Game) => void): Game {
  switch (step.kind) {
    case "pass":
      return apply(
        game,
        legal(game, step.player, cards, (a) => a.type === "PASS_PRIORITY", "pass"),
        cards,
        afterEach,
      );
    case "allPass": {
      if (step.until === null) {
        let next = game;
        for (const _ of game.state.turnOrder) next = passByWhoeverHasPriority(next, cards, afterEach);
        return next;
      }
      const target = engineStep(step.until);
      let next = game;
      let begun = false;
      for (let passes = 0; passes < MAX_PASSES; passes++) {
        const before = next.events.length;
        next = passByWhoeverHasPriority(next, cards, afterEach);
        begun ||= next.events.slice(before).some((e) => e.type === "STEP_BEGAN" && e.step === target);
        if (begun && next.state.pending?.kind === "priority" && next.state.turn?.step === target) return next;
      }
      throw new Error(`"all pass: until ${step.until}" didn't reach that step with priority in ${MAX_PASSES} passes`);
    }
    case "play": {
      const action = legal(
        game,
        step.player,
        cards,
        (a) => a.type === "PLAY_LAND" && nameOf(game.state, a.object, cards) === step.card,
        `play ${step.card}`,
      );
      return apply(game, action, cards, afterEach);
    }
    case "cast": {
      let next = apply(
        game,
        legal(
          game,
          step.player,
          cards,
          (a) => a.type === "CAST_SPELL" && nameOf(game.state, a.object, cards) === step.card,
          `cast ${step.card}`,
        ),
        cards,
        afterEach,
      );
      for (const value of step.targets) {
        const target = targetNamed(next.state, value, cards);
        const answer = legal(
          next,
          step.player,
          cards,
          (a) => a.type === "ANSWER" && deepEqual(a.answer, { kind: "chooseTarget", target }),
          `target ${String(value)}`,
        );
        next = apply(next, answer, cards, afterEach);
      }
      for (const action of paymentActions(next, step, cards)) {
        const found = legal(
          next,
          step.player,
          cards,
          (a) => deepEqual({ ...a, decisionId: "" }, { ...action, decisionId: "" }),
          "pay",
        );
        next = apply(next, found, cards, afterEach);
      }
      return next;
    }
    case "activate": {
      const { object, ability } = abilityNamed(game.state, step, cards);
      const action = legal(
        game,
        step.player,
        cards,
        (a) => a.type === "ACTIVATE_ABILITY" && a.object === object && deepEqual(a.ability, ability),
        `activate ${step.card}`,
      );
      return apply(game, action, cards, afterEach);
    }
    case "choose": {
      const answer = answerFor(game.state, step.player, step.value, cards, "legal");
      const action = legal(
        game,
        step.player,
        cards,
        (a) => a.type === "ANSWER" && deepEqual(a.answer, answer),
        `choose ${String(step.value)}`,
      );
      return apply(game, action, cards, afterEach);
    }
  }
}

/**
 * For a step followed by `expect error`: sends the step's actions directly, without looking them up in `legalActions()`,
 * and returns the first rejection, or null if every action was accepted. A `cast` is several actions (the cast, each
 * target, the payment); the first one rejected is the one that counts.
 */
export function firstRejection(
  game: Game,
  step: ActionStep,
  cards: CardDatabase,
): { code: string; message: string } | null {
  let state = game.state;
  // A cast's payment is planned once, when the payment decision comes up, then carried out action by action.
  let payment: Action[] | null = null;
  for (let i = 0; ; i++) {
    let action: Action | null;
    if (step.kind === "cast" && i > step.targets.length) {
      payment ??= paymentActions({ state, events: [] }, step, cards);
      const next = payment[i - 1 - step.targets.length];
      action =
        next === undefined || next.type === "CONCEDE"
          ? (next ?? null)
          : { ...next, decisionId: state.pending?.id ?? "d0" };
    } else {
      action = directAction(state, step, cards, i);
    }
    if (action === null) return null;
    const result = applyAction(state, action, cards);
    if (!result.ok) return result.error;
    state = result.state;
  }
}

/**
 * The i-th action of a step, built from the current state, or null when the step has no more actions. A cast's
 * payment actions come from `paymentActions`, planned once by the caller.
 */
function directAction(state: GameState, step: ActionStep, cards: CardDatabase, i: number): Action | null {
  const decisionId = state.pending?.id ?? "d0";
  if (step.kind === "allPass") {
    throw new Error('"all pass" can\'t be followed by expect error: name the one player whose pass is illegal');
  }
  const player = step.player as PlayerId;
  switch (step.kind) {
    case "pass":
      return i === 0 ? { type: "PASS_PRIORITY", decisionId, player } : null;
    case "choose":
      return i === 0
        ? { type: "ANSWER", decisionId, player, answer: answerFor(state, step.player, step.value, cards, "any") }
        : null;
    case "activate": {
      if (i > 0) return null;
      const { object, ability } = abilityNamed(state, step, cards, "any");
      return { type: "ACTIVATE_ABILITY", decisionId, player, object, ability };
    }
    case "play":
      return i === 0
        ? { type: "PLAY_LAND", decisionId, player, object: cardIn(state, player, step.card, cards) }
        : null;
    case "cast": {
      if (i === 0) return { type: "CAST_SPELL", decisionId, player, object: cardIn(state, player, step.card, cards) };
      const target = step.targets[i - 1];
      return target === undefined
        ? null
        : {
            type: "ANSWER",
            decisionId,
            player,
            answer: { kind: "chooseTarget", target: targetNamed(state, target, cards) },
          };
    }
  }
}

/** The card with this name in the player's hand (the first one), for an attempt that may be illegal. */
function cardIn(state: GameState, player: PlayerId, name: string, cards: CardDatabase): ObjectId {
  const found = (state.zones.players[player]?.hand ?? []).find((id) => nameOf(state, id, cards) === name);
  if (found === undefined) throw new Error(`${player} has no ${name} in hand`);
  return found;
}

/**
 * The actions that pay for a spell being cast: `auto` activates what autoPay picks, then pays; `{ R: 1 }` pays that from
 * the pool; `cancel` cancels the cast; no `pay` leaves the payment decision pending.
 */
function paymentActions(game: Game, step: Extract<ScenarioStep, { kind: "cast" }>, cards: CardDatabase): Action[] {
  const pending = game.state.pending;
  const player = step.player as PlayerId;
  if (step.pay === undefined || pending?.kind !== "payMana") return [];
  const decisionId = pending.id;
  if (step.pay === "cancel") return [{ type: "ANSWER", decisionId, player, answer: { kind: "cancelCast" } }];
  if (step.pay === "auto") {
    const plan = autoPay(game.state, player, pending.cost, cards);
    if (plan === null) throw new Error("pay: auto found no way to pay");
    return [
      ...plan.activations.map(
        (a) => ({ type: "ACTIVATE_ABILITY", decisionId, player, object: a.object, ability: a.ability }) as const,
      ),
      { type: "ANSWER", decisionId, player, answer: { kind: "payMana", payment: plan.payment } },
    ];
  }
  if (!isRecord(step.pay)) throw new Error('pay is "auto", "cancel", or a payment like { R: 1 }');
  const payment = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...(step.pay as Record<string, number>) };
  return [{ type: "ANSWER", decisionId, player, answer: { kind: "payMana", payment } }];
}

function passByWhoeverHasPriority(game: Game, cards: CardDatabase, afterEach: (g: Game) => void): Game {
  const pending = game.state.pending;
  if (pending?.kind !== "priority")
    throw new Error(`expected someone to have priority, but the game waits for ${pending?.kind ?? "nothing"}`);
  return apply(
    game,
    legal(game, pending.player, cards, (a) => a.type === "PASS_PRIORITY", "pass"),
    cards,
    afterEach,
  );
}

/** The answer a `choose:` value names, for the pending decision. Exhaustive, so new decision kinds must be handled. */
function answerFor(
  state: GameState,
  player: string,
  value: unknown,
  cards: CardDatabase,
  which: "legal" | "any",
): Answer {
  const pending = state.pending;
  if (pending === null) throw new Error("nothing is pending to choose for");
  const text = String(value);
  switch (pending.kind) {
    case "chooseStartingPlayer":
      return { kind: "chooseStartingPlayer", player: text as PlayerId };
    case "mulligan":
      if (text !== "keep" && text !== "mulligan")
        throw new Error(`a mulligan decision takes keep or mulligan, got ${text}`);
      return { kind: "mulligan", choice: text };
    case "mulliganBottom":
    case "discardToHandSize":
      return { kind: pending.kind, object: cardNamed(state, player, text, cards, which) };
    case "chooseTarget":
      return { kind: "chooseTarget", target: targetNamed(state, value, cards) };
    case "payMana": {
      if (value === "cancel") return { kind: "cancelCast" };
      if (!isRecord(value)) throw new Error('paying takes a payment like { R: 1 }, or "cancel"');
      return { kind: "payMana", payment: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...(value as Record<string, number>) } };
    }
    case "priority":
      throw new Error("the player has priority: use pass, play, cast or activate");
  }
}

/**
 * A card with this name among the player's legal answers. With several identical cards (eight Forests), the first in
 * zone order that's still a legal answer is used. For an illegal attempt (`expect error`), any card with the name,
 * wherever it is.
 */
function cardNamed(
  state: GameState,
  player: string,
  name: string,
  cards: CardDatabase,
  which: "legal" | "any",
): ObjectId {
  const answers = legalActions(state, player as PlayerId, cards).flatMap((a) =>
    a.type === "ANSWER" && "object" in a.answer ? [a.answer.object] : [],
  );
  const pool = which === "legal" ? answers : [...answers, ...(Object.keys(state.objects) as ObjectId[])];
  const found = pool.find((id) => nameOf(state, id, cards) === name);
  if (found === undefined) throw new Error(`no ${name} for ${player} to choose`);
  return found;
}

function legal(game: Game, player: string, cards: CardDatabase, match: (a: Action) => boolean, what: string): Action {
  const actions = legalActions(game.state, player as PlayerId, cards);
  const found = actions.find(match);
  if (found !== undefined) return found;
  const pending = game.state.pending;
  throw new Error(
    `${player} can't ${what}: it isn't a legal action (pending: ${pending === null ? "nothing" : `${pending.kind} for ${pending.player}`})`,
  );
}

function apply(game: Game, action: Action, cards: CardDatabase, afterEach: (g: Game) => void): Game {
  const result = applyAction(game.state, action, cards);
  if (!result.ok) throw new Error(`a legal action was rejected: ${result.error.message}`);
  const next = { state: result.state, events: [...game.events, ...result.events] };
  afterEach(next);
  return next;
}

/**
 * The permanent and ability an `activate` step names. A plain name (`Mountain`) means a permanent the player controls:
 * the first, in battlefield order, whose ability they can activate now (or just the first, for an illegal attempt).
 * A reference (`p2:Mountain`, `p1:Mountain#2`) names exactly one. `ability: <n>` counts from 1 in the order
 * `abilitiesOf` lists them, and is needed only when the permanent has more than one.
 */
function abilityNamed(
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
