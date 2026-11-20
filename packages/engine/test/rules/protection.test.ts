// Protection's damage prevention reads the source as it last existed when it's gone (CR 702.16e, 113.7a): no pool card
// has a black source deal damage after leaving, so a test-only creature with protection from black takes damage from
// Sac Pump (black) after it has left the battlefield.

import { describe, expect, it } from "vitest";
import type { ObjectId } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import { FOREST, PRO_BLACK, SAC_PUMP, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

describe("protection from a source that left (CR 702.16e)", () => {
  it("prevents damage from a source that was black as it last existed", () => {
    const started = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: [FOREST], battlefield: [permanent(PRO_BLACK)] }),
        playerSetup("p2", { library: [FOREST], battlefield: [permanent(SAC_PUMP)] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p2", step: "precombatMain" } },
      ruleModifiers: [],
    }).state;
    const [protectedOne, source] = started.zones.battlefield as [ObjectId, ObjectId];
    const gone = happen(started, { kind: "moveCard", object: source, to: { zone: "graveyard" } }, TEST_CARDS).state;
    expect(gone.objects[source]).toBeUndefined();
    const damage = [{ source, to: { kind: "object", object: protectedOne }, amount: 2, combat: false }] as const;
    const dealt = happen(gone, { kind: "dealDamage", damage: [...damage] }, TEST_CARDS);
    expect(dealt.state.objects[protectedOne]).toMatchObject({ damage: 0 });
    expect(dealt.events).toContainEqual(expect.objectContaining({ type: "DAMAGE_PREVENTED", amount: 2 }));
  });
});
