// An ability that works from a graveyard (CR 113.6m) in scenarios: `activate: graveyard:p1:<card>` names the card, and
// the exporter writes it back that way.

import { cardDatabase } from "@mtg/cards";
import { createGame, legalActions } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { scenarioFromGame } from "../src/export.ts";
import { runScenario } from "../src/index.ts";
import { buildSetup } from "../src/setup.ts";

const cards = cardDatabase();

describe("activating from a graveyard in scenarios (CR 113.6m)", () => {
  it("is exported as `graveyard:p1:Magma Phoenix`, which the runner replays", () => {
    const setup = buildSetup(
      {
        turn: { active: "p1", step: "main1" },
        p1: { battlefield: ["Mountain", "Mountain", "Mountain", "Mountain", "Mountain"], graveyard: ["Magma Phoenix"] },
      },
      cards,
    );
    const created = createGame(setup, cards);
    if (!created.ok) throw new Error(created.error.message);
    const graveyard = created.state.zones.players.p1?.graveyard ?? [];
    const activate = legalActions(created.state, "p1", cards).find(
      (a) => a.type === "ACTIVATE_ABILITY" && graveyard.includes(a.object),
    );
    if (activate === undefined) throw new Error("the Phoenix's ability isn't offered");
    const yaml = scenarioFromGame("graveyard ability", ["CR 113.6m"], setup, [activate], cards);
    expect(yaml).toMatch(/p1 activate: graveyard:p1:Magma Phoenix/);
    expect(runScenario(yaml, cards).problems).toStrictEqual([]);
  });
});
