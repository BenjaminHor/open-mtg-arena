// A permanent's badges (M3-04c; arena-research.md, "How permanents are drawn"): keyword icons, counters, loyalty and
// summoning sickness, decided in the board model from the seat view, drawn by the renderer.

import type { SeatView, SeenCard } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { badgesOf, NO_BADGES } from "../src/board-model/badges.ts";
import { boardModel } from "../src/board-model/board-model.ts";
import { pileKey } from "../src/board-model/piles.ts";
import { boardView, fixtureView } from "./fixture-views.ts";

const LIBRARY = Array.from({ length: 10 }, () => "Plains");

const board = boardView({
  turn: { number: 4, activePlayer: "p1", step: "precombatMain" },
  players: {
    p1: {
      life: 20,
      hand: [],
      battlefield: [
        "Serra Angel",
        "Baneslayer Angel",
        "White Knight",
        { card: "Llanowar Elves", sick: true },
        { card: "Garruk Wildspeaker", counters: { loyalty: 3 } },
        { card: "Grizzly Bears", counters: { "+1/+1": 2 } },
        "Ornithopter",
      ],
      library: LIBRARY,
    },
    p2: { life: 20, hand: [], battlefield: [{ card: "Elite Vanguard", sick: true }], library: LIBRARY },
  },
});

function card(shown: SeatView, name: string): SeenCard {
  const found = Object.values(shown.seen).find((o) => o.kind === "card" && o.characteristics.name === name);
  if (found?.kind !== "card") throw new Error(`no ${name}`);
  return found;
}

const of = (name: string) => badgesOf(card(board, name));

describe("badgesOf", () => {
  it("shows a creature's keywords as icons, most telling first", () => {
    expect(of("Serra Angel")).toMatchObject({ icons: ["flying", "vigilance"], more: false });
  });

  it("shows protection as an icon of its own", () => {
    expect(of("White Knight").icons).toEqual(["first strike", "protection"]);
  });

  it("shows one icon and an ellipsis when there are more than two (the card view lists them all)", () => {
    // Baneslayer Angel: flying, first strike, lifelink, protection from Demons and from Dragons.
    expect(of("Baneslayer Angel")).toMatchObject({ icons: ["flying"], more: true });
  });

  it("gives a creature with no keywords no icons", () => {
    expect(of("Grizzly Bears")).toMatchObject({ icons: [], more: false });
  });

  it("counts +1/+1 counters, and keeps a planeswalker's loyalty apart from its counters (CR 306.5c)", () => {
    expect(of("Grizzly Bears").counter).toBe("+2");
    expect(of("Garruk Wildspeaker")).toMatchObject({ loyalty: 3, counter: null });
    expect(of("Grizzly Bears").loyalty).toBeNull();
  });

  it("marks summoning sickness until its controller's next turn begins, the other player's turn included (CR 302.6)", () => {
    expect(of("Llanowar Elves").sick).toBe(true);
    expect(of("Ornithopter").sick).toBe(false);
    // The opponent's new creature, on the person's turn: it can't use {T} abilities until its controller's turn.
    expect(of("Elite Vanguard").sick).toBe(true);
  });

  it("puts each permanent's badges on its board card, and none on a hand card", () => {
    const model = boardModel(fixtureView("badges"), { width: 812, height: 375 });
    const on = (name: string) => model.cards.find((c) => c.name === name && c.zone === "battlefield")?.badges;
    expect(on("Grizzly Bears")?.counter).toBe("+2");
    expect(on("Garruk Wildspeaker")?.loyalty).toBe(3);
    expect(on("Llanowar Elves")?.sick).toBe(true);
    expect(on("Elite Vanguard")?.sick).toBe(true);
    // A hand card with keywords (Serra Angel: flying, vigilance) wears none: badges are for permanents.
    expect(model.cards.find((c) => c.zone === "hand" && c.name === "Serra Angel")?.badges).toBe(NO_BADGES);
    // Dimmed while sick, as Arena shows it (the owner); the opponent's new creature isn't, on the person's turn.
    const dim = (name: string) => model.cards.find((c) => c.name === name && c.zone === "battlefield")?.dim;
    expect(dim("Llanowar Elves")).toBeGreaterThan(0);
    expect(dim("Grizzly Bears")).toBe(0);
    // The opponent's sick creature, on the person's turn: "zz" (its {T} abilities wait) but not dimmed (it can block).
    expect(dim("Elite Vanguard")).toBe(0);
  });

  it("doesn't pile a permanent with a twin that has a protection it lacks (its badges would differ)", () => {
    const knight = card(board, "White Knight");
    const bare = { ...knight, characteristics: { ...knight.characteristics, protections: [] } };
    expect(pileKey(knight, new Set())).not.toBe(pileKey(bare, new Set()));
    expect(pileKey(knight, new Set())).toBe(pileKey({ ...knight }, new Set()));
  });
});
