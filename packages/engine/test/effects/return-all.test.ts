// Auras put onto the battlefield under someone other than their owner (CR 303.4f, 110.2): the player who'll control
// one chooses what it enchants, among what it could enchant under that player. No pool card returns an Aura under its
// caster's control (Liliana Vess returns only creature cards), so a test sorcery does.

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId, PermanentSetup } from "../../src/index.ts";
import { BEARS, TAKE_ENCHANTMENTS, TEST_AURA, YOUR_AURA } from "../support/cards.ts";
import { answer, type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string): PermanentSetup => ({
  oracleId,
  tapped: false,
  summoningSick: false,
  damage: 0,
  counters: {},
});

/** p1 holds Take Enchantments; each player has Grizzly Bears; p2's graveyard has the Aura. */
function cast(aura: string): Game {
  const game = start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest"], hand: [TAKE_ENCHANTMENTS], battlefield: [permanent(BEARS)] }),
      playerSetup("p2", { library: ["forest"], graveyard: [aura], battlefield: [permanent(BEARS)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
  const cast = take(game, (a) => a.type === "CAST_SPELL");
  return passBoth(cast);
}

const attachedTo = (state: GameState, oracleId: string) => {
  const aura = Object.values(state.objects).find(
    (o) => o.kind === "card" && o.oracleId === oracleId && state.zones.battlefield.includes(o.id),
  );
  return aura?.kind === "card" ? aura.attachedTo : undefined;
};

describe("an Aura put onto the battlefield under another player's control (CR 303.4f, 110.2)", () => {
  it("is put under the effect's controller, who chooses what it enchants, and is named as the chooser", () => {
    let game = cast(TEST_AURA);
    const [mine, theirs] = game.state.zones.battlefield as [ObjectId, ObjectId];
    // p2 owns it, but p1 will control it, so p1 chooses (CR 303.4f).
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "chooseCards", purpose: "enchant" });
    game = answer(game, { kind: "chooseCard", option: 1 });
    expect(attachedTo(game.state, TEST_AURA)).toBe(theirs);
    expect(game.events).toContainEqual(
      expect.objectContaining({ type: "AURA_HOST_CHOSEN", player: "p1", host: theirs }),
    );
    expect(game.state.zones.battlefield).toContain(mine);
  });

  it("is judged for the player who'll control it: 'enchant creature you control' can only take p1's creature", () => {
    const game = cast(YOUR_AURA);
    const [mine] = game.state.zones.battlefield as [ObjectId];
    // Only one host under p1, so no question is asked; under p2 it would have been p2's Bears.
    expect(game.state.pending?.kind).toBe("priority");
    expect(attachedTo(game.state, YOUR_AURA)).toBe(mine);
  });
});
