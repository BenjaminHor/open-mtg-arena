// Layer 4's setting of a land's subtype (CR 613.1d, 305.7): "Enchanted land is the chosen type" (Convincing Mirage).
// The land's land types become the chosen basic one; it keeps its card types, supertypes and other subtypes (a
// Treefolk stays a Treefolk); it loses the abilities from its rules text, and gains the new type's mana ability, which
// `abilitiesOf` gives any land with a basic land type (CR 305.6). Abilities granted by other effects stay (layer 6).
// The copiable effects it also loses (later: CR 305.7, layer 1) aren't built.

import type { ObjectId } from "../state/ids.ts";
import { attachedHostIn } from "./attachment.ts";
import type { Layered, LayerInputs } from "./layers.ts";
import { staticTimestamp } from "./static-effects.ts";

/** The land types (CR 205.3i): all of them go when a land's subtype is set (only basic ones are in the pool). */
const LAND_TYPES: readonly string[] = [
  "Cave",
  "Desert",
  "Forest",
  "Gate",
  "Island",
  "Lair",
  "Locus",
  "Mine",
  "Mountain",
  "Plains",
  "Planet",
  "Power-Plant",
  "Sphere",
  "Swamp",
  "Tower",
  "Town",
  "Urza's",
];

/**
 * Sets the land type of each land an Aura with "enchanted land is the chosen type" enchants, in timestamp order, so of two
 * on one land the later wins (CR 613.7; an Aura's timestamp is its attaching's, CR 613.7e). They come after the
 * resolved effects of layer 4 (later: CR 613.7 between the two kinds; no pool card makes it matter, as Awakener Druid
 * and Rise from the Grave only add types). Its printed keywords, protections and static abilities go now, before layer 6
 * grants any; no pool land has any, so only `abilitiesOf`'s part shows in a game.
 */
export function setLandTypes(input: LayerInputs, board: Record<ObjectId, Layered>): void {
  const setters = input.battlefield.filter((id) => {
    const obj = input.objects[id];
    return (
      obj?.kind === "card" &&
      obj.chosenLandType !== undefined &&
      (board[id]?.statics ?? []).some((s) => s.kind === "attachedSetsLandType")
    );
  });
  if (setters.length === 0) return;
  setters.sort((x, y) => staticTimestamp(input, x) - staticTimestamp(input, y));
  for (const id of setters) {
    const obj = input.objects[id];
    const host = attachedHostIn(input.objects, input.battlefield, id);
    const land = host === null ? undefined : board[host];
    if (obj?.kind !== "card" || obj.chosenLandType === undefined || host === null || land === undefined) continue;
    if (!land.types.includes("land")) continue;
    board[host] = {
      ...land,
      subtypes: [...land.subtypes.filter((t) => !LAND_TYPES.includes(t)), obj.chosenLandType],
      keywords: [],
      protections: [],
      statics: [],
      rulesTextLost: true,
    };
  }
}
