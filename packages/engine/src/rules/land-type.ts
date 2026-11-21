// Layer 4's setting of a land's subtype (CR 613.1d, 305.7): "Enchanted land is the chosen type" (Convincing Mirage).
// The land's land types become the chosen basic one; it keeps its card types, supertypes and other subtypes (a
// Treefolk stays a Treefolk); it loses the abilities from its rules text, and gains the new type's mana ability, which
// `abilitiesOf` gives any land with a basic land type (CR 305.6). Abilities granted by other effects stay (layer 6).

import type { ObjectId } from "../state/ids.ts";
import { attachedHostIn } from "./attachment.ts";
import type { Layered, LayerInputs } from "./layers.ts";

/** The land types (CR 205.3i): all of them go when a land's subtype is set. */
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
 * Sets the land type of each land an Aura with "enchanted land is the chosen type" enchants, after the resolved effects
 * of layer 4 (later: CR 613.7, timestamp order among them; no pool card makes the order matter, as Awakener Druid adds
 * only a creature type). Its printed keywords, protections and static abilities go now, before layer 6 grants any.
 */
export function setLandTypes(input: LayerInputs, board: Record<ObjectId, Layered>): void {
  for (const id of input.battlefield) {
    const obj = input.objects[id];
    const aura = board[id];
    if (obj?.kind !== "card" || obj.chosenLandType === undefined || aura === undefined) continue;
    if (!aura.statics.some((s) => s.kind === "attachedSetsLandType")) continue;
    const host = attachedHostIn(input.objects, input.battlefield, id);
    const land = host === null ? undefined : board[host];
    if (host === null || land === undefined || !land.types.includes("land")) continue;
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
