// What the host did, shown at a pace (D-172): how long each frame holds, and the line saying what it shows, on the
// frames of a real seeded game (the worker's, as the app gets them).

import { cardDatabase } from "@mtg/cards";
import type { ViewEvent } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { eventLine } from "../src/interaction/event-line.ts";
import { eventHold, frameHold, HOLD } from "../src/interaction/pacing.ts";
import { handle } from "../src/worker/match-session.ts";
import type { Frame, FromWorker } from "../src/worker/protocol.ts";
import { playFrom } from "./fixture-views.ts";

const cards = cardDatabase();

/**
 * A seeded game: every frame the worker sent, with the view before it. The person passes whenever they can, or with
 * `casting`, casts or plays whatever they can first, so their own spells resolve inside the frames too.
 */
function framesOfAGame(seed = 7, casting = false): { frame: Frame; before: Frame["shown"] | null }[] {
  const all: { frame: Frame; before: Frame["shown"] | null }[] = [];
  let s = handle(null, { type: "start", decks: ["red-green-beats", "white-soldiers"], seed, human: "p1" }, cards);
  let last: Frame["shown"] | null = null;
  for (let i = 0; i < 80; i++) {
    const reply = s.reply as Extract<FromWorker, { type: "update" }>;
    for (const frame of reply.frames) {
      all.push({ frame, before: last });
      last = frame.shown;
    }
    last = reply.shown;
    const play = casting
      ? reply.shown.options.find(
          (o) => (o.action.type === "CAST_SPELL" || o.action.type === "PLAY_LAND") && o.mightPay !== false,
        )
      : undefined;
    const option = play ?? reply.shown.options.find((o) => o.action.type === "PASS_PRIORITY") ?? reply.shown.options[0];
    if (option === undefined || reply.shown.view.result !== null) break;
    s = handle(s.session, { type: "act", action: option.action }, cards);
  }
  return all;
}

describe("how long a frame holds", () => {
  it("holds the opponent's spell long enough to read, and not the person's own, which they just made", () => {
    const cast = (player: "p1" | "p2"): ViewEvent => ({ type: "SPELL_CAST", player, object: "o1", cardId: "c1" });
    expect(eventHold(cast("p2"), "p1")).toBe(HOLD.opponentStack);
    expect(eventHold(cast("p1"), "p1")).toBe(0);
    // Arena's floor for an opponent's stack item [R: 0.4 s].
    expect(HOLD.opponentStack).toBeGreaterThanOrEqual(400);
  });

  it("holds the opponent's new turn, and not the person's own: they act while its banner runs", () => {
    const turn = (activePlayer: "p1" | "p2"): ViewEvent => ({
      type: "TURN_BEGAN",
      turn: 4,
      activePlayer,
      extra: false,
    });
    expect(eventHold(turn("p2"), "p1")).toBe(HOLD.turn);
    expect(eventHold(turn("p1"), "p1")).toBe(0);
  });

  it("gives an empty step no pause of its own, so a quiet turn doesn't drag", () => {
    const step: ViewEvent = { type: "STEP_BEGAN", turn: 3, step: "upkeep", activePlayer: "p2" };
    expect(frameHold([step, { type: "PRIORITY_PASSED", player: "p2" }], "p1")).toBe(0);
  });

  it("gives each new phase of the opponent's turn a moment, so their ladder steps through it (D-175)", () => {
    const began = (
      step: "precombatMain" | "postcombatMain" | "declareBlockers",
      activePlayer: "p1" | "p2",
    ): ViewEvent => ({
      type: "STEP_BEGAN",
      turn: 3,
      step,
      activePlayer,
    });
    expect(frameHold([began("postcombatMain", "p2")], "p1")).toBe(HOLD.phase);
    // Not a step inside a phase, and not the person's own: the ladder walks those while they act.
    expect(frameHold([began("declareBlockers", "p2")], "p1")).toBe(0);
    expect(frameHold([began("precombatMain", "p1")], "p1")).toBe(0);
  });
});

describe("the line a frame shows", () => {
  const frames = framesOfAGame();

  it("says what the opponent did, by name", () => {
    const lines = frames.map(({ frame, before }) => eventLine(frame.events, before, frame.shown));
    const opponents = lines.filter((l): l is string => l?.startsWith("Your opponent") ?? false);
    expect(opponents.length).toBeGreaterThan(0);
    // Named, never an id or "a card" for something the person saw.
    for (const line of opponents) expect(line).not.toMatch(/\bo\d+\b/);
    expect(opponents.some((l) => /^Your opponent (played|cast|attacked with) [A-Z]/.test(l))).toBe(true);
  });

  it('names everything, the person\'s own spells that resolved in a frame too, never an id or "a card"', () => {
    for (const seed of [7, 11, 23]) {
      for (const { frame, before } of framesOfAGame(seed, true)) {
        const line = eventLine(frame.events, before, frame.shown);
        expect(line ?? "", `${seed}: ${frame.events.map((e) => e.type).join(",")}`).not.toMatch(/\ba card\b|\bo\d+\b/);
      }
    }
  });

  it("says each of the opponent's moves, even in the frame a turn begins", () => {
    for (const seed of [7, 11, 23]) {
      for (const { frame, before } of framesOfAGame(seed, true)) {
        const move = frame.events.some((e) =>
          (e.type === "LAND_PLAYED" || e.type === "SPELL_CAST") && e.player === "p2"
            ? true
            : e.type === "ATTACKERS_DECLARED" && e.player === "p2" && e.attacks.length > 0,
        );
        if (move) expect(eventLine(frame.events, before, frame.shown), `${seed}`).toBeTruthy();
      }
    }
  });

  it("sums the damage a player took from several sources in one frame, and counts the tokens made", () => {
    const { frame } = framesOfAGame()[0] ?? {};
    if (frame === undefined) throw new Error("a frame");
    const hit = (source: string, amount: number): ViewEvent => ({
      type: "DAMAGE_DEALT",
      source: source as ViewEvent extends { source: infer S } ? S : never,
      to: { kind: "player", player: "p1" },
      amount,
      combat: true,
    });
    expect(eventLine([hit("o1", 2), hit("o2", 3)], null, frame.shown)).toBe("You took 5 damage");
    const token = (object: string): ViewEvent => ({
      type: "TOKEN_CREATED",
      player: "p2",
      object: object as never,
      cardId: "c1" as never,
    });
    expect(eventLine([token("o1"), token("o2"), token("o3")], null, frame.shown)).toBe(
      "Your opponent created 3 tokens",
    );
  });

  it("lets a new turn (its banner says it) never hide the move made in the same frame", () => {
    const land = framesOfAGame().find(({ frame }) =>
      frame.events.some((e) => e.type === "LAND_PLAYED" && e.player === "p2"),
    );
    if (land === undefined) throw new Error("the opponent plays a land in seed 7");
    const turn: ViewEvent = { type: "TURN_BEGAN", turn: 9, activePlayer: "p2", extra: false };
    expect(eventLine([turn, ...land.frame.events], land.before, land.frame.shown)).toMatch(/^Your opponent played /);
  });

  it("carries no options in a frame: it's for looking (D-172)", () => {
    for (const { frame } of framesOfAGame()) expect(frame.shown.options).toEqual([]);
  });

  it("has a line for every frame but a new turn's (its banner says it) or a new phase's (its ladder does)", () => {
    for (const { frame, before } of frames) {
      if (eventLine(frame.events, before, frame.shown) === null)
        expect(frame.events.some((e) => e.type === "TURN_BEGAN" || e.type === "STEP_BEGAN")).toBe(true);
    }
  });
});

describe("an activated ability's line", () => {
  it("names it as its source's ability: \"activated Prodigal Pyromancer's ability\" (UX review)", () => {
    const m = playFrom({
      turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
      players: {
        p1: { life: 20, hand: [], battlefield: ["Prodigal Pyromancer"], library: ["Forest", "Forest"] },
        p2: { life: 20, hand: [], battlefield: [], library: ["Forest", "Forest"] },
      },
    });
    const start = m.shown();
    const source = start.view.zones.battlefield[0];
    if (source === undefined) throw new Error("Prodigal Pyromancer");
    m.act((a) => a.type === "ACTIVATE_ABILITY" && a.object === source, "activate");
    const after = m.act((a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget", "target");
    const ability = after.view.zones.stack.at(-1);
    if (ability === undefined) throw new Error("the ability on the stack");
    // Said as the opponent's (the person's own activation isn't held, so it has no line).
    const activated: ViewEvent = { type: "ABILITY_ACTIVATED", player: "p2", object: ability, source };
    expect(eventLine([activated], start, after)).toBe("Your opponent activated Prodigal Pyromancer's ability");
  });
});
