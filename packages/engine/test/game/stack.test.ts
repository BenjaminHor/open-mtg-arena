// Priority and the stack (CR 117, 405, 608). Casting arrives in M1-09, so these tests put spells and abilities on the
// stack directly; the M1-09 scenarios cast them for real.

import { describe, expect, it } from "vitest";
import { advance } from "../../src/game/advance.ts";
import { waitFor } from "../../src/game/decide.ts";
import { queueWork } from "../../src/game/work.ts";
import type { AbilityObject, GameState, ObjectId, PlayerId } from "../../src/index.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { act, type Game, playerSetup, start } from "../support/game.ts";

const deck = (card: string, n = 20) => Array.from({ length: n }, () => card);
const hand = (s: GameState, p: PlayerId) => s.zones.players[p]?.hand ?? [];

function precombatMain(): Game {
  return start({
    seed: 3,
    players: [
      playerSetup("p1", { library: deck("forest"), hand: ["shock", "grizzly-bears", "volcanic-hammer"] }),
      playerSetup("p2", { library: deck("mountain"), hand: ["shock", "grizzly-bears"] }),
    ],
    opening: { kind: "fixed", turn: { number: 2, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

/** Puts a card from `player`'s hand on the stack as if they had cast it (the real casting procedure is M1-09). */
function putSpell(game: Game, player: PlayerId, index: number): Game {
  const card = hand(game.state, player)[index] as ObjectId;
  const moved = moveCard(game.state, card, { zone: "stack", controller: player });
  return { state: moved.state, events: game.events };
}

/** Puts an activated ability of `source` on the stack, as if `player` had activated it. */
function putAbility(game: Game, player: PlayerId, source: ObjectId): Game {
  const s = game.state;
  const id = `o${s.nextId}` as const;
  const ability: AbilityObject = {
    kind: "ability",
    id,
    source,
    sourceOracleId: "grizzly-bears",
    ability: { kind: "printed", index: 0 },
    baseController: player,
    timestamp: s.nextTimestamp,
    choices: { modes: [], x: null, targets: [] },
  };
  return {
    state: {
      ...s,
      nextId: s.nextId + 1,
      nextTimestamp: s.nextTimestamp + 1,
      objects: { ...s.objects, [id]: ability },
      zones: { ...s.zones, stack: [...s.zones.stack, id] },
    },
    events: game.events,
  };
}

function pass(game: Game): Game {
  const pending = game.state.pending;
  if (pending?.kind !== "priority") throw new Error(`Expected priority, got ${pending?.kind}`);
  return act(game, { type: "PASS_PRIORITY", decisionId: pending.id, player: pending.player });
}

const cardIdsIn = (s: GameState, ids: readonly ObjectId[]) =>
  ids.map((id) => {
    const obj = s.objects[id];
    return obj?.kind === "card" ? obj.cardId : null;
  });

describe("resolving the top of the stack (CR 117.4, 405.5, 608.1)", () => {
  it("resolves a permanent spell onto the battlefield under its controller when all players pass (CR 608.3a)", () => {
    let game = putSpell(precombatMain(), "p1", 1); // Grizzly Bears
    const spell = game.state.zones.stack[0] as ObjectId;
    const cardId = cardIdsIn(game.state, [spell])[0];
    game = pass(game);
    expect(game.state.zones.stack).toStrictEqual([spell]); // one pass isn't enough
    game = pass(game);
    expect(game.state.zones.stack).toStrictEqual([]);
    expect(cardIdsIn(game.state, game.state.zones.battlefield)).toStrictEqual([cardId]);
    const permanent = game.state.objects[game.state.zones.battlefield[0] as ObjectId];
    expect(permanent).toMatchObject({ baseController: "p1", controlledSinceTurnStart: false });
    // The step doesn't end: the active player gets priority again (CR 117.3b), and everyone must pass again.
    expect(game.state.turn?.step).toBe("precombatMain");
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "priority" });
    expect(game.state.passesInSuccession).toBe(0);
    expect(game.events).toContainEqual({ type: "SPELL_RESOLVED", object: spell, cardId, controller: "p1" });
  });

  it("puts a resolved instant or sorcery into its owner's graveyard (CR 608.2n)", () => {
    let game = putSpell(precombatMain(), "p1", 0); // Shock
    game = putSpell(game, "p1", 1); // Volcanic Hammer (index 1 after Shock left the hand)
    game = pass(pass(game));
    game = pass(pass(game));
    expect(game.state.zones.stack).toStrictEqual([]);
    expect(game.state.zones.players.p1?.graveyard).toHaveLength(2);
    expect(game.state.zones.battlefield).toStrictEqual([]);
  });

  it("resolves the last object put on the stack first (CR 405.2, 405.5)", () => {
    let game = putSpell(precombatMain(), "p1", 1); // p1's Grizzly Bears
    game = putSpell(game, "p2", 0); // p2's Shock, in response (CR 117.7)
    const [bears, shock] = game.state.zones.stack as [ObjectId, ObjectId];
    game = pass(pass(game));
    expect(game.state.zones.stack).toStrictEqual([bears]);
    expect(
      game.events.filter((e) => e.type === "SPELL_RESOLVED").map((e) => e.type === "SPELL_RESOLVED" && e.object),
    ).toStrictEqual([shock]);
    // After p2's spell resolves, the active player (p1) gets priority, not the player who passed last (CR 117.3b).
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "priority" });
    game = pass(pass(game));
    expect(game.state.zones.stack).toStrictEqual([]);
    expect(game.state.zones.battlefield).toHaveLength(1);
  });

  it("removes a resolved ability from the game: it ceases to exist (CR 608.2n)", () => {
    let game = putSpell(precombatMain(), "p1", 1);
    game = pass(pass(game)); // the Bears resolve
    const bears = game.state.zones.battlefield[0] as ObjectId;
    game = putAbility(game, "p1", bears);
    const ability = game.state.zones.stack[0] as ObjectId;
    game = pass(pass(game));
    expect(game.state.zones.stack).toStrictEqual([]);
    expect(game.state.objects[ability]).toBeUndefined();
    expect(game.events).toContainEqual({ type: "ABILITY_RESOLVED", object: ability, source: bears, controller: "p1" });
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "priority" });
  });

  it("still ends the step when all players pass with the stack empty (CR 500.2)", () => {
    let game = putSpell(precombatMain(), "p1", 1);
    game = pass(pass(game)); // resolves
    game = pass(pass(game)); // empty stack: the step ends
    expect(game.state.turn?.step).toBe("beginningOfCombat");
  });
});

describe("the work queue and resolution, in more detail", () => {
  it("gives the active player priority after a resolution even when someone else would be next (CR 117.3b)", () => {
    // p2 holds priority with the pass count at 0, so after p2 and p1 pass, "the next player" would be p2 again.
    let game = putSpell(precombatMain(), "p1", 1);
    const s = game.state;
    game = {
      state: { ...s, pending: { id: `d${s.nextId}`, player: "p2", kind: "priority" }, nextId: s.nextId + 1 },
      events: [],
    };
    game = pass(pass(game));
    expect(game.state.zones.stack).toStrictEqual([]);
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "priority" });
  });

  it("needs every player to pass again after a resolution: one pass resolves nothing (CR 117.4)", () => {
    let game = putSpell(precombatMain(), "p1", 1);
    game = putSpell(game, "p2", 0);
    game = pass(pass(game)); // p2's Shock resolves
    const stack = game.state.zones.stack;
    game = pass(game);
    expect(game.state.zones.stack).toStrictEqual(stack);
    expect(game.state.pending).toMatchObject({ player: "p2", kind: "priority" });
  });

  it("puts an instant into its owner's graveyard even when another player controlled it, on top (CR 608.2n, 404.1)", () => {
    let game = precombatMain();
    const [shock, , hammer] = hand(game.state, "p1") as [ObjectId, ObjectId, ObjectId];
    const shockCard = cardIdsIn(game.state, [shock])[0];
    const hammerCard = cardIdsIn(game.state, [hammer])[0];
    game = { state: moveCard(game.state, hammer, { zone: "stack", controller: "p1" }).state, events: [] };
    game = { state: moveCard(game.state, shock, { zone: "stack", controller: "p2" }).state, events: [] };
    game = pass(pass(game)); // Shock (controlled by p2, owned by p1)
    game = pass(pass(game)); // Hammer
    expect(cardIdsIn(game.state, game.state.zones.players.p1?.graveyard ?? [])).toStrictEqual([shockCard, hammerCard]);
    expect(game.state.zones.players.p2?.graveyard).toStrictEqual([]);
  });

  it("refuses to replace a pending decision, and refuses to stall (D-032)", () => {
    const game = precombatMain();
    expect(() => waitFor(game.state, "p2", { kind: "priority" })).toThrow(/Already waiting/);
    const stuck = { ...game.state, pending: null, work: [] };
    expect(() => advance({ state: stuck, events: [] }, TEST_CARDS)).toThrow(/nothing pending and no work/);
  });

  it("runs work an item creates before older work (D-032)", () => {
    const game = precombatMain();
    const s = {
      ...game.state,
      pending: null,
      work: [{ kind: "endStep" }, { kind: "givePriority", player: "p2" }],
    } as const;
    // endStep begins the next step, which queues priority for the active player ahead of the older item.
    const result = advance({ state: { ...s, work: [...s.work] }, events: [] }, TEST_CARDS);
    expect(result.state.turn?.step).toBe("beginningOfCombat");
    expect(result.state.pending).toMatchObject({ player: "p1", kind: "priority" });
    expect(result.state.work).toStrictEqual([{ kind: "givePriority", player: "p2" }]);
    // A game waiting for a decision with work still queued is plain data, and picks up where it left off.
    expect(JSON.parse(JSON.stringify(result.state))).toStrictEqual(result.state);
  });

  it("queues a sequence in the order given, ahead of older work", () => {
    const game = precombatMain();
    const queued = queueWork(
      { ...game.state, work: [{ kind: "endStep" }] },
      { kind: "resolveTopOfStack" },
      {
        kind: "givePriority",
        player: "p2",
      },
    );
    expect(queued.work).toStrictEqual([
      { kind: "resolveTopOfStack" },
      { kind: "givePriority", player: "p2" },
      { kind: "endStep" },
    ]);
  });

  it("puts a permanent spell onto the battlefield under the spell's controller, even if someone else owns it (CR 608.3a)", () => {
    const game = precombatMain();
    const p1Bears = hand(game.state, "p1")[1] as ObjectId;
    // Gaining control of a spell isn't possible yet; this stands in for it (CR 110.2, 112.2).
    const moved = moveCard(game.state, p1Bears, { zone: "stack", controller: "p2" });
    const resolved = pass(pass({ state: moved.state, events: [] }));
    const permanent = resolved.state.objects[resolved.state.zones.battlefield[0] as ObjectId];
    expect(permanent).toMatchObject({ owner: "p1", baseController: "p2" });
  });
});
