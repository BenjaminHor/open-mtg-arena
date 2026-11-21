// Layer 6 of the layer pass (CR 613.1f): keywords granted by resolved effects, on the objects they locked in
// (CR 611.2c), and granted or removed by static abilities, on what fits now (CR 611.3a), all applied in timestamp order
// (CR 613.7, 613.7a). Also, though not a layer, the restrictions an attached permanent puts on its host (Pacifism,
// Whispersilk Cloak, Ice Cage, Entangling Vines), marked here because the pass already finds what each static applies to.

import type { CardDatabase, Keyword } from "../cards/types.ts";
import type { ObjectId } from "../state/ids.ts";
import { attachedHostIn } from "./attachment.ts";
import { type Layered, type LayerInputs, withoutRepeats } from "./layers.ts";
import { type KeywordGrant, type StaticSource, staticKeywordGrants } from "./static-effects.ts";

/**
 * Applies layer 6 to the board, changing it in place (the pass's own working copy), and returns the sets the static
 * abilities found, which they keep in 7c (CR 613.6).
 */
export function layerSix(
  input: LayerInputs,
  board: Record<ObjectId, Layered>,
  sources: readonly StaticSource[],
  cards: CardDatabase,
): (ObjectId[] | undefined)[] {
  const { grants, sets } = staticKeywordGrants(input, board, sources, cards);
  for (const effect of input.effects) {
    if (effect.change.kind !== "addKeywords") continue;
    const grant = { source: effect.source, timestamp: effect.timestamp, keywords: effect.change.keywords, lose: [] };
    for (const id of effect.affected) grants[id] = [...(grants[id] ?? []), grant];
  }
  for (const [id, unordered] of Object.entries(grants) as [ObjectId, KeywordGrant[]][]) {
    const card = board[id];
    if (card === undefined) continue;
    const granted = [...unordered].sort((x, y) => x.timestamp - y.timestamp);
    let keywords: readonly Keyword[] = card.keywords;
    for (const g of granted) keywords = withoutRepeats([...keywords, ...g.keywords]).filter((k) => !g.lose.includes(k));
    board[id] = { ...card, keywords, granted };
  }
  markRestrictions(input, board, sources);
  return sets;
}

/**
 * "Enchanted creature can't attack or block", "can't be blocked", "its activated abilities can't be activated",
 * "doesn't untap during its controller's untap step" (CR 303.4m, 301.5f), on the host.
 */
function markRestrictions(input: LayerInputs, board: Record<ObjectId, Layered>, sources: readonly StaticSource[]) {
  for (const s of sources) {
    const host = attachedHostIn(input.objects, input.battlefield, s.source);
    const card = host === null ? undefined : board[host];
    if (host === null || card === undefined) continue;
    switch (s.def.kind) {
      case "attachedCantAttackOrBlock":
        board[host] = { ...card, cantAttackOrBlock: true };
        break;
      case "attachedCantBeBlocked":
        board[host] = { ...card, cantBeBlocked: true };
        break;
      case "attachedCantActivate":
        board[host] = { ...card, cantActivate: true };
        break;
      case "attachedDoesntUntap":
        board[host] = { ...card, doesntUntap: true };
        break;
      // Layer 4, in `land-type.ts`.
      case "attachedSetsLandType":
      case "attachedControl":
      case "attachedGets":
      case "creaturesGet":
      case "plusPerSharedCreatureType":
      case "plusPerOtherSameName":
      case "cantBeBlocked":
      case "canBlockAnyNumber":
      case "cantAttackOrBlockAlone":
      case "attacksEachCombat":
      case "mustBeBlockedByAllAble":
      case "cantBeCountered":
      case "powerToughnessEachEqual":
      case "cantAttackUnlessDefenderControls":
      case "noMaximumHandSize":
      case "opponentsPlayWithHandsRevealed":
      case "playWithTopOfLibraryRevealed":
      case "cantLoseOpponentsCantWin":
      case "chosenNameCantActivate":
        break;
    }
  }
}
