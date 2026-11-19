// Activating a mana ability (CR 605). It doesn't use the stack: it resolves at once (CR 605.3b).

import type { CardDatabase } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { andThen } from "../game/progress.ts";
import { queueWork } from "../game/work.ts";
import { tapPermanent } from "../permanents/tap.ts";
import { abilitiesOf, isManaAbility } from "../rules/abilities.ts";
import { controllerOf } from "../rules/controller.ts";
import { canUseTapAbilities } from "../rules/summoning-sickness.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { AbilityRef } from "../state/objects.ts";
import { addMana } from "./pool.ts";

/** Why the player can't activate this mana ability now, or null if they can. */
export function manaAbilityProblem(
  state: GameState,
  player: PlayerId,
  id: ObjectId,
  ref: AbilityRef,
  cards: CardDatabase,
): string | null {
  const obj = state.objects[id];
  // An ability of a permanent works only on the battlefield (CR 113.6).
  if (obj?.kind !== "card" || !state.zones.battlefield.includes(id)) return `${id} isn't a permanent`;
  // Only the object's controller can activate its abilities (CR 602.2).
  if (controllerOf(state, id) !== player) return `${player} doesn't control ${id}`;
  const ability = abilitiesOf(state, id, cards).find((a) => JSON.stringify(a.ref) === JSON.stringify(ref));
  if (ability === undefined) return `${id} has no such ability`;
  if (!isManaAbility(ability.def))
    return "only mana abilities can be activated so far (other abilities arrive in M1-14)";
  for (const part of ability.def.cost) {
    switch (part.kind) {
      case "tap":
        // An already tapped permanent can't be tapped to pay a cost (CR 107.5, 118.3).
        if (obj.tapped) return `${id} is already tapped`;
        if (!canUseTapAbilities(state, id, cards))
          return `${id} hasn't been controlled since the turn began (CR 602.5a)`;
        break;
      case "mana":
        return "mana abilities with mana costs aren't supported yet";
    }
  }
  return null;
}

/**
 * The player activates a mana ability while holding priority (CR 605.3a): pays its cost, then it resolves at once,
 * adding mana to their pool (CR 605.3b, 106.4). Taking an action means everyone must pass again (CR 117.4), and the
 * player then gets priority again (CR 117.3c).
 */
export function activateManaAbility(
  state: GameState,
  player: PlayerId,
  id: ObjectId,
  ref: AbilityRef,
  cards: CardDatabase,
): Progress {
  const problem = manaAbilityProblem(state, player, id, ref, cards);
  if (problem !== null) throw new Error(problem);
  const ability = abilitiesOf(state, id, cards).find((a) => JSON.stringify(a.ref) === JSON.stringify(ref));
  if (ability === undefined) throw new Error("No such ability");
  let progress: Progress = { state: { ...state, passesInSuccession: 0 }, events: [] };
  for (const part of ability.def.cost)
    if (part.kind === "tap") progress = andThen(progress, (s) => tapPermanent(s, id));
  for (const effect of ability.def.effects) {
    if (effect.op === "addMana") progress = andThen(progress, (s) => addMana(s, player, effect.mana, effect.amount));
  }
  return { state: queueWork(progress.state, { kind: "givePriority", player }), events: progress.events };
}
