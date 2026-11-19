import { describe, expect, it } from "vitest";
import { matchPoolCards } from "../scripts/match.ts";
import type { ScryfallCard } from "../scripts/scryfall.ts";

function card(name: string, layout = "normal", set = "tst"): ScryfallCard {
  return {
    name,
    oracle_id: `${name}-${layout}-${set}`,
    layout,
    cmc: 0,
    type_line: "Creature — Elf",
    keywords: [],
    set,
    collector_number: "1",
    scryfall_uri: "https://scryfall.com/",
  };
}

describe("matchPoolCards", () => {
  it("ignores a token that shares a card's name", () => {
    const elves = card("Llanowar Elves");
    expect(matchPoolCards(["Llanowar Elves"], [card("Llanowar Elves", "token"), elves])).toStrictEqual([elves]);
  });

  it("returns the cards in the order of the names", () => {
    const a = card("Alpha");
    const b = card("Beta");
    expect(matchPoolCards(["Beta", "Alpha"], [a, b])).toStrictEqual([b, a]);
  });

  it("fails on a missing name and on a name with two matches, listing both", () => {
    expect(() =>
      matchPoolCards(["Missing", "Twice"], [card("Twice", "normal", "a"), card("Twice", "saga", "b")]),
    ).toThrow(/"Missing": 0 matches[\s\S]*"Twice": 2 matches/);
  });
});
