// Each player's zones as the person may see them (M3-04c slice 5): the counts in their info block and the browser's
// tabs, from one module so the two can't disagree. Graveyards are public and keep their order (CR 404.2), exile is
// public (CR 406.3), a revealed hand (CR 701.20a) and a revealed library top (CR 401.5) are shown by identity only.

import { describe, expect, it } from "vitest";
import type { Fixture } from "../src/fixtures/fixtures.ts";
import { browserTabs, playerZones, zoneCards } from "../src/interaction/zones.ts";
import { boardView } from "./fixture-views.ts";

const board = (p1: Partial<Fixture["players"]["p1"]>, p2: Partial<Fixture["players"]["p2"]>): Fixture => ({
  turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
  players: {
    p1: { life: 20, hand: ["Forest"], battlefield: ["Forest"], library: ["Forest", "Forest"], ...p1 },
    p2: { life: 20, hand: ["Plains"], battlefield: ["Plains"], library: ["Plains", "Plains"], ...p2 },
  },
});

const names = (cards: readonly { name: string }[]) => cards.map((c) => c.name);

describe("graveyards and exile", () => {
  const shown = boardView(
    board(
      { graveyard: ["Grizzly Bears", "Lightning Bolt", "Giant Growth"], exile: ["Serra Angel", "Shock"] },
      { graveyard: ["Pacifism"], exile: ["Elite Vanguard"] },
    ),
  );

  it("lists a graveyard top first, in its order (CR 404.2)", () => {
    expect(names(zoneCards(shown, "p1", "graveyard"))).toEqual(["Giant Growth", "Lightning Bolt", "Grizzly Bears"]);
    expect(names(zoneCards(shown, "p2", "graveyard"))).toEqual(["Pacifism"]);
  });

  it("lists the exiled cards each player owns, newest first (CR 406.3)", () => {
    expect(names(zoneCards(shown, "p1", "exile"))).toEqual(["Shock", "Serra Angel"]);
    expect(names(zoneCards(shown, "p2", "exile"))).toEqual(["Elite Vanguard"]);
  });

  it("gives every card its object, so the card view can follow it, and a key of its own", () => {
    for (const card of zoneCards(shown, "p1", "graveyard")) expect(card.id).not.toBeNull();
    const keys = zoneCards(shown, "p1", "graveyard").map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts what the browser lists, and the library and hand by size (CR 401.3, 402.3)", () => {
    const zones = playerZones(shown, "p2");
    expect(zones).toMatchObject({
      library: 2,
      hand: 1,
      graveyard: 1,
      exile: 1,
      handRevealed: false,
      revealedTop: null,
    });
    expect(playerZones(shown, "p1")).toMatchObject({ graveyard: 3, exile: 2 });
  });

  it("offers the graveyard and exile as tabs, and nothing hidden", () => {
    expect(browserTabs(shown, "p2").map((t) => t.zone)).toEqual(["graveyard", "exile"]);
    expect(browserTabs(shown, "p2")[0]?.label).toBe("Graveyard 1");
  });
});

describe("revealed cards", () => {
  it("shows the opponent's hand while it's revealed (Telepathy, CR 701.20a), by identity only", () => {
    const shown = boardView(board({ battlefield: ["Telepathy"] }, { hand: ["Plains", "Shock", "Plains"] }));
    expect(playerZones(shown, "p2").handRevealed).toBe(true);
    const hand = zoneCards(shown, "p2", "hand");
    expect(names(hand).sort()).toEqual(["Plains", "Plains", "Shock"]);
    // No object ids: a revealed hand's ids would tell which card came when (D-062).
    for (const card of hand) expect(card.id).toBeNull();
    expect(new Set(hand.map((c) => c.key)).size).toBe(3);
    expect(browserTabs(shown, "p2").map((t) => t.zone)).toEqual(["graveyard", "exile", "hand"]);
  });

  it("keys a revealed card by identity and copy, so it keeps its key when a card before it leaves", () => {
    const before = boardView(board({ battlefield: ["Telepathy"] }, { hand: ["Plains", "Shock", "Pacifism"] }));
    const after = boardView(board({ battlefield: ["Telepathy"] }, { hand: ["Plains", "Shock"] }));
    const keyOf = (shown: typeof before, name: string) =>
      zoneCards(shown, "p2", "hand").find((c) => c.name === name)?.key;
    for (const name of ["Plains", "Shock"]) expect(keyOf(after, name)).toBe(keyOf(before, name));
  });

  it("marks the person's own revealed hand, without a tab: they hold it", () => {
    const shown = boardView(board({}, { battlefield: ["Telepathy"] }));
    expect(playerZones(shown, "p1").handRevealed).toBe(true);
    expect(browserTabs(shown, "p1").map((t) => t.zone)).toEqual(["graveyard", "exile"]);
  });

  it("shows a library's top card while it's revealed (Vampire Nocturnus, CR 401.5)", () => {
    const shown = boardView(board({}, { battlefield: ["Vampire Nocturnus"], library: ["Shock", "Plains"] }));
    expect(playerZones(shown, "p2").revealedTop?.name).toBe("Shock");
    expect(playerZones(shown, "p1").revealedTop).toBeNull();
    expect(names(zoneCards(shown, "p2", "library"))).toEqual(["Shock"]);
    expect(browserTabs(shown, "p2").find((t) => t.zone === "library")?.label).toBe("Library top");
  });

  it("has nothing to show of a hand or library that isn't revealed", () => {
    const shown = boardView(board({}, {}));
    expect(zoneCards(shown, "p2", "hand")).toEqual([]);
    expect(zoneCards(shown, "p2", "library")).toEqual([]);
  });
});
