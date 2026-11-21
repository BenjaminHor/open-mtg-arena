// Tokens (CR 111): their data, creating one, and one ceasing to exist, below the scenarios (cards/m2-11), which play
// them through real cards.

import { describe, expect, it } from "vitest";
import { tokenData } from "../../src/cards/token-data.ts";
import type { TargetSpec, TokenDef } from "../../src/cards/types.ts";
import { checkStateBasedActions } from "../../src/game/state-based-actions.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { characteristics } from "../../src/rules/characteristics.ts";
import { controllerOf } from "../../src/rules/controller.ts";
import { stateBasedActions } from "../../src/rules/state-based-actions.ts";
import { legalTargets } from "../../src/rules/targets.ts";
import { ceaseToExist, createToken } from "../../src/zones/create-token.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { BEARS, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const INSECT: TokenDef = { colors: ["G"], types: ["creature"], subtypes: ["Insect"], power: 1, toughness: 1 };

function board(): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest"], graveyard: [BEARS] }),
      playerSetup("p2", { library: ["forest"] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

/** The board with an Insect token p2 created. */
function withToken(token: TokenDef = INSECT): { state: GameState; id: ObjectId } {
  const created = createToken(board(), tokenData(token), "p2");
  const event = created.events[0];
  if (event?.type !== "TOKEN_CREATED") throw new Error("no token created");
  return { state: created.state, id: event.object };
}

describe("a token's characteristics are what the effect defines (CR 111.3, 111.4)", () => {
  it("is named for its subtypes plus Token, unless the effect names it (CR 111.4)", () => {
    expect(tokenData(INSECT).printed.name).toBe("Insect Token");
    expect(tokenData({ ...INSECT, subtypes: ["Dwarf", "Berserker"] }).printed.name).toBe("Dwarf Berserker Token");
    expect(tokenData({ ...INSECT, name: "Boo" }).printed.name).toBe("Boo");
  });

  it("has no mana cost or supertypes the effect doesn't give it (CR 111.3)", () => {
    const { printed } = tokenData(INSECT);
    expect(printed.manaCost).toBeNull();
    expect(printed.supertypes).toStrictEqual([]);
  });

  it("is a permanent with those characteristics, owned and controlled by its creator (CR 111.2)", () => {
    const { state, id } = withToken();
    expect(state.zones.battlefield).toContain(id);
    const c = characteristics(state, id, TEST_CARDS);
    expect([c.name, c.colors, c.types, c.subtypes, c.power, c.toughness]).toStrictEqual([
      "Insect Token",
      ["G"],
      ["creature"],
      ["Insect"],
      1,
      1,
    ]);
    expect(state.objects[id]?.kind === "card" && state.objects[id].owner).toBe("p2");
    expect(controllerOf(state, id)).toBe("p2");
  });

  it("keeps them through a JSON round trip, as plain data", () => {
    const { state, id } = withToken();
    const copy = JSON.parse(JSON.stringify(state)) as GameState;
    expect(characteristics(copy, id, TEST_CARDS)).toStrictEqual(characteristics(state, id, TEST_CARDS));
  });
});

describe("a token outside the battlefield ceases to exist (CR 111.7, 704.5d)", () => {
  it("is still a token after it moves, and the next check makes it cease to exist", () => {
    const { state, id } = withToken();
    const moved = moveCard(state, id, { zone: "graveyard" });
    const there = moved.state.objects[moved.newId];
    expect(there?.kind === "card" && there.token?.printed.name).toBe("Insect Token");
    expect(moved.state.zones.players.p2?.graveyard).toStrictEqual([moved.newId]);
    expect(stateBasedActions(moved.state, TEST_CARDS)).toStrictEqual([
      { kind: "tokenOutsideBattlefield", object: moved.newId },
    ]);
    const checked = checkStateBasedActions(moved.state, TEST_CARDS);
    expect(checked.state.objects[moved.newId]).toBeUndefined();
    expect(checked.state.zones.players.p2?.graveyard).toStrictEqual([]);
    expect(checked.events.map((e) => e.type)).toContain("TOKEN_CEASED_TO_EXIST");
  });

  it("isn't listed on the battlefield, nor is a card anywhere", () => {
    expect(stateBasedActions(withToken().state, TEST_CARDS)).toStrictEqual([]);
  });

  it("can only cease to exist if it's a token", () => {
    const state = board();
    const card = state.zones.players.p1?.graveyard[0] as ObjectId;
    expect(() => ceaseToExist(state, card)).toThrow(/isn't a token/);
  });
});

describe("a token isn't a card (CR 111.6)", () => {
  it("isn't a creature card in a graveyard to target, in the moment before it ceases to exist", () => {
    const { state, id } = withToken();
    const moved = moveCard(state, id, { zone: "graveyard" });
    const spec: TargetSpec = { kind: "cardInGraveyard", graveyard: "any", filter: { types: ["creature"] } };
    const by = { object: "o999" as ObjectId, controller: "p1" as const };
    const found = legalTargets(moved.state, spec, by, TEST_CARDS).map((t) => (t.kind === "object" ? t.object : null));
    expect(found).toStrictEqual([moved.state.zones.players.p1?.graveyard[0]]);
  });
});
