// A target that gains shroud after a spell is cast is illegal as the spell resolves (CR 702.18a, 608.2b). No effect
// grants shroud yet, so the creature's card is swapped in the state for a test creature with it.

import { describe, expect, it } from "vitest";
import type { ObjectId } from "../../src/index.ts";
import { BEARS, FOREST, MOUNTAIN, SHOCK, SHROUDED } from "../support/cards.ts";
import { type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

describe("shroud on resolution (CR 702.18a, 608.2b)", () => {
  it("a target that gained shroud is illegal, so the spell doesn't resolve", () => {
    let game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: [FOREST, FOREST], hand: [SHOCK], battlefield: [permanent(MOUNTAIN)] }),
        playerSetup("p2", { library: [FOREST, FOREST], battlefield: [permanent(BEARS)] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const bears = game.state.zones.battlefield[1] as ObjectId;
    game = take(game, (a) => a.type === "CAST_SPELL");
    game = take(
      game,
      (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget" && a.answer.target.kind === "object",
    );
    game = take(game, (a) => a.type === "ACTIVATE_ABILITY");
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "payMana");
    expect(game.state.zones.stack).toHaveLength(1);
    const obj = game.state.objects[bears];
    if (obj?.kind !== "card") throw new Error("no bears");
    const shrouded: Game = {
      ...game,
      state: { ...game.state, objects: { ...game.state.objects, [bears]: { ...obj, oracleId: SHROUDED } } },
    };
    const after = passBoth(shrouded);
    expect(after.events.some((e) => e.type === "SPELL_DID_NOT_RESOLVE")).toBe(true);
    expect(after.state.objects[bears]).toMatchObject({ damage: 0 });
  });
});
