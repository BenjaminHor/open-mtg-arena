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
import { FOREST, HOMING_BEAR, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

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
