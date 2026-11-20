// Triggered abilities' machinery where a scenario can't reach it with the pool's cards: several creatures entering in
// one event batch, a cast cancelled after its mana abilities triggered something, an intervening if turned false
// between triggering and resolving, and the repeat of CR 603.3b. The cards' own behavior is in the m2-07a scenarios.

import { describe, expect, it } from "vitest";
import { advance } from "../../src/game/advance.ts";
import { queueWork } from "../../src/game/work.ts";
import {
  applyAction,
  type GameEvent,
  type GameState,
  legalActions,
  type ObjectId,
  type PendingTrigger,
  type PlayerId,
} from "../../src/index.ts";
import { detectTriggers } from "../../src/triggers/detect.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { BEARS, FOREST, MINE, MOUNTAIN, SHOCK, TEST_CARDS, WARDEN } from "../support/cards.ts";
import { answer, type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string, tapped = false) => ({
  oracleId,
  tapped,
  summoningSick: false,
  damage: 0,
  counters: {},
});
const deck = (card: string, n = 20) => Array.from({ length: n }, () => card);
const hand = (s: GameState, p: PlayerId) => s.zones.players[p]?.hand ?? [];
const onBattlefield = (s: GameState, oracleId: string) =>
  s.zones.battlefield.filter((id) => {
    const obj = s.objects[id];
    return obj?.kind === "card" && obj.oracleId === oracleId;
  });

type Fields = Parameters<typeof playerSetup>[1];

function game(step: "precombatMain" | "upkeep", p1: Fields, p2: Fields = {}): Game {
  return start({
    seed: 5,
    players: [
      playerSetup("p1", { library: deck(FOREST), ...p1 }),
      playerSetup("p2", { library: deck(MOUNTAIN), ...p2 }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step } },
    ruleModifiers: [],
  });
}

/** Moves these cards from p1's hand onto the battlefield as one batch, returning the state after and the events. */
function enterTogether(state: GameState, cards: readonly ObjectId[]): { after: GameState; events: GameEvent[] } {
  let after = state;
  const events: GameEvent[] = [];
  for (const id of cards) {
    const moved = moveCard(after, id, { zone: "battlefield", controller: "p1" });
    after = moved.state;
    events.push(...moved.events);
  }
  return { after, events };
}

describe("detecting triggers (CR 603.2)", () => {
  it("triggers once for each creature that enters in the same batch (CR 603.2c)", () => {
    const g = game("precombatMain", { hand: [BEARS, BEARS], battlefield: [permanent(WARDEN)] });
    const before = g.state;
    const { after, events } = enterTogether(before, hand(before, "p1"));
    const detected = detectTriggers(before, after, events, TEST_CARDS);
    const warden = onBattlefield(after, WARDEN)[0];
    expect(detected.pendingTriggers.map((t) => t.source)).toStrictEqual([warden, warden]);
  });

  it("a creature entering with another sees it enter, but not itself (CR 603.6a)", () => {
    const g = game("precombatMain", { hand: [WARDEN, BEARS] });
    const before = g.state;
    const { after, events } = enterTogether(before, hand(before, "p1"));
    const detected = detectTriggers(before, after, events, TEST_CARDS);
    expect(detected.pendingTriggers).toHaveLength(1);
    expect(detected.pendingTriggers[0]?.event.object).toBe(onBattlefield(after, BEARS)[0]);
  });

  it("an opponent's creature entering triggers it too: \"another creature\" is any player's", () => {
    const g = game("precombatMain", { battlefield: [permanent(WARDEN)] }, { hand: [BEARS] });
    const before = g.state;
    const bears = hand(before, "p2")[0] as ObjectId;
    const moved = moveCard(before, bears, { zone: "battlefield", controller: "p2" });
    const detected = detectTriggers(before, moved.state, moved.events, TEST_CARDS);
    expect(detected.pendingTriggers.map((t) => t.controller)).toStrictEqual(["p1"]);
  });
});

describe("putting triggers on the stack (CR 603.3)", () => {
  it("cancelling a cast drops the triggers that came up during it, as the cast is undone (CR 734.1)", () => {
    let g = game("precombatMain", { hand: [SHOCK], battlefield: [permanent(MOUNTAIN)] });
    g = take(g, (a) => a.type === "CAST_SPELL");
    // As if a mana ability activated while paying had triggered something.
    const fake: PendingTrigger = {
      source: onBattlefield(g.state, MOUNTAIN)[0] as ObjectId,
      sourceOracleId: WARDEN,
      index: 0,
      controller: "p1",
      event: { player: null, object: null, amount: null },
    };
    g = { ...g, state: { ...g.state, pendingTriggers: [fake] } };
    g = answer(g, { kind: "cancelCast" });
    expect(g.state.pendingTriggers).toStrictEqual([]);
    expect(g.state.zones.stack).toStrictEqual([]);
  });

  it("after a batch goes on the stack, triggers that came up meanwhile go on as a new batch (CR 603.3b)", () => {
    const g = game("precombatMain", { battlefield: [permanent(WARDEN)] });
    const warden = onBattlefield(g.state, WARDEN)[0] as ObjectId;
    const trigger: PendingTrigger = {
      source: warden,
      sourceOracleId: WARDEN,
      index: 0,
      controller: "p1",
      event: { player: null, object: null, amount: null },
    };
    // The first batch is empty, and one trigger is waiting when it's done: priority isn't given until it's on too.
    const state: GameState = queueWork(
      { ...g.state, pending: null, pendingTriggers: [trigger] },
      { kind: "putTriggers", batch: [], player: "p1" },
    );
    const done = advance({ state, events: [] }, TEST_CARDS);
    expect(done.events.filter((e) => e.type === "ABILITY_TRIGGERED")).toHaveLength(1);
    expect(done.state.zones.stack).toHaveLength(1);
    expect(done.state.pendingTriggers).toStrictEqual([]);
    expect(done.state.pending).toMatchObject({ kind: "priority", player: "p1" });
  });
});

describe("ordering one's own triggers (CR 603.3b)", () => {
  it("lists and accepts only the deciding player's own triggers of the batch", () => {
    const g = game(
      "precombatMain",
      { battlefield: [permanent(WARDEN), permanent(WARDEN)] },
      { battlefield: [permanent(WARDEN)] },
    );
    const [a, b, c] = onBattlefield(g.state, WARDEN) as [ObjectId, ObjectId, ObjectId];
    const trigger = (source: ObjectId, controller: PlayerId): PendingTrigger => ({
      source,
      sourceOracleId: WARDEN,
      index: 0,
      controller,
      event: { player: null, object: null, amount: null },
    });
    // p2's trigger first in the batch: p1 still orders first, as the active player.
    const batch = [trigger(c, "p2"), trigger(a, "p1"), trigger(b, "p1")];
    const state = queueWork({ ...g.state, pending: null }, { kind: "putTriggers", batch, player: "p1" });
    const asked = advance({ state, events: [] }, TEST_CARDS).state;
    expect(asked.pending).toMatchObject({ kind: "orderTriggers", player: "p1" });
    const listed = legalActions(asked, "p1", TEST_CARDS).map((x) => x.type === "ANSWER" && x.answer);
    expect(listed).toStrictEqual([
      { kind: "orderTrigger", index: 1 },
      { kind: "orderTrigger", index: 2 },
    ]);
    const decisionId = asked.pending?.id ?? "d0";
    for (const index of [0, -1, 3]) {
      const result = applyAction(
        asked,
        { type: "ANSWER", decisionId, player: "p1", answer: { kind: "orderTrigger", index } },
        TEST_CARDS,
      );
      expect(result.ok ? null : result.error.code).toBe("illegalAction");
    }
  });
});

describe("an intervening if (CR 603.4)", () => {
  it("is checked again on resolution: a Mine tapped by then does nothing (CR 608.2a)", () => {
    let g = game("upkeep", { battlefield: [permanent(MINE)] });
    g = passBoth(g); // to the draw step: p1 draws, and the Mine triggers
    expect(g.state.turn?.step).toBe("draw");
    expect(g.state.zones.stack).toHaveLength(1);
    const handSize = hand(g.state, "p1").length;
    const mine = onBattlefield(g.state, MINE)[0] as ObjectId;
    const obj = g.state.objects[mine];
    if (obj?.kind !== "card") throw new Error("no Mine");
    g = { ...g, state: { ...g.state, objects: { ...g.state.objects, [mine]: { ...obj, tapped: true } } } };
    g = passBoth(g);
    expect(g.state.zones.stack).toStrictEqual([]);
    expect(hand(g.state, "p1")).toHaveLength(handSize);
    expect(g.events.filter((e) => e.type === "CARD_DRAWN")).toHaveLength(1);
    expect(g.events).toContainEqual(expect.objectContaining({ type: "ABILITY_DID_NOT_RESOLVE", reason: "condition" }));
  });

  it("reads a source that left before its trigger went on the stack from its last known information (CR 608.2h)", () => {
    let g = game("upkeep", { battlefield: [permanent(MINE)] });
    const mine = onBattlefield(g.state, MINE)[0] as ObjectId;
    const trigger: PendingTrigger = {
      source: mine,
      sourceOracleId: MINE,
      index: 0,
      controller: "p1",
      event: { player: "p1", object: null, amount: null },
    };
    // The Mine triggered, untapped, then went to the graveyard before anyone would receive priority.
    const moved = moveCard(g.state, mine, { zone: "graveyard" });
    const state = queueWork(
      { ...moved.state, pending: null, pendingTriggers: [trigger] },
      { kind: "givePriority", player: "p1" },
    );
    const put = advance({ state, events: [] }, TEST_CARDS);
    expect(put.state.zones.stack).toHaveLength(1);
    g = { state: put.state, events: [] };
    const handSize = hand(g.state, "p1").length;
    g = passBoth(g);
    expect(hand(g.state, "p1")).toHaveLength(handSize + 1);
  });

  it("a Mine tapped as the draw step begins doesn't trigger at all", () => {
    let g = game("upkeep", { battlefield: [permanent(MINE, true)] });
    g = passBoth(g);
    expect(g.state.zones.stack).toStrictEqual([]);
    expect(g.events.filter((e) => e.type === "ABILITY_TRIGGERED")).toStrictEqual([]);
  });
});
