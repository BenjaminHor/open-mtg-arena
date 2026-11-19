// A game between prebuilt decks (`new --decks`, `auto`, the fuzzer, golden games).

import { DECKS, type DeckList, deckLibrary } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { deckGameSetup } from "../src/deck-setup.ts";

describe("deckGameSetup", () => {
  const decks = [DECKS["red-aggro"], DECKS["green-stompy"]] as DeckList[];

  it("starts each player at 20 life with their deck as their library and nothing else (CR 103.4, 401.1)", () => {
    const setup = deckGameSetup(decks, 7, null);
    expect(setup.players.map((p) => [p.id, p.life])).toEqual([
      ["p1", 20],
      ["p2", 20],
    ]);
    expect(setup.players.map((p) => p.library)).toEqual(decks.map((d) => deckLibrary(d)));
    expect(setup.players.every((p) => p.hand.length === 0 && p.battlefield.length === 0)).toBe(true);
  });

  it("starts a standard game, where the random chooser decides who goes first unless one is named (CR 103.1)", () => {
    expect(deckGameSetup(decks, 7, null).opening).toEqual({ kind: "standard", firstPlayer: null });
    expect(deckGameSetup(decks, 7, "p2").opening).toEqual({ kind: "standard", firstPlayer: "p2" });
  });
});
