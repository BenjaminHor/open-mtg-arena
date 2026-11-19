// When a moved card gets a new card id (D-054): only when it comes out of a hand or a library into a public zone, so
// no one can follow it through a zone they can't see (CR 400.2, 401.2, 402.3). Its object id is always new (CR 400.7).

import { describe, expect, it } from "vitest";
import type { GameEvent, GameState, ObjectId } from "../../src/index.ts";
import { type Destination, moveCard } from "../../src/zones/move-card.ts";
import { type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

const permanent = { oracleId: "grizzly-bears", tapped: false, summoningSick: false, damage: 0, counters: {} };

/** p1 has a card in each of their zones and in exile, and a permanent. */
function board(): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest", "forest"],
        hand: ["shock"],
        graveyard: ["mountain"],
        exile: ["forest"],
        battlefield: [permanent],
      }),
      playerSetup("p2", { library: ["forest"] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

const cardIn = {
  library: (s: GameState) => s.zones.players.p1?.library[0],
  hand: (s: GameState) => s.zones.players.p1?.hand[0],
  graveyard: (s: GameState) => s.zones.players.p1?.graveyard[0],
  exile: (s: GameState) => s.zones.exile[0],
  battlefield: (s: GameState) => s.zones.battlefield[0],
} as const;
type Zone = keyof typeof cardIn;

const destination: Record<Zone, Destination> = {
  library: { zone: "library", position: "top" },
  hand: { zone: "hand" },
  graveyard: { zone: "graveyard" },
  exile: { zone: "exile" },
  battlefield: { zone: "battlefield", controller: "p1" },
};

const cardIdOf = (s: GameState, id: ObjectId) => {
  const obj = s.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  return obj.cardId;
};

describe("moveCard and card ids (D-054)", () => {
  const hidden: readonly Zone[] = ["library", "hand"];
  for (const from of Object.keys(cardIn) as Zone[]) {
    for (const to of Object.keys(destination) as Zone[]) {
      if (from === to) continue;
      const mints = hidden.includes(from) && !hidden.includes(to);
      it(`${from} to ${to}: ${mints ? "a new card id" : "the same card id"}, and a new object id (CR 400.7)`, () => {
        const state = board();
        const id = cardIn[from](state) as ObjectId;
        const moved = moveCard(state, id, destination[to]);
        const [event] = moved.events as [Extract<GameEvent, { type: "ZONE_CHANGED" }>];
        const before = cardIdOf(state, id);
        const after = cardIdOf(moved.state, moved.newId);
        expect(moved.newId).not.toBe(id);
        expect(after === before).toBe(!mints);
        expect(event).toMatchObject({ oldId: id, newId: moved.newId, cardId: before, newCardId: after });
        expect(moved.state.nextCardId).toBe(state.nextCardId + (mints ? 1 : 0));
      });
    }
  }
});

describe("the card id each event names is the public one (D-054)", () => {
  function p1Main(hand: string[], battlefield = [{ ...permanent, oracleId: "mountain" }]): Game {
    return start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest", "forest"], hand, battlefield }),
        playerSetup("p2", { library: ["forest"] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
  }
  const lastEvent = <T extends GameEvent["type"]>(g: Game, type: T) =>
    g.events.findLast((e) => e.type === type) as Extract<GameEvent, { type: T }>;

  it("LAND_PLAYED names the land's new card id on the battlefield (CR 305.1)", () => {
    const g = p1Main(["forest"], []);
    const card = g.state.zones.players.p1?.hand[0] as ObjectId;
    const played = take(g, (a) => a.type === "PLAY_LAND");
    const event = lastEvent(played, "LAND_PLAYED");
    expect(event.cardId).toBe(cardIdOf(played.state, event.newId));
    expect(event.cardId).not.toBe(cardIdOf(g.state, card));
  });

  it("CAST_CANCELLED names the spell's card id; the card is back in hand exactly as it was (CR 734.1)", () => {
    const g = p1Main(["shock"]);
    const card = g.state.zones.players.p1?.hand[0] as ObjectId;
    let next = take(g, (a) => a.type === "CAST_SPELL");
    const spellCardId = cardIdOf(next.state, next.state.zones.stack[0] as ObjectId);
    next = take(next, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget");
    next = take(next, (a) => a.type === "ANSWER" && a.answer.kind === "cancelCast");
    const event = lastEvent(next, "CAST_CANCELLED");
    expect(event.cardId).toBe(spellCardId);
    expect(event.cardId).not.toBe(cardIdOf(g.state, card));
    expect(event.restored).toBe(card);
    expect(next.state.objects[card]).toStrictEqual(g.state.objects[card]);
  });

  it("CARD_DISCARDED names the card's new card id in the graveyard (CR 701.9a)", () => {
    let g = p1Main(
      Array.from({ length: 8 }, () => "shock"),
      [],
    );
    while (g.state.pending?.kind !== "discardToHandSize") g = take(g, (a) => a.type === "PASS_PRIORITY");
    const card = g.state.zones.players.p1?.hand[0] as ObjectId;
    const before = cardIdOf(g.state, card);
    g = take(g, (a) => a.type === "ANSWER" && a.answer.kind === "discardToHandSize" && a.answer.object === card);
    const event = lastEvent(g, "CARD_DISCARDED");
    expect(event.cardId).toBe(cardIdOf(g.state, event.newId));
    expect(event.cardId).not.toBe(before);
  });

  it("CARD_DRAWN names the card id it has in hand: library to hand keeps it, as both are hidden (CR 121.1)", () => {
    const g = start({
      seed: 1,
      players: [playerSetup("p1", { library: ["forest", "forest"] }), playerSetup("p2", { library: ["forest"] })],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "upkeep" } },
      ruleModifiers: [],
    });
    const top = g.state.zones.players.p1?.library[0] as ObjectId;
    const drawn = passBoth(g);
    const event = lastEvent(drawn, "CARD_DRAWN");
    expect(event.cardId).toBe(cardIdOf(drawn.state, event.newId));
    expect(event.cardId).toBe(cardIdOf(g.state, top));
  });
});
