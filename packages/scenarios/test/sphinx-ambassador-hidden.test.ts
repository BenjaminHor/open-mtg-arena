// Sphinx Ambassador: the player naming a card mustn't see which card was searched for (its ruling: it's never shown to
// them). At p2's `chooseName`, p2's view holds nothing of the found card.

import { readFileSync } from "node:fs";
import { cardDatabase } from "@mtg/cards";
import { type GameState, playerView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { runScenario } from "../src/index.ts";

const cards = cardDatabase();
const crawWurm = Object.values(cards).find((c) => c.printed.name === "Craw Wurm")?.oracleId;

describe("Sphinx Ambassador's search, seen by the player naming", () => {
  it("shows them nothing of the card found", () => {
    const yaml = readFileSync(
      new URL("../../engine/test/scenarios/cards/m2-14e/sphinx-ambassador.yaml", import.meta.url),
      "utf8",
    );
    const asked: GameState[] = [];
    const result = runScenario(yaml, cards, (state) => {
      if (state.pending?.kind === "chooseName") asked.push(state);
      return [];
    });
    expect(result.problems).toStrictEqual([]);
    const [state] = asked;
    if (state === undefined || crawWurm === undefined) throw new Error("p2 was never asked to name a card");
    expect(state.resolution?.found).toHaveLength(1);
    // The found card is p2's own, still in p2's library, which p2 can't see (CR 401.2).
    expect(JSON.stringify(playerView(state, "p2"))).not.toContain(crawWurm);
    // p1 looked at it while searching (CR 701.23a), and still sees nothing more than any library card.
    expect(JSON.stringify(playerView(state, "p1"))).not.toContain(crawWurm);
  });
});
