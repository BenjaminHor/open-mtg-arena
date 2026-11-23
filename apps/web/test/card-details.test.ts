// The card view's contents (M3-04c; arena-research.md, "The Examined view"): the card's own text and image, and the
// hangers beside it for what the face doesn't say. Built from boards the test writes, through the worker's session.

import type { ObjectId, OracleId, SeatView } from "@mtg/engine";
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
  it("shows the card's own text and image", () => {
    const angel = cardDetails(board, idOf(board, "Serra Angel"));
    expect(angel?.name).toBe("Serra Angel");
    expect(angel?.typeLine).toContain("Angel");
    expect(angel?.oracleText).toContain("Flying");
    expect(angel?.image).not.toBeNull();
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

  it("shows an ability on the stack named for the card it came from", () => {
    const crowded = fixtureView("crowded");
    const top = crowded.view.zones.stack.at(-1);
    if (top === undefined) throw new Error("the crowded fixture has an ability on the stack");
    const ability = crowded.seen[top];
    expect(ability?.kind).toBe("ability");
    expect(cardDetails(crowded, top)?.name).toBe("Ajani Goldmane");
  });

  it("words summoning sickness as CR 302.6 does, so it's also true on the opponent's turn", () => {
    // Sick from when it comes under its controller's control until their next turn begins, the opponent's turn
    // between included: "this turn" would be wrong then.
    const hangers = cardDetails(board, idOf(board, "Llanowar Elves"))?.hangers ?? [];
    expect(hangers.find((h) => h.title === "Summoning sick")?.text).toMatch(/since their turn began/);
  });

  it("names what a creature has protection from", () => {
    const knight = boardView({
      turn: { number: 4, activePlayer: "p1", step: "precombatMain" },
      players: {
        p1: { life: 20, hand: [], battlefield: ["White Knight"], library: LIBRARY },
        p2: { life: 20, hand: [], battlefield: [], library: LIBRARY },
      },
    });
    expect(cardDetails(knight, idOf(knight, "White Knight"))?.hangers.map((h) => h.title)).toContain(
      "Protection from black",
    );
  });

  // Situations the fixtures can't set up directly (a token, a stolen creature, a source that left): the seat view
  // edited to what the engine would show then.
  it("shows a token by its characteristics: a type line with its subtypes, no image", () => {
    const shown = structuredClone(board);
    const id = idOf(shown, "Elite Vanguard");
    const seen = shown.seen[id];
    if (seen?.kind !== "card") throw new Error("a card");
    seen.token = true;
    seen.oracleId = "token-soldier" as OracleId;
    const token = cardDetails(shown, id);
    expect(token?.image).toBeNull();
    expect(token?.typeLine).toBe("Creature — Human Soldier");
    expect(token?.hangers.map((h) => h.title)).toContain("Token");
    // No printed numbers to compare with.
    expect(token?.hangers.map((h) => h.title)).not.toContain("Power/toughness");
  });

  it("says who controls a creature and who owns it, when they differ", () => {
    const shown = structuredClone(board);
    const id = idOf(shown, "Elite Vanguard");
    const seen = shown.seen[id];
    if (seen?.kind !== "card") throw new Error("a card");
    seen.characteristics = { ...seen.characteristics, controller: "p1" };
    expect(cardDetails(shown, id)?.hangers).toContainEqual({
      title: "Control",
      text: "You control it; your opponent owns it.",
    });
  });

  it("shows an ability whose source has left as its own panel, saying the source has left", () => {
    const crowded = structuredClone(fixtureView("crowded"));
    const top = crowded.view.zones.stack.at(-1);
    const ability = top === undefined ? undefined : crowded.seen[top];
    if (top === undefined || ability?.kind !== "ability") throw new Error("an ability on the stack");
    delete crowded.seen[ability.source];
    const shown = cardDetails(crowded, top);
    expect(shown?.name).toBe("Ajani Goldmane");
    expect(shown?.typeLine).toBe("Activated ability");
    expect(shown?.hangers).toEqual([{ title: "From", text: "Its source has left" }]);
  });
});
