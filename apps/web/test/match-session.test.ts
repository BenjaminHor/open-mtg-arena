// The match worker's logic (M3-03), in Node: messages in, replies out, the person's seat shown and nothing hidden.

import { cardDatabase } from "@mtg/cards";
import type { Action } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, fixtureSetup, setupOf } from "../src/fixtures/fixtures.ts";
import { handle, type Session } from "../src/worker/match-session.ts";
import type { FromWorker, ToWorker } from "../src/worker/protocol.ts";

const cards = cardDatabase();
const start: ToWorker = { type: "start", decks: ["red-green-beats", "white-soldiers"], seed: 7, human: "p1" };

function update(reply: FromWorker): Extract<FromWorker, { type: "update" }> {
  if (reply.type !== "update") throw new Error(reply.message);
  return reply;
}

describe("the match worker's session", () => {
  it("turns full control on and off: on, it stops at every priority; off, it passes where the person can't act", () => {
    const many = (card: string, n: number) => Array.from({ length: n }, () => card);
    // Nothing in hand: auto-pass has nothing to stop for until p1's next turn, when the Plains they draw can be played.
    const setup = setupOf({
      turn: { number: 3, activePlayer: "p1", step: "precombatMain" },
      players: {
        p1: { life: 20, hand: [], battlefield: ["Plains"], library: many("Plains", 10) },
        p2: { life: 20, hand: [], battlefield: [], library: many("Plains", 10) },
      },
    });
    const started = handle(null, { type: "startFrom", setup, human: "p1" }, cards);
    expect(update(started.reply).fullControl).toBe(false);
    const at = (s: ReturnType<typeof handle>) => {
      const turn = update(s.reply).shown.view.turn;
      return [turn?.number, turn?.activePlayer, turn?.step];
    };
    expect(at(started)).toStrictEqual([5, "p1", "precombatMain"]);
    const on = handle(started.session, { type: "fullControl", on: true }, cards);
    expect(update(on.reply).fullControl).toBe(true);
    const pass = (s: ReturnType<typeof handle>) => {
      const option = update(s.reply).shown.options.find((o) => o.action.type === "PASS_PRIORITY");
      if (option === undefined) throw new Error("no pass");
      return handle(s.session, { type: "act", action: option.action }, cards);
    };
    // Full control: the very next step, the beginning of combat, stops the person.
    const next = pass(on);
    expect(at(next)).toStrictEqual([5, "p1", "beginningOfCombat"]);
    // Off again: the host passes on from here at once, as there's nothing the person could do.
    const off = handle(next.session, { type: "fullControl", on: false }, cards);
    expect(update(off.reply).fullControl).toBe(false);
    // The land is still there to play: the next stop is the second main phase.
    expect(at(off)).toStrictEqual([5, "p1", "postcombatMain"]);
  });

  it("starts a match and stops at the person's first decision, their mulligan", () => {
    const { session, reply } = handle(null, start, cards);
    const shown = update(reply).shown;
    expect(session?.human).toBe("p1");
    expect(update(reply).waitingOn).toBe("p1");
    expect(shown.view.decision?.kind).toBe("mulligan");
    expect(shown.options.length).toBe(2);
  });

  it("applies the person's action and plays the AI's seat until the person decides again", () => {
    const first = handle(null, start, cards);
    const keep = update(first.reply).shown.options.find(
      (o) => o.action.type === "ANSWER" && o.action.answer.kind === "mulligan" && o.action.answer.choice === "keep",
    );
    if (keep === undefined) throw new Error("no keep option");
    const next = handle(first.session, { type: "act", action: keep.action }, cards);
    expect(update(next.reply).waitingOn).toBe("p1");
    expect(next.session?.match.actions.length).toBeGreaterThan(first.session?.match.actions.length ?? 0);
  });

  it("shows none of the opponent's hidden cards: their hand is only a count (CR 402.3)", () => {
    const { session, reply } = handle(null, start, cards);
    const shown = update(reply).shown;
    const theirHand = (session as Session).match.state.zones.players.p2?.hand ?? [];
    expect(theirHand.length).toBeGreaterThan(0);
    const text = JSON.stringify(reply);
    for (const id of theirHand) expect(text).not.toContain(`"${id}"`);
    expect(shown.view.zones.players.p2?.hand).toBeNull();
  });

  it("refuses an action that isn't legal, and leaves the match as it was", () => {
    const first = handle(null, start, cards);
    const stale = { type: "PASS_PRIORITY", decisionId: "d0", player: "p1" } as const;
    const next = handle(first.session, { type: "act", action: stale }, cards);
    expect(next.reply.type).toBe("error");
    expect(next.session).toBe(first.session);
  });

  it("refuses an action before a match, an unknown deck, a bad seed, and an unknown message, without throwing", () => {
    const refused = (message: ToWorker) => handle(null, message, cards).reply.type;
    expect(refused({ type: "act", action: { type: "CONCEDE", player: "p1" } as never })).toBe("error");
    for (const deck of ["no-such-deck", "constructor", "__proto__"]) {
      expect(refused({ ...start, decks: [deck, "white-soldiers"] } as ToWorker)).toBe("error");
    }
    for (const seed of [Number.NaN, 1.5, -3, 1e300]) expect(refused({ ...start, seed } as ToWorker)).toBe("error");
    expect(refused({ ...start, human: "p9" } as ToWorker)).toBe("error");
    expect(refused({ type: "nonsense" } as unknown as ToWorker)).toBe("error");
  });

  it("never shows a card hidden from the person, turn after turn (CR 402.3, 401.2)", () => {
    let { session, reply } = handle(null, start, cards);
    for (let i = 0; i < 40 && reply.type === "update" && reply.shown.options.length > 0; i++) {
      const state = (session as Session).match.state;
      const hidden = [
        ...(state.zones.players.p2?.hand ?? []),
        ...(state.zones.players.p1?.library ?? []),
        ...(state.zones.players.p2?.library ?? []),
      ];
      const text = JSON.stringify(reply);
      for (const id of hidden) expect(text).not.toContain(`"${id}"`);
      const next = handle(
        session,
        { type: "act", action: (reply.shown.options[0] as { action: Action }).action },
        cards,
      );
      session = next.session;
      reply = next.reply;
    }
  });
});

describe("starting from a setup (fixture boards)", () => {
  it("starts each fixture and stops at the person's first decision", () => {
    for (const name of FIXTURE_NAMES) {
      const setup = fixtureSetup(name);
      if (setup === null) throw new Error(name);
      const reply = update(handle(null, { type: "startFrom", setup, human: "p1" }, cards).reply);
      expect(reply.waitingOn).toBe("p1");
      expect(reply.shown.options.length).toBeGreaterThan(0);
    }
  });

  it("refuses a seat that isn't in the setup", () => {
    const setup = fixtureSetup("mid-game");
    if (setup === null) throw new Error("mid-game");
    const { session, reply } = handle(null, { type: "startFrom", setup, human: "p9" }, cards);
    expect(session).toBeNull();
    expect(reply).toEqual({ type: "error", message: "no seat p9" });
  });

  it("has no fixture by an unknown name", () => {
    expect(fixtureSetup("no-such-board")).toBeNull();
  });
});
