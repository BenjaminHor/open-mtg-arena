// Cards that rules make public while they stay in a hidden zone (CR 400.2: a hand or library is still a hidden zone
// "even if all the cards in one such zone happen to be revealed"): hands "played revealed" (Telepathy) and a library's
// top card (Vampire Nocturnus), each "play with ..." effect lasting as long as the game is played (CR 701.18c). Read from
// the permanents' abilities as they are now (CR 613), so a stolen Nocturnus reveals its new controller's library and
// one that lost its abilities reveals nothing. A revealed card is shown to every player (CR 701.20a).

import type { CardDatabase, StaticAbilityDef } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { staticAbilitiesOf } from "./abilities.ts";
import { controllerOf } from "./controller.ts";

/** The players whose hands are revealed: the opponents of each player controlling Telepathy. */
export function handsRevealed(state: GameState, cards: CardDatabase): PlayerId[] {
  const telepaths = controllersWith(state, "opponentsPlayWithHandsRevealed", cards);
  // An opponent is any other player (CR 102.2, two players only so far).
  return state.turnOrder.filter((p) => telepaths.some((t) => t !== p));
}

/** The players whose library's top card is revealed: each player controlling Vampire Nocturnus (CR 401.5). */
export function libraryTopsRevealed(state: GameState, cards: CardDatabase): PlayerId[] {
  const revealers = controllersWith(state, "playWithTopOfLibraryRevealed", cards);
  return state.turnOrder.filter((p) => revealers.includes(p));
}

function controllersWith(state: GameState, kind: StaticAbilityDef["kind"], cards: CardDatabase): PlayerId[] {
  return state.zones.battlefield
    .filter((id) => staticAbilitiesOf(state, id, cards).some((a) => a.kind === kind))
    .map((id) => controllerOf(state, id, cards));
}
