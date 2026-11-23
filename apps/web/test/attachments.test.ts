// Auras and Equipment beside their host (M3-04c slice 4b): out of their own row, just left of the permanent they're
// attached to (CR 301.5, 303.4), on the host's side, behind it and peeking out, following it when combat moves it.

import { describe, expect, it } from "vitest";
import { attachedByHost, withAttachments } from "../src/board-model/attachments.ts";
import { type BoardCard, boardModel } from "../src/board-model/board-model.ts";
import { COMPACT } from "../src/layout/compact.ts";
import { fixtureView } from "./fixture-views.ts";

const PHONE = { width: 812, height: 375 };
const shown = fixtureView("attachments");
const model = boardModel(shown, PHONE);
const named = (name: string) => {
  const card = model.cards.find((c) => c.name === name && c.zone === "battlefield");
  if (card === undefined) throw new Error(`no ${name}`);
  return card;
};

describe("attachments beside their host", () => {
  it("puts an Aura or Equipment just left of its host, peeking out, in the host's row", () => {
    for (const [attachment, host] of [
      ["Holy Strength", "Serra Angel"],
      ["Whispersilk Cloak", "Grizzly Bears"],
    ] as const) {
      const a = named(attachment);
      const h = named(host);
      expect(a.y).toBe(h.y);
      expect(a.row).toBe("creatures");
      expect(h.x - a.x).toBeCloseTo(COMPACT.attach.peek * h.width, 5);
      expect(h.attachments).toBe(1);
    }
  });

  it("draws an attachment behind its host", () => {
    const order = (name: string) => model.cards.findIndex((c) => c.name === name && c.zone === "battlefield");
    expect(order("Holy Strength")).toBeLessThan(order("Serra Angel"));
  });

  it("keeps the host's row room for it: no other card under the part that peeks out", () => {
    const elves = named("Llanowar Elves");
    const cloak = named("Whispersilk Cloak");
    expect(cloak.x).toBeGreaterThanOrEqual(elves.x + elves.width);
  });

  it("sits an Aura on the opponent's side by their creature, and one on a land by that land", () => {
    expect(named("Pacifism").y).toBe(named("Elite Vanguard").y);
    expect(named("Pacifism").mine).toBe(false);
    const mirage = named("Convincing Mirage");
    expect(mirage.row).toBe("lands");
    const islands = model.cards.filter((c) => c.name === "Island" && c.zone === "battlefield");
    expect(islands.some((i) => i.attachments === 1 && i.x - mirage.x > 0 && i.y === mirage.y)).toBe(true);
  });

  it("follows its host when combat moves it", () => {
    const attached = attachedByHost(shown);
    const angel = named("Serra Angel");
    const stepped: BoardCard = { ...angel, attachments: 0, y: angel.y - 13 };
    const placed = withAttachments([stepped], attached, shown.player, COMPACT);
    expect(placed.find((c) => c.name === "Holy Strength")?.y).toBe(stepped.y);
  });
});
