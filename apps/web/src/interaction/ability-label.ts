// A label for an activated ability that tells it apart from the card's others (a menu of two "Activate" entries can't
// be chosen from): what a mana ability adds, or what another one costs (CR 602.1a: cost, then effect). "Add {G}",
// "{T}", "+2", "−10", "{2}{R}, {T}".

import type { AbilityDef, Color, CostPart, ManaCost } from "@mtg/engine";

export function abilityLabel(def: AbilityDef, color: Color | undefined): string {
  const mana = def.effects.find((e) => e.op === "addMana");
  if (mana !== undefined && mana.op === "addMana") {
    const made =
      color ??
      (typeof mana.mana === "string"
        ? mana.mana === "anyColor"
          ? "any color"
          : mana.mana
        : mana.mana.oneOf.join(" or "));
    const symbol = made.length === 1 ? `{${made}}` : made;
    const times = typeof mana.amount === "number" && mana.amount > 1 ? `${mana.amount} × ` : "";
    return `Add ${times}${symbol}`;
  }
  return def.cost.map(costText).join(", ") || "Activate";
}

function costText(part: CostPart): string {
  switch (part.kind) {
    case "mana":
      return manaText(part.cost);
    case "tap":
      return "{T}";
    case "sacrifice":
      return "Sacrifice a permanent";
    case "sacrificeSelf":
      return "Sacrifice it";
    case "loyalty":
      return part.amount === "minusX"
        ? "−X"
        : part.amount > 0
          ? `+${part.amount}`
          : part.amount === 0
            ? "0"
            : `−${-part.amount}`;
    case "removeCounters":
      return `Remove ${part.amount} ${part.counter} counter${part.amount === 1 ? "" : "s"}`;
  }
}

function manaText(cost: ManaCost): string {
  return cost.map(symbolText).join("");
}

function symbolText(s: ManaCost[number]): string {
  switch (s.kind) {
    case "generic":
      return `{${s.amount}}`;
    case "x":
      return "{X}";
    case "colored":
      return `{${s.color}}`;
  }
}
