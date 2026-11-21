// Activating abilities of permanents, and mana abilities in particular (CR 602, 605). A mana ability doesn't use the
// stack: it resolves at once (CR 605.3b).

import type { AbilityDef, CardDatabase, Color, Effect } from "../cards/types.ts";
import { runEffect } from "../effects/run-effect.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { queueWork } from "../game/work.ts";
import { happen } from "../pipeline/happen.ts";
import { findAbility, isManaAbility } from "../rules/abilities.ts";
import { controllerOf } from "../rules/controller.ts";
import { layeredOf } from "../rules/layers.ts";
import { canUseTapAbilities } from "../rules/summoning-sickness.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { COLORS, type ManaType } from "../state/mana.ts";
import type { AbilityRef } from "../state/objects.ts";
import { detectTriggers } from "../triggers/detect.ts";

/**
 * What stops any activated ability of a permanent, mana ability or not: it works only on the battlefield (CR 113.6),
 * only its controller activates it (CR 602.2), and a {T} in its cost must be payable (CR 118.3, 602.5a). Mana in the cost
 * is paid later, while the ability is put on the stack (CR 601.2g–h, 602.2b). Null if nothing stops it.
 */
export function activationBasicsProblem(
  state: GameState,
  player: PlayerId,
  id: ObjectId,
  ref: AbilityRef,
  cards: CardDatabase,
): string | null {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || !state.zones.battlefield.includes(id)) return `${id} isn't a permanent`;
  if (controllerOf(state, id, cards) !== player) return `${player} doesn't control ${id}`;
  const ability = findAbility(state, id, ref, cards);
  if (ability === null) return `${id} has no such ability`;
  // "Its activated abilities can't be activated" (Ice Cage): all of them, mana abilities included (CR 602.5, 605.3a).
  if (layeredOf(state, id, cards)?.cantActivate === true) return `${id}'s activated abilities can't be activated`;
  for (const part of ability.def.cost) {
    switch (part.kind) {
      case "tap":
        // A tapped permanent can't be tapped to pay a cost (CR 107.5, 118.3).
        if (obj.tapped) return `${id} is already tapped`;
        if (!canUseTapAbilities(state, id, cards))
          return `${id} hasn't been controlled since the turn began (CR 602.5a)`;
        break;
      case "mana":
      case "sacrifice":
      case "sacrificeSelf":
        break;
      default:
        return assertNever(part);
    }
  }
  return null;
}

/** Why the player can't activate this as a mana ability now, or null. */
export function manaAbilityProblem(
  state: GameState,
  player: PlayerId,
  id: ObjectId,
  ref: AbilityRef,
  cards: CardDatabase,
): string | null {
  const problem = activationBasicsProblem(state, player, id, ref, cards);
  if (problem !== null) return problem;
  const ability = findAbility(state, id, ref, cards);
  if (ability === null || !isManaAbility(ability.def)) return "that isn't a mana ability";
  // A mana ability with mana or a sacrifice in its cost would need a payment while it resolves at once; none is in the
  // pool yet.
  if (ability.def.cost.some((part) => part.kind !== "tap"))
    return "mana abilities with costs other than {T} aren't supported yet";
  // A mana ability can do more than add mana (CR 605.1a). Cancelling a cast can't reverse anything but mana and
  // tapping yet (D-035, future-rules.md), so mana abilities with other effects wait for a card that needs one.
  if (ability.def.effects.some((e) => e.op !== "addMana"))
    return "mana abilities that do more than add mana aren't supported yet";
  return null;
}

/**
 * The colors a mana ability lets its activation choose from: all five for "one mana of any color", two for "{G} or {W}"
 * (D-068), none for an ability that makes one kind of mana, whose activation names no color.
 */
export function manaChoices(def: AbilityDef): readonly Color[] {
  return def.effects.flatMap((e) => (e.op === "addMana" ? choicesOf(e.mana) : []));
}

/** The kinds of mana an "add mana" effect can make, and whether its activation chooses one (D-068). */
export function manaKinds(mana: AddedMana): { makes: readonly ManaType[]; chooses: boolean } {
  if (mana === "anyColor" || typeof mana === "object") return { makes: choicesOf(mana), chooses: true };
  return { makes: [mana], chooses: false };
}

type AddedMana = Extract<Effect, { op: "addMana" }>["mana"];

function choicesOf(mana: AddedMana): readonly Color[] {
  if (mana === "anyColor") return COLORS;
  return typeof mana === "object" ? mana.oneOf : [];
}

/**
 * Why the color sent with a mana ability's activation is wrong, or null: an "any color" ability needs one of the five
 * colors (CR 105.4), a "{G} or {W}" one one of its two, the choice its text offers (CR 608.2d); any other ability
 * takes none (D-068).
 */
export function manaColorProblem(
  state: GameState,
  id: ObjectId,
  ref: AbilityRef,
  color: Color | undefined,
  cards: CardDatabase,
): string | null {
  const ability = findAbility(state, id, ref, cards);
  const choices = ability === null ? [] : manaChoices(ability.def);
  if (choices.length === 0)
    return color === undefined ? null : "only a mana ability with a choice of color takes a color";
  if (color === undefined || !choices.includes(color))
    return `choose one of ${choices.join(", ")} for that mana (CR 608.2d)`;
  return null;
}

/**
 * A mana ability is activated and resolves at once (CR 605.3b): its costs are paid, then mana goes into the activating
 * player's pool (CR 106.4). No priority changes here, so casting (M1-09) can use it while a cost is being paid
 * (CR 605.3a, 601.2g). For "one mana of any color", `color` is the color chosen as it resolves (CR 608.2d, D-068).
 */
export function resolveManaAbility(
  state: GameState,
  player: PlayerId,
  id: ObjectId,
  ref: AbilityRef,
  cards: CardDatabase,
  color?: Color,
): Progress {
  const colorProblem = manaColorProblem(state, id, ref, color, cards);
  if (colorProblem !== null) throw new Error(colorProblem);
  const problem = manaAbilityProblem(state, player, id, ref, cards);
  if (problem !== null) throw new Error(problem);
  const ability = findAbility(state, id, ref, cards);
  if (ability === null) throw new Error("No such ability");
  let progress: Progress = { state, events: [] };
  for (const part of ability.def.cost) {
    switch (part.kind) {
      case "tap":
        progress = andThen(progress, (s) => happen(s, { kind: "tap", object: id }, cards));
        break;
      case "mana":
        throw new Error("mana abilities with mana costs aren't supported yet");
      case "sacrifice":
      case "sacrificeSelf":
        throw new Error("mana abilities with sacrifice costs aren't supported yet");
      default:
        return assertNever(part);
    }
  }
  // It doesn't use the stack, so its effects run now, through the same interpreter as spells (CR 605.3b). A mana
  // ability can't have targets (CR 605.1a). Its effects only add mana (`manaAbilityProblem` refuses others), so none
  // can wait for a choice of replacement effect here, outside the work queue.
  const context = { self: id, controller: player, targets: [], division: [], x: null, trigger: null };
  for (const effect of ability.def.effects) {
    const chosen =
      effect.op === "addMana" && choicesOf(effect.mana).length > 0 && color !== undefined
        ? { ...effect, mana: color }
        : effect;
    progress = andThen(progress, (s) => runEffect(s, chosen, context, cards));
  }
  // "Taps [it] for mana": a {T} in the cost, and mana produced (CR 106.12, 106.12a). It's matched here, where it's
  // emitted: the tap and the mana already went through `happen`.
  const tapped = ability.def.cost.some((part) => part.kind === "tap");
  const produced = progress.events.some((e) => e.type === "MANA_ADDED" && e.amount > 0);
  if (!tapped || !produced) return progress;
  const event = { type: "TAPPED_FOR_MANA", player, object: id } as const;
  return {
    state: detectTriggers(progress.state, progress.state, [event], cards),
    events: [...progress.events, event],
  };
}

/**
 * The player activates a mana ability while holding priority (CR 605.3a). Taking an action means everyone must pass
 * again (CR 117.4), and the player then gets priority again (CR 117.3c).
 */
export function activateManaAbility(
  state: GameState,
  player: PlayerId,
  id: ObjectId,
  ref: AbilityRef,
  cards: CardDatabase,
  color?: Color,
): Progress {
  const resolved = resolveManaAbility({ ...state, passesInSuccession: 0 }, player, id, ref, cards, color);
  return { state: queueWork(resolved.state, { kind: "givePriority", player }), events: resolved.events };
}

function assertNever(part: never): never {
  throw new Error(`unknown cost part ${JSON.stringify(part)}`);
}
