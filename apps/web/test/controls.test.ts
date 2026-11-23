// The controls (interaction/controls.ts), checked the way the HUD shows them: over many real games, every legal option
// the person has is reachable from something on screen (a card's tap region, a portrait, the main button, a small
// button beside it, a prompt), and every control sends an action the engine listed. This is what lets the app drop its
// list of every action (M3-04b, D-156).

import { DECKS } from "@mtg/cards";
import type { Action, ObjectId, SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { boardModel } from "../src/board-model/board-model.ts";
import { setupOf } from "../src/fixtures/fixtures.ts";
import { type Choice, type Controls, controls, sameAction } from "../src/interaction/controls.ts";
import { handle, type Session } from "../src/worker/match-session.ts";
import { cards } from "./fixture-views.ts";

const PHONE = { width: 812, height: 375 };

/**
 * Every action a person could send from the screen: a tap on a card that has a tap region (the hand open, as a tap on
 * it opens it), and what a first tap opens (a lifted card, a picked blocker: one level is all any choice needs); the
 * one target a portrait shows; the small buttons the HUD has room for; the prompt; the main button; Concede.
 */
function onScreen(shown: SeatView): Action[] {
  const screen = (selection: ObjectId | null) => {
    const c = controls(shown, selection);
    const regions = new Set(
      boardModel(shown, PHONE, undefined, { handOpen: true, selected: selection }).regions.flatMap((r) => r.members),
    );
    // A card with a control but nothing to tap on screen would be a dead end.
    for (const id of Object.keys(c.cards))
      expect(regions.has(id as ObjectId), `${id} has a control but no region`).toBe(true);
    return c;
  };
  const base = screen(null);
  const fromTaps = (c: Controls) =>
    Object.values(c.cards).flatMap(({ tap }): Choice[] =>
      tap.kind === "send" ? [tap.choice] : tap.kind === "menu" ? tap.choices : [],
    );
  const selected = Object.entries(base.cards)
    .filter(([, { tap }]) => tap.kind === "select")
    .flatMap(([id]) => fromTaps(screen(id as ObjectId)));
  for (const choices of Object.values(base.players)) expect(choices.length).toBeLessThanOrEqual(1);
  expect(base.secondary.length).toBeLessThanOrEqual(2);
  // Within a menu or the prompt, every entry says something different.
  for (const { tap } of Object.values(base.cards)) {
    if (tap.kind === "menu") expect(new Set(tap.choices.map((c) => c.label)).size).toBe(tap.choices.length);
  }
  const prompt = base.prompt?.choices ?? [];
  expect(new Set(prompt.map((c) => c.label)).size).toBe(prompt.length);
  return [
    ...[...fromTaps(base), ...selected, ...Object.values(base.players).flat(), ...base.secondary, ...prompt].map(
      (c) => c.action,
    ),
    ...(base.main === null ? [] : [base.main]),
  ];
}

/** A small seeded random number generator for the test's own choices. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Plays to the person's next decision with `pick` choosing each action, and returns what they're shown. */
function playUntil(
  step: ReturnType<typeof handle>,
  done: (shown: SeatView) => boolean,
  pick: (shown: SeatView) => Action | undefined,
) {
  let at = step;
  for (let i = 0; i < 60; i++) {
    if (at.reply.type !== "update") throw new Error(at.reply.message);
    if (done(at.reply.shown)) return at.reply.shown;
    const action = pick(at.reply.shown);
    if (action === undefined) throw new Error(`stuck at ${at.reply.shown.view.decision?.kind}`);
    at = handle(at.session as Session, { type: "act", action }, cards);
  }
  throw new Error("never got there");
}

describe("the controls", () => {
  const names = Object.keys(DECKS);

  // Forty whole games, a board model per decision: longer than a unit test's usual five seconds.
  it("reach every legal option from the screen, and send only legal ones, through whole games", {
    timeout: 60_000,
  }, () => {
    let decisions = 0;
    const kinds = new Set<string>();
    for (let game = 0; game < 40; game++) {
      const next = random(1000 + game);
      const decks: [string, string] = [
        names[game % names.length] as string,
        names[(game + 2) % names.length] as string,
      ];
      let step = handle(null, { type: "start", decks, seed: 500 + game, human: "p1" }, cards);
      for (let i = 0; i < 400; i++) {
        if (step.reply.type !== "update") throw new Error(step.reply.message);
        const shown = step.reply.shown;
        if (shown.options.length === 0) break;
        decisions += 1;
        kinds.add(shown.view.decision?.kind ?? "none");
        const reach = onScreen(shown);
        for (const option of shown.options) {
          const unpayable = option.mightPay === false && option.action.type !== "ANSWER";
          const found = reach.some((a) => sameAction(a, option.action));
          // A spell or ability the person's mana surely can't pay for has no control, on purpose; every other option has.
          expect(found, `option ${JSON.stringify(option.action)} at ${shown.view.decision?.kind}`).toBe(!unpayable);
        }
        for (const action of reach) expect(shown.options.some((o) => sameAction(o.action, action))).toBe(true);
        // Conceding isn't among the options (D-042) but is always offered, until the game ends (CR 104.3a).
        expect(controls(shown, null).concede).toEqual({ type: "CONCEDE", player: "p1" });
        const playable = shown.options.filter((o) => o.mightPay !== false);
        const pick = playable[Math.floor(next() * playable.length)]?.action;
        if (pick === undefined) break;
        step = handle(step.session as Session, { type: "act", action: pick }, cards);
      }
    }
    expect(decisions).toBeGreaterThan(1500);
    // Decision kinds these games don't reach (dividing damage, paying by hand, trigger order, naming a card...) still
    // get the prompt by the exhaustive switch in controls.ts; slice 2 gives each a fixture of its own.
    expect([...kinds]).toEqual(
      expect.arrayContaining(["priority", "mulligan", "chooseTarget", "declareAttackers", "declareBlockers"]),
    );
  });

  it("puts a target that isn't on the board in the prompt: a creature card in a graveyard (Gravedigger)", () => {
    const many = (card: string, n: number) => Array.from({ length: n }, () => card);
    const setup = setupOf({
      turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
      players: {
        p1: {
          life: 20,
          hand: ["Gravedigger"],
          battlefield: many("Swamp", 4),
          graveyard: ["Grizzly Bears", "Centaur Courser"],
          library: many("Island", 10),
        },
        p2: { life: 20, hand: [], battlefield: ["Mountain"], library: many("Forest", 10) },
      },
    });
    const name = (shown: SeatView, id: string) => {
      const seen = shown.seen[id as ObjectId];
      return seen?.kind === "card" ? seen.characteristics.name : "";
    };
    const shown = playUntil(
      handle(null, { type: "startFrom", setup, human: "p1" }, cards),
      (s) => s.view.decision?.kind === "chooseTarget",
      (s) =>
        (
          s.options.find((o) => o.action.type === "CAST_SPELL" && name(s, o.action.object) === "Gravedigger") ??
          s.options.find((o) => o.action.type === "ANSWER") ??
          s.options.find((o) => o.action.type === "PASS_PRIORITY")
        )?.action,
    );
    const c = controls(shown, null);
    expect(c.prompt?.choices.map((choice) => choice.label).sort()).toEqual([
      "Target Centaur Courser",
      "Target Grizzly Bears",
    ]);
  });
});
