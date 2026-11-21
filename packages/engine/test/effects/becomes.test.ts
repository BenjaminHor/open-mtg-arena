// What a permanent "is" as it enters (Rise from the Grave): what no pool card can show. It applies as it enters
// (CR 611.2e), so a trigger on entering sees it, and its timestamp comes after the object's (CR 613.7n).

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import { BEARS, FOREST, GROVE, TEST_CARDS, ZOMBIE_WATCHER } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function bearsInGraveyard(): { state: GameState; card: ObjectId } {
  const state = start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST], battlefield: [permanent(ZOMBIE_WATCHER)] }),
      playerSetup("p2", { library: [FOREST], graveyard: [BEARS] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  const card = state.zones.players.p2?.graveyard[0];
  if (card === undefined) throw new Error("no card in p2's graveyard");
  return { state, card };
}

const zombie = { addTypes: [], addSubtypes: ["Zombie"], colors: { add: ["B" as const] } };

describe("a permanent entering as something (CR 611.2e)", () => {
  it("is that as it enters, so 'whenever a Zombie enters' triggers; without it, nothing does", () => {
    const { state, card } = bearsInGraveyard();
    const as = { source: card, controller: "p1" as const, change: zombie };
    const risen = happen(
      state,
      { kind: "moveCard", object: card, to: { zone: "battlefield", controller: "p1", is: as } },
      TEST_CARDS,
    );
    expect(risen.state.pendingTriggers).toHaveLength(1);
    const plain = happen(
      state,
      { kind: "moveCard", object: card, to: { zone: "battlefield", controller: "p1" } },
      TEST_CARDS,
    );
    expect(plain.state.pendingTriggers).toHaveLength(0);
  });

  it("gets the effect's timestamp after the object's own (CR 613.7n), for the rest of the game (CR 611.2a)", () => {
    const { state, card } = bearsInGraveyard();
    const as = { source: card, controller: "p1" as const, change: zombie };
    const risen = happen(
      state,
      { kind: "moveCard", object: card, to: { zone: "battlefield", controller: "p1", is: as } },
      TEST_CARDS,
    );
    const entered = risen.state.zones.battlefield.at(-1);
    const obj = entered === undefined ? undefined : risen.state.objects[entered];
    const effect = risen.state.effects[0];
    expect(effect?.affected).toStrictEqual([entered]);
    expect(effect?.duration).toBe("endOfGame");
    expect(obj?.kind === "card" && effect !== undefined && effect.timestamp > obj.timestamp).toBe(true);
    expect(risen.events.map((e) => e.type)).toContain("EFFECT_CREATED");
  });

  it("keeps it through an 'enters tapped' replacement, which changes only how it enters", () => {
    const { state, card } = bearsInGraveyard();
    const as = { source: card, controller: "p1" as const, change: zombie };
    const grove = { ...state.objects[card], oracleId: GROVE } as GameState["objects"][ObjectId];
    const withGrove: GameState = { ...state, objects: { ...state.objects, [card]: grove } };
    const entered = happen(
      withGrove,
      { kind: "moveCard", object: card, to: { zone: "battlefield", controller: "p1", is: as } },
      TEST_CARDS,
    );
    const id = entered.state.zones.battlefield.at(-1);
    const obj = id === undefined ? undefined : entered.state.objects[id];
    expect(obj?.kind === "card" && obj.tapped).toBe(true);
    expect(entered.state.effects[0]?.affected).toStrictEqual([id]);
  });
});
