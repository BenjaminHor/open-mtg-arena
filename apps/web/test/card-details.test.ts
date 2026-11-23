// The card view's contents (M3-04c; arena-research.md, "The Examined view"): the card's own text and image, and the
// hangers beside it for what the face doesn't say. Built from boards the test writes, through the worker's session.

import type { ObjectId, SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { cardDetails } from "../src/interaction/card-details.ts";
import { boardView, fixtureView } from "./fixture-views.ts";

const LIBRARY = Array.from({ length: 10 }, () => "Plains");

const board = boardView({
  turn: { number: 4, activePlayer: "p1", step: "precombatMain" },
  players: {
    p1: {
      life: 20,
      hand: ["Lightning Bolt"],
      battlefield: [
        { card: "Serra Angel", damage: 2 },
        { card: "Holy Strength", attachedTo: 0 },
        { card: "Llanowar Elves", sick: true },
        { card: "Garruk Wildspeaker", counters: { loyalty: 3 } },
      ],
      library: LIBRARY,
    },
    p2: { life: 20, hand: ["Shock"], battlefield: ["Elite Vanguard"], library: LIBRARY },
  },
});

function idOf(shown: SeatView, name: string): ObjectId {
  const found = Object.values(shown.seen).find((o) => o.kind === "card" && o.characteristics.name === name);
  if (found === undefined) throw new Error(`no ${name} in view`);
  return found.id;
}

const titles = (id: ObjectId) => cardDetails(board, id)?.hangers.map((h) => h.title);

describe("cardDetails", () => {
  it("shows the card's own text, image and artist", () => {
    const angel = cardDetails(board, idOf(board, "Serra Angel"));
    expect(angel?.name).toBe("Serra Angel");
    expect(angel?.typeLine).toContain("Angel");
    expect(angel?.oracleText).toContain("Flying");
    expect(angel?.image).not.toBeNull();
    expect(angel?.artist).not.toBeNull();
  });

  it("explains each keyword in a hanger of its own", () => {
    const hangers = cardDetails(board, idOf(board, "Serra Angel"))?.hangers ?? [];
    expect(hangers.find((h) => h.title === "Flying")?.text).toMatch(/flying or reach/);
    expect(hangers.find((h) => h.title === "Vigilance")?.text).toMatch(/doesn't cause it to tap/);
  });

  it("shows damage, what's attached, and power/toughness changed from the printed card", () => {
    const hangers = cardDetails(board, idOf(board, "Serra Angel"))?.hangers ?? [];
    expect(hangers).toContainEqual({ title: "Damage", text: "2 damage marked this turn" });
    expect(hangers).toContainEqual({ title: "Attached", text: "Holy Strength" });
    // Holy Strength gives +1/+2 (computed by the layers, CR 613), so 5/6 against the printed 4/4.
    expect(hangers).toContainEqual({ title: "Power/toughness", text: "5/6 now (printed 4/4)" });
    expect(cardDetails(board, idOf(board, "Serra Angel"))?.powerToughness).toBe("5/6");
  });

  it("names the host of an Aura", () => {
    const hangers = cardDetails(board, idOf(board, "Holy Strength"))?.hangers ?? [];
    expect(hangers).toContainEqual({ title: "Attached to", text: "Serra Angel" });
  });

  it("marks a creature that came under its controller's control this turn", () => {
    expect(titles(idOf(board, "Llanowar Elves"))).toContain("Summoning sick");
    expect(titles(idOf(board, "Elite Vanguard"))).not.toContain("Summoning sick");
  });

  it("counts counters", () => {
    const hangers = cardDetails(board, idOf(board, "Garruk Wildspeaker"))?.hangers ?? [];
    expect(hangers).toContainEqual({ title: "Counters", text: "3 loyalty counters" });
  });

  it("shows a card in hand without battlefield hangers, and nothing for an object not in the view", () => {
    expect(cardDetails(board, idOf(board, "Lightning Bolt"))?.hangers).toEqual([]);
    // The opponent's hand isn't in the person's view (CR 402.3; D-062): no id there to look at.
    expect(cardDetails(board, "o-unseen" as ObjectId)).toBeNull();
  });

  it("shows an ability on the stack as the card it came from", () => {
    const crowded = fixtureView("crowded");
    const top = crowded.view.zones.stack.at(-1);
    if (top === undefined) throw new Error("the crowded fixture has an ability on the stack");
    const ability = crowded.seen[top];
    expect(ability?.kind).toBe("ability");
    expect(cardDetails(crowded, top)?.name).toBe("Ajani Goldmane");
  });
});
