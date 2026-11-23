// An ability's own text, picked from its source's Oracle text (M3-04c slice 6): Arena draws an ability on the stack as
// a panel with "the ability text" [R], and the engine keeps no text per ability. Checked against every definition in
// the pool: each ability finds a line, and the line's cost agrees with the definition's, so a wrong line can't pass.

import { cardDatabase } from "@mtg/cards";
import type { AbilityDef, CardData, TriggeredAbilityDef } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { abilityText, activatedLines, triggeredLines } from "../src/board-model/ability-text.ts";

const pool = Object.values(cardDatabase()) as CardData[];
const named = (name: string) => {
  const card = pool.find((c) => c.def.name === name);
  if (card === undefined) throw new Error(`no ${name}`);
  return card.def.oracle;
};

describe("an ability's own text", () => {
  it("finds a printed activated ability's line, cost and effect, without its reminder text", () => {
    expect(abilityText(named("Prodigal Pyromancer"), { kind: "printed", index: 0 })).toBe(
      "{T}: This creature deals 1 damage to any target.",
    );
    expect(abilityText(named("Drudge Skeletons"), { kind: "printed", index: 0 })).toBe(
      "{B}: Regenerate this creature.",
    );
    expect(abilityText(named("Gargoyle Castle"), { kind: "printed", index: 1 })).toBe(
      "{5}, {T}, Sacrifice this land: Create a 3/4 colorless Gargoyle artifact creature token with flying.",
    );
  });

  it("finds a planeswalker's loyalty abilities in order (CR 606)", () => {
    expect(abilityText(named("Jace Beleren"), { kind: "printed", index: 1 })).toBe("−1: Target player draws a card.");
  });

  it("finds equip (CR 702.6a)", () => {
    expect(abilityText(named("Gorgon Flail"), { kind: "printed", index: 0 })).toBe("Equip {2}");
  });

  it("finds a triggered ability's line (CR 603.1)", () => {
    expect(abilityText(named("Soul Warden"), { kind: "triggered", index: 0 })).toBe(
      "Whenever another creature enters, you gain 1 life.",
    );
    expect(abilityText(named("Magma Phoenix"), { kind: "triggered", index: 0 })).toBe(
      "When this creature dies, it deals 3 damage to each creature and each player.",
    );
    expect(abilityText(named("Magma Phoenix"), { kind: "printed", index: 0 })).toBe(
      "{3}{R}{R}: Return this card from your graveyard to your hand.",
    );
  });

  it("gives no line for an ability no line is: a delayed trigger, a land's own mana ability", () => {
    const whelp = named("Dragon Whelp");
    const delayed: TriggeredAbilityDef = {
      when: { kind: "beginningOfStep", step: "end", whose: "each" },
      targets: [],
      effects: [],
    };
    expect(abilityText(whelp, { kind: "delayed", ability: delayed })).toBeNull();
    expect(abilityText(named("Forest"), { kind: "basicLandType", landType: "Forest" })).toBeNull();
  });

  it("finds exactly one line per ability in the pool, and each line's cost is its definition's", () => {
    for (const { def } of pool) {
      // As many lines as abilities: a line the parser missed (an ability word, an unknown keyword) or took wrongly fails.
      expect(activatedLines(def.oracle), def.name).toHaveLength(def.abilities?.length ?? 0);
      expect(triggeredLines(def.oracle), def.name).toHaveLength(def.triggers?.length ?? 0);
      (def.abilities ?? []).forEach((ability, index) => {
        const line = abilityText(def.oracle, { kind: "printed", index }) ?? "";
        expect(costText(line), `${def.name}: "${line}"`).toBe(expectedCost(ability));
      });
    }
  });
});

/**
 * The cost as written on the line, normalised: mana symbols, {T}, a loyalty amount, sacrifice and remove-counter parts,
 * so two abilities of one card with costs of the same shape but different amounts can't be swapped unnoticed.
 */
function costText(line: string): string {
  if (line.startsWith("Equip")) return `equip ${line.slice("Equip ".length)}`;
  const cost = line.slice(0, line.indexOf(":"));
  const loyalty = /^([+−-]?)(\d+|X)$/.exec(cost);
  if (loyalty !== null) return `loyalty ${loyalty[1] === "+" || loyalty[1] === "" ? "" : "-"}${loyalty[2]}`;
  return cost
    .split(", ")
    .map((part) => (/^Sacrifice/.test(part) ? "sacrifice" : /^Remove/.test(part) ? "remove" : part))
    .join(" ");
}

/** The same, from the definition. */
function expectedCost(ability: AbilityDef): string {
  const mana = (cost: { kind: string; amount?: number; color?: string }[]) =>
    cost.map((m) => (m.kind === "generic" ? `{${m.amount}}` : m.kind === "x" ? "{X}" : `{${m.color}}`)).join("");
  if (ability.keyword === "equip") {
    const part = ability.cost.find((c) => c.kind === "mana");
    return `equip ${part?.kind === "mana" ? mana(part.cost) : ""}`;
  }
  const loyalty = ability.cost.find((c) => c.kind === "loyalty");
  if (loyalty?.kind === "loyalty") return `loyalty ${loyalty.amount === "minusX" ? "-X" : loyalty.amount}`;
  return ability.cost
    .map((c) => {
      switch (c.kind) {
        case "mana":
          return mana(c.cost);
        case "tap":
          return "{T}";
        case "sacrifice":
        case "sacrificeSelf":
          return "sacrifice";
        case "removeCounters":
          return "remove";
        default:
          return c.kind;
      }
    })
    .join(" ");
}
