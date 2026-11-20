// Choosing between replacement effects (CR 616.1): no Magic 2010 card puts two on one event before M2-08d, so these
// use the test-only Homing Bear ("would be put into a graveyard ... into its owner's library instead") with a
// regeneration shield, both applying to one destroy.

import { describe, expect, it } from "vitest";
import { addRegenerationShields } from "../../src/effects/regeneration-shield.ts";
import { applyAction } from "../../src/game/apply-action.ts";
import { queueWork } from "../../src/game/work.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { happen, happenOrAsk } from "../../src/pipeline/happen.ts";
import { playerView } from "../../src/view/player-view.ts";
import { FOREST, HOMING_BEAR, MOUNTAIN, TEST_CARDS, UNMAKE, WRATH } from "../support/cards.ts";
import { type Game, playerSetup, start, take } from "../support/game.ts";

/** p1's shielded Homing Bear about to be destroyed by something p2 controls, with priority to follow (as combat does). */
function aboutToDestroy(): { state: GameState; bear: ObjectId } {
  const started = start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: [FOREST, FOREST],
        battlefield: [{ oracleId: HOMING_BEAR, tapped: false, summoningSick: false, damage: 0, counters: {} }],
      }),
      playerSetup("p2", { library: [FOREST] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p2", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  const [bear] = started.zones.battlefield as [ObjectId];
  // Nothing pending: the destroy happens as part of the work the queue runs, before priority.
  const working = queueWork(
    { ...addRegenerationShields(started, [bear]).state, pending: null },
    {
      kind: "givePriority",
      player: "p2",
    },
  );
  return { state: working, bear };
}

/** Destroys the bear, then answers the choice with the option of this kind. */
function destroyChoosing(kind: "ownText" | "regenerationShield") {
  const { state, bear } = aboutToDestroy();
  const asked = happenOrAsk(state, { kind: "destroy", object: bear }, TEST_CARDS).state;
  const pending = asked.pending;
  if (pending?.kind !== "chooseReplacement") throw new Error("expected a choice of replacement");
  const option = pending.options.findIndex((ref) => ref.kind === kind);
  const answered = applyAction(
    asked,
    { type: "ANSWER", decisionId: pending.id, player: pending.player, answer: { kind: "chooseReplacement", option } },
    TEST_CARDS,
  );
  if (!answered.ok) throw new Error(answered.error.message);
  return { asked, answered, bear };
}

describe("choosing between replacement effects (CR 616.1)", () => {
  it("asks the affected object's controller, performing nothing yet", () => {
    const { asked, bear } = destroyChoosing("regenerationShield");
    expect(asked.pending).toMatchObject({
      kind: "chooseReplacement",
      player: "p1",
      options: [
        { kind: "ownText", object: bear, index: 0 },
        { kind: "regenerationShield", object: bear },
      ],
    });
    expect(asked.zones.battlefield).toStrictEqual([bear]);
    expect(asked.replacements).toHaveLength(1);
  });

  it("applies the chosen one: regeneration first, and the bear stays, the other no longer applying", () => {
    const { answered, bear } = destroyChoosing("regenerationShield");
    if (!answered.ok) throw new Error("rejected");
    expect(answered.state.zones.battlefield).toStrictEqual([bear]);
    expect(answered.events.map((e) => e.type)).toContain("PERMANENT_REGENERATED");
    expect(answered.events.map((e) => e.type)).not.toContain("LIBRARY_SHUFFLED");
  });

  it("then the others still applicable to the changed event (CR 616.1f): sent to the library, it's still destroyed, so the shield regenerates it, and what was replaced never happens (CR 614.6)", () => {
    const { answered, bear } = destroyChoosing("ownText");
    if (!answered.ok) throw new Error("rejected");
    const types = answered.events.map((e) => e.type);
    expect(answered.state.zones.battlefield).toStrictEqual([bear]);
    expect(types).toContain("PERMANENT_REGENERATED");
    expect(types).not.toContain("CARDS_REVEALED");
    expect(types).not.toContain("LIBRARY_SHUFFLED");
    expect(answered.state.pending).toMatchObject({ kind: "priority", player: "p2" });
  });

  it("can't be asked by plain happen, whose callers do more after the event", () => {
    const { state, bear } = aboutToDestroy();
    expect(() => happen(state, { kind: "destroy", object: bear }, TEST_CARDS)).toThrow("happenOrAsk");
  });

  it("is shown to its player without the engine's bookkeeping", () => {
    const { asked } = destroyChoosing("ownText");
    const view = playerView(asked, "p1");
    expect(view.decision).toMatchObject({ kind: "chooseReplacement" });
    expect(view.decision).not.toHaveProperty("resume");
  });
});

/** Each player with a shielded Homing Bear; p2, active, has a Mountain and `spell` in hand. */
function withSpell(spell: string): Game {
  const bear = { oracleId: HOMING_BEAR, tapped: false, summoningSick: false, damage: 0, counters: {} };
  const mountain = { oracleId: MOUNTAIN, tapped: false, summoningSick: false, damage: 0, counters: {} };
  const game = start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST, FOREST], battlefield: [bear] }),
      playerSetup("p2", { library: [FOREST], hand: [spell], battlefield: [bear, mountain] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p2", step: "precombatMain" } },
    ruleModifiers: [],
  });
  const bears = game.state.zones.battlefield.filter((id) => {
    const obj = game.state.objects[id];
    return obj?.kind === "card" && obj.oracleId === HOMING_BEAR;
  });
  return { ...game, state: addRegenerationShields(game.state, bears).state };
}

/** Casts the spell (targeting p1's bear if it has a target), pays, and passes until it resolves or asks. */
function castAndResolve(game: Game): Game {
  let g = take(game, (a) => a.type === "CAST_SPELL");
  for (;;) {
    const kind = g.state.pending?.kind;
    if (kind === "chooseReplacement" || (kind === "priority" && g.state.zones.stack.length === 0)) return g;
    g = take(
      g,
      (a) =>
        a.type === "PASS_PRIORITY" ||
        a.type === "ACTIVATE_ABILITY" ||
        (a.type === "ANSWER" && (a.answer.kind === "payMana" || a.answer.kind === "chooseTarget")),
    );
  }
}

describe("a choice of replacement effect as a spell resolves", () => {
  it("waits within the resolution, survives being saved, and the resolution finishes after the answer", () => {
    const asked = castAndResolve(withSpell(UNMAKE));
    expect(asked.state.pending).toMatchObject({ kind: "chooseReplacement" });
    // Plain JSON, as every state is: a saved game waiting on the choice can be loaded and answered.
    const saved = JSON.parse(JSON.stringify(asked.state)) as GameState;
    expect(saved).toStrictEqual(asked.state);
    const pending = saved.pending;
    if (pending?.kind !== "chooseReplacement") throw new Error("expected a choice");
    const option = pending.options.findIndex((ref) => ref.kind === "regenerationShield");
    const answered = applyAction(
      saved,
      { type: "ANSWER", decisionId: pending.id, player: pending.player, answer: { kind: "chooseReplacement", option } },
      TEST_CARDS,
    );
    if (!answered.ok) throw new Error(answered.error.message);
    expect(answered.events.map((e) => e.type)).toContain("PERMANENT_REGENERATED");
    expect(answered.state.zones.stack).toStrictEqual([]);
    expect(answered.state.zones.players.p2?.graveyard).toHaveLength(1);
    expect(answered.state.pending).toMatchObject({ kind: "priority", player: "p2" });
  });

  it("asks the players in APNAP order when one event affects both players' creatures (CR 616.1, 101.4)", () => {
    const first = castAndResolve(withSpell(WRATH));
    expect(first.state.pending).toMatchObject({ kind: "chooseReplacement", player: "p2" });
    const second = take(first, (a) => a.type === "ANSWER");
    expect(second.state.pending).toMatchObject({ kind: "chooseReplacement", player: "p1" });
    const done = take(second, (a) => a.type === "ANSWER");
    expect(done.state.pending).toMatchObject({ kind: "priority" });
    expect(done.events.map((e) => e.type).filter((t) => t === "PERMANENT_REGENERATED")).toHaveLength(2);
  });

  it("refuses an option that isn't there", () => {
    const asked = castAndResolve(withSpell(UNMAKE));
    const pending = asked.state.pending;
    if (pending?.kind !== "chooseReplacement") throw new Error("expected a choice");
    const answer = { kind: "chooseReplacement", option: 9 } as const;
    const result = applyAction(
      asked.state,
      { type: "ANSWER", decisionId: pending.id, player: pending.player, answer },
      TEST_CARDS,
    );
    expect(result.ok).toBe(false);
  });
});
