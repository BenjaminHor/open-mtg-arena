// "Activated abilities of sources with the chosen name can't be activated unless they're mana abilities" (Pithing
// Needle): a rule on activating (CR 602.5), for sources in any zone (its ruling), named the card name its permanent
// chose as it entered (CR 614.12a).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { staticAbilitiesOf } from "./abilities.ts";
import { characteristics } from "./characteristics.ts";

/** The name a permanent says can't have its activated abilities activated, if one does, of this source. */
export function namedCantActivate(state: GameState, source: ObjectId, cards: CardDatabase): string | null {
  const names = state.zones.battlefield.flatMap((id) => {
    const obj = state.objects[id];
    if (obj?.kind !== "card" || obj.chosenName === undefined) return [];
    return staticAbilitiesOf(state, id, cards).some((a) => a.kind === "chosenNameCantActivate") ? [obj.chosenName] : [];
  });
  // Only then the source's name, through its characteristics (a copy effect could change it, later: CR 707.2).
  if (names.length === 0) return null;
  const name = characteristics(state, source, cards).name;
  return names.includes(name) ? name : null;
}
