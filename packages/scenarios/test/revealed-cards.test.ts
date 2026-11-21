// Telepathy and Vampire Nocturnus show some hidden cards to every player (CR 701.20a), and nothing more: two worlds
// that differ only in what stays hidden must look the same. And Nocturnus's bonus reads its library's top card, which a
// reorder changes with no card changing zones, so the kept layer pass mustn't go stale (D-092).

import { cardDatabase } from "@mtg/cards";
import { characteristics, createGame, type GameState, type ObjectId, playerView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { parseScenario } from "../src/format.ts";
import { buildSetup } from "../src/setup.ts";

const cards = cardDatabase();

/** The game a scenario's setup starts, from the players' setups written as YAML. */
function started(players: string): GameState {
  const yaml = `name: setup\nrules: [CR 401.5]\nsetup:\n  turn: { active: p1, step: main1 }\n${players}\nsteps:\n  - expect: { turn: 1 }\n`;
  const created = createGame(buildSetup(parseScenario(yaml).setup, cards), cards);
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

/** The same state, with p1's library reordered and nothing else changed (no new objects record). */
function withLibrary(state: GameState, library: ObjectId[]): GameState {
  const p1 = state.zones.players.p1;
  if (p1 === undefined) throw new Error("no p1");
  return { ...state, zones: { ...state.zones, players: { ...state.zones.players, p1: { ...p1, library } } } };
}

describe("Vampire Nocturnus's library top, read by the layer pass", () => {
  it("is read again when a reorder changes the top card, though the objects are the same", () => {
    const state = started("  p1:\n    battlefield: [Vampire Nocturnus]\n    library: [Swamp, Sign in Blood]");
    const nocturnus = state.zones.battlefield[0] as ObjectId;
    const [swamp, sign] = state.zones.players.p1?.library ?? [];
    if (swamp === undefined || sign === undefined) throw new Error("no library");
    expect(characteristics(state, nocturnus, cards).power).toBe(3);
    const reordered = withLibrary(state, [sign, swamp]);
    expect(reordered.objects).toBe(state.objects);
    expect(characteristics(reordered, nocturnus, cards).power).toBe(5);
    expect(characteristics(state, nocturnus, cards).power).toBe(3);
  });
});

describe("revealed cards, seen by another player", () => {
  it("show a library's top card, and nothing of the cards under it (CR 401.5)", () => {
    const world = (library: string) =>
      started(`  p1:\n    battlefield: [Vampire Nocturnus]\n    library: [${library}]`);
    const a = world("Sign in Blood, Swamp, Grizzly Bears");
    const b = world("Sign in Blood, Grizzly Bears, Swamp");
    expect(playerView(a, "p2", cards)).toStrictEqual(playerView(b, "p2", cards));
    // By what it is, never by its id, which a shuffle keeps (CR 701.20d).
    const top = a.zones.players.p1?.library[0] as ObjectId;
    expect(JSON.stringify(playerView(a, "p2", cards))).not.toContain(`"${top}"`);
  });

  it("show a hand's cards, but not its order or when each came (CR 701.18c)", () => {
    const world = (hand: string) => started(`  p1:\n    battlefield: [Telepathy]\n  p2:\n    hand: [${hand}]`);
    const a = world("Grizzly Bears, Lightning Bolt, Grizzly Bears");
    const b = world("Lightning Bolt, Grizzly Bears, Grizzly Bears");
    expect(playerView(a, "p1", cards).zones.players.p2?.revealedHand).toHaveLength(3);
    expect(playerView(a, "p1", cards)).toStrictEqual(playerView(b, "p1", cards));
  });

  it("leave a revealed hand a hidden zone: no ids, no objects (CR 400.2)", () => {
    const state = started("  p1:\n    battlefield: [Telepathy]\n  p2:\n    hand: [Grizzly Bears]");
    const view = playerView(state, "p1", cards);
    expect(view.zones.players.p2?.hand).toBeNull();
    for (const id of state.zones.players.p2?.hand ?? []) expect(view.objects[id]).toBeUndefined();
  });
});
