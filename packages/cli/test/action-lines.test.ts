// The compact action format (D-082): every golden game's actions survive being written as lines and read back.

import { cardDatabase } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { actionLines, actionsFromLines } from "../src/action-lines.ts";
import { goldenFiles, readGolden } from "../src/golden.ts";

const cards = cardDatabase();

describe("action lines", () => {
  it("give back exactly the actions they were written from, for every golden game", () => {
    for (const file of goldenFiles()) {
      const game = readGolden(file, cards);
      const lines = actionLines(game.actions);
      expect(actionsFromLines(game.setup, lines, cards), file).toStrictEqual(game.actions);
    }
  });

  it("write a run of passes as one line and each other action as one", () => {
    const game = readGolden(goldenFiles()[0] as string, cards);
    const lines = actionLines(game.actions.slice(0, 12));
    expect(lines.every((l) => l.length < 60)).toBe(true);
    expect(lines.some((l) => /^pass( \d+)?$/.test(l))).toBe(true);
  });
});
