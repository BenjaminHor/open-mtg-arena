// Splitting what a redirection effect has left among its source's damage entries (Harm's Way's ruling, D-090): the
// range of each share, which forces a minimum when later entries can't take the rest, and rejecting other answers.

import { describe, expect, it } from "vitest";
import { applyAction } from "../../src/game/apply-action.ts";
import { legalActions } from "../../src/game/legal-actions.ts";
import { queueWork } from "../../src/game/work.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { happenOrAsk } from "../../src/pipeline/happen.ts";
import type { ReplacementEffect } from "../../src/state/replacements.ts";
import { BEARS, FOREST, HILL_GIANT, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

/** p2's Grizzly Bears about to deal 3 to p1 and 1 to p1's Hill Giant, with p1's Harm's Way-like effect (2 left). */
function aboutToSplit(): GameState {
  const started = start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST], battlefield: [permanent(HILL_GIANT)] }),
      playerSetup("p2", { library: [FOREST], battlefield: [permanent(BEARS)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p2", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  const [giant, bears] = started.zones.battlefield as [ObjectId, ObjectId];
  const redirect: ReplacementEffect = {
    kind: "redirectDamage",
    id: "o900",
    sourceOracleId: FOREST,
    controller: "p1",
    from: bears,
    remaining: 2,
    to: { kind: "player", player: "p2" },
  };
  const working = queueWork(
    { ...started, replacements: [redirect], pending: null },
    { kind: "givePriority", player: "p2" },
  );
  const damage = [
    { source: bears, to: { kind: "player", player: "p1" }, amount: 3, combat: false },
    { source: bears, to: { kind: "object", object: giant }, amount: 1, combat: false },
  ] as const;
  return happenOrAsk(working, { kind: "dealDamage", damage: [...damage] }, TEST_CARDS).state;
}

describe("splitting a redirection effect's amount (D-090)", () => {
  it("asks its controller, with a share of at least 1 for the first entry, as the last can take only 1", () => {
    const state = aboutToSplit();
    expect(state.pending).toMatchObject({ kind: "divideRedirect", player: "p1", amount: 2, maxima: [3, 1] });
    const amounts = legalActions(state, "p1", TEST_CARDS).map((a) =>
      a.type === "ANSWER" && a.answer.kind === "redirectShare" ? a.answer.amount : null,
    );
    expect(amounts).toStrictEqual([1, 2]);
  });

  it("refuses a share outside that range, and takes one inside it", () => {
    const state = aboutToSplit();
    const pending = state.pending;
    if (pending === null) throw new Error("expected a decision");
    const answer = (amount: number) =>
      applyAction(
        state,
        { type: "ANSWER", decisionId: pending.id, player: "p1", answer: { kind: "redirectShare", amount } },
        TEST_CARDS,
      );
    expect(answer(0).ok).toBe(false);
    expect(answer(3).ok).toBe(false);
    const taken = answer(1);
    if (!taken.ok) throw new Error(taken.error.message);
    // 1 of the 3 and the Giant's 1 go to p2.
    expect([taken.state.players.p1?.life, taken.state.players.p2?.life]).toStrictEqual([18, 18]);
  });
});

/** p1's Hill Giant and Grizzly Bears, p2's Grizzly Bears as the source, and these redirection effects of p1's. */
function withRedirects(...effects: { id: ObjectId; to: "p2" | "giant" | "p1"; remaining: number }[]) {
  const started = start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST], battlefield: [permanent(HILL_GIANT), permanent(BEARS)] }),
      playerSetup("p2", { library: [FOREST], battlefield: [permanent(BEARS)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p2", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  const [giant, p1Bears, source] = started.zones.battlefield as [ObjectId, ObjectId, ObjectId];
  const replacements = effects.map(
    (e): ReplacementEffect => ({
      kind: "redirectDamage",
      id: e.id,
      sourceOracleId: FOREST,
      controller: "p1",
      from: source,
      remaining: e.remaining,
      to: e.to === "giant" ? { kind: "object", object: giant } : { kind: "player", player: e.to },
    }),
  );
  const state = queueWork({ ...started, replacements, pending: null }, { kind: "givePriority", player: "p2" });
  return { state, giant, p1Bears, source };
}

describe("several redirection effects on one source (D-090)", () => {
  it("settles them in order: what the first took from an entry isn't there for the second (CR 616.1f)", () => {
    const { state, giant, p1Bears, source } = withRedirects(
      { id: "o901", to: "p2", remaining: 2 },
      { id: "o902", to: "p2", remaining: 2 },
    );
    const damage = [
      { source, to: { kind: "object", object: giant }, amount: 3, combat: false },
      { source, to: { kind: "object", object: p1Bears }, amount: 1, combat: false },
    ] as const;
    const asked = happenOrAsk(state, { kind: "dealDamage", damage: [...damage] }, TEST_CARDS).state;
    const pending = asked.pending;
    if (pending?.kind !== "divideRedirect") throw new Error("expected the first effect's split");
    const answered = applyAction(
      asked,
      { type: "ANSWER", decisionId: pending.id, player: "p1", answer: { kind: "redirectShare", amount: 2 } },
      TEST_CARDS,
    );
    if (!answered.ok) throw new Error(answered.error.message);
    // The first took 2 of the Giant's 3; the second takes the 1 left there and the Bears' 1, with no split to choose,
    // only which applies first to the Giant's damage, as they differ (CR 616.1), whatever the answer.
    let now = answered.state;
    while (now.pending?.kind === "chooseReplacement") {
      expect(now.pending.kind).not.toBe("divideRedirect");
      const next = applyAction(
        now,
        {
          type: "ANSWER",
          decisionId: now.pending.id,
          player: now.pending.player,
          answer: { kind: "chooseReplacement", option: 0 },
        },
        TEST_CARDS,
      );
      if (!next.ok) throw new Error(next.error.message);
      now = next.state;
    }
    expect(now.pending?.kind).not.toBe("divideRedirect");
    expect(now.players.p2?.life).toBe(16);
  });

  it("doesn't apply one again to damage another sent back (CR 614.5), even with some left", () => {
    // The first sends p1's damage to the Giant; the second, with 1 left, sends the Giant's back to p1.
    const { state, giant, source } = withRedirects(
      { id: "o901", to: "giant", remaining: 2 },
      { id: "o902", to: "p1", remaining: 1 },
    );
    const damage = [{ source, to: { kind: "player", player: "p1" }, amount: 1, combat: false }] as const;
    const done = happenOrAsk(state, { kind: "dealDamage", damage: [...damage] }, TEST_CARDS).state;
    expect(done.players.p1?.life).toBe(19);
    expect(done.objects[giant]?.kind === "card" ? done.objects[giant].damage : null).toBe(0);
  });

  it("deals one source's damage to one recipient as one, when a redirected part joins it (CR 603.2c)", () => {
    const { state, source } = withRedirects({ id: "o901", to: "p2", remaining: 2 });
    const damage = [
      { source, to: { kind: "player", player: "p1" }, amount: 1, combat: false },
      { source, to: { kind: "player", player: "p2" }, amount: 1, combat: false },
    ] as const;
    const done = happenOrAsk(state, { kind: "dealDamage", damage: [...damage] }, TEST_CARDS);
    const dealt = done.events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toMatchObject([{ to: { kind: "player", player: "p2" }, amount: 2 }]);
  });
});
