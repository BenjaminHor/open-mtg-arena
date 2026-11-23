// The controls (interaction/controls.ts): over many real games, every legal option the person has is reachable from
// some control (a card, a portrait, the main button, a small button, a prompt), and every control sends an action the
// engine listed. This is what lets the app drop its list of every action (M3-04b).

import { DECKS } from "@mtg/cards";
import type { Action, ObjectId } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { type Choice, type Controls, controls, type Selection, sameAction } from "../src/interaction/controls.ts";
import { handle, type Session } from "../src/worker/match-session.ts";
import { cards } from "./fixture-views.ts";

/** Every action a person could send from these controls, with what a first tap opens (a lifted card, a blocker). */
function reachable(at: (selection: Selection) => Controls): Action[] {
  const base = at(null);
  const fromTaps = (c: Controls) =>
    Object.values(c.cards).flatMap(({ tap }): Choice[] =>
      tap.kind === "send" ? [tap.choice] : tap.kind === "menu" ? tap.choices : [],
    );
  const selected = Object.entries(base.cards)
    .filter(([, { tap }]) => tap.kind === "select")
    .flatMap(([id]) => fromTaps(at(id as ObjectId)));
  const all = [
    ...fromTaps(base),
    ...selected,
    ...Object.values(base.players).flat(),
    ...base.secondary,
    ...(base.prompt?.choices ?? []),
  ].map((c) => c.action);
  return [...all, ...(base.main === null ? [] : [base.main]), ...(base.concede === null ? [] : [base.concede])];
}

/** A small seeded random number generator for the test's own choices. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("the controls", () => {
  const names = Object.keys(DECKS);
  const games = Array.from({ length: 24 }, (_, i) => i);

  it("reach every legal option, and send only legal ones, through whole games", () => {
    let decisions = 0;
    for (const game of games) {
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
        const reach = reachable((selection) => controls(shown, selection));
        for (const option of shown.options) {
          // A spell or ability the person's mana surely can't pay for is left without a control, on purpose.
          if (option.mightPay === false) continue;
          expect(
            reach.some((a) => sameAction(a, option.action)),
            `no control for ${JSON.stringify(option.action)} at ${shown.view.decision?.kind}`,
          ).toBe(true);
        }
        for (const action of reach) {
          expect(shown.options.some((o) => sameAction(o.action, action))).toBe(true);
        }
        // Play on with a random legal option, never conceding, to reach every kind of decision.
        const playable = shown.options.filter((o) => o.action.type !== "CONCEDE" && o.mightPay !== false);
        const pick = playable[Math.floor(next() * playable.length)]?.action;
        if (pick === undefined) break;
        step = handle(step.session as Session, { type: "act", action: pick }, cards);
      }
    }
    expect(decisions).toBeGreaterThan(1000);
  });
});
