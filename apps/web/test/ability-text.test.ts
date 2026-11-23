// An ability's own text, picked from its source's Oracle text (M3-04c slice 6): Arena draws an ability on the stack as
// a panel with "the ability text" [R], and the engine keeps no text per ability. Checked against every definition in
// the pool: each ability finds a line, and the line's cost agrees with the definition's, so a wrong line can't pass.

import { cardDatabase } from "@mtg/cards";
import type { AbilityDef, CardData, TriggeredAbilityDef } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { abilityText } from "../src/board-model/ability-text.ts";

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

  it("finds a line for every ability in the pool, and its cost agrees with the definition", () => {
    for (const { def } of pool) {
      (def.abilities ?? []).forEach((ability, index) => {
        const line = abilityText(def.oracle, { kind: "printed", index });
        expect(line, `${def.name} ability ${index}`).not.toBeNull();
        expect(costAgrees(line ?? "", ability), `${def.name}: "${line}"`).toBe(true);
      });
      (def.triggers ?? []).forEach((_, index) => {
        const line = abilityText(def.oracle, { kind: "triggered", index });
        expect(line, `${def.name} trigger ${index}`).toMatch(/^(When|Whenever|At)\b/);
      });
    }
  });
});

/** The line's cost says what the definition's does: equip, loyalty, {T}, a sacrifice, a counter removed. */
function costAgrees(line: string, ability: AbilityDef): boolean {
  if (ability.keyword === "equip") return line.startsWith("Equip");
  const cost = line.slice(0, line.indexOf(":"));
  const has = (kind: string) => ability.cost.some((c) => c.kind === kind);
  return (
    /^[+−-]?\d|^[+−-]X/.test(cost) === has("loyalty") &&
    cost.includes("{T}") === has("tap") &&
    /Sacrifice/.test(cost) === (has("sacrifice") || has("sacrificeSelf")) &&
    /Remove/.test(cost) === has("removeCounters")
  );
}
