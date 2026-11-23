// Auras and Equipment beside their host (M3-04c slice 4b): out of their own row, just left of the permanent they're
// attached to (CR 301.5, 303.4), on the host's side, behind it and peeking out, following it when combat moves it.

import type { ObjectId, SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { attachedByHost, withAttachments } from "../src/board-model/attachments.ts";
import { type BoardCard, boardModel } from "../src/board-model/board-model.ts";
import { COMPACT } from "../src/layout/compact.ts";
import { boardView, fixtureView } from "./fixture-views.ts";

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

  it("keeps a host out of a pile with its twin, so its Aura has room (a host stands apart)", () => {
    const twins = boardView({
      turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
      players: {
        p1: { life: 20, hand: [], battlefield: ["Plains"], library: ["Plains", "Plains"] },
        p2: {
          life: 20,
          hand: [],
          battlefield: ["Elite Vanguard", "Elite Vanguard", { card: "Pacifism", attachedTo: 0 }],
          library: ["Plains", "Plains"],
        },
      },
    });
    const m = boardModel(twins, PHONE);
    const pacifism = m.cards.find((c) => c.name === "Pacifism");
    const host = m.cards.find((c) => c.name === "Elite Vanguard" && c.attachments === 1);
    if (pacifism === undefined || host === undefined) throw new Error("Pacifism and its host");
    expect(host.pileCount).toBeNull();
    expect(host.behind).toBe(false);
    expect(host.x - pacifism.x).toBeCloseTo(COMPACT.attach.peek * host.width, 5);
    // The twin, alone in its own pile, isn't under the Aura.
    const twin = m.cards.find((c) => c.name === "Elite Vanguard" && c.id !== host.id);
    if (twin === undefined) throw new Error("the twin");
    expect(twin.x >= host.x + host.width || twin.x + twin.width <= pacifism.x).toBe(true);
  });

  it("leaves the prompt in the table gap when an Aura sits on the other side's creature", () => {
    // The opponent's Pacifism moved onto the person's Llanowar Elves (the seat view edited to that).
    const llanowar = model.cards.find((c) => c.name === "Llanowar Elves")?.id as ObjectId;
    const pacifism = model.cards.find((c) => c.name === "Pacifism")?.id as ObjectId;
    const moved = structuredClone(shown) as SeatView;
    const aura = moved.seen[pacifism];
    if (aura?.kind !== "card") throw new Error("Pacifism");
    aura.attachedTo = llanowar;
    expect(boardModel(moved, PHONE).overlay.prompt).toEqual(model.overlay.prompt);
  });

  it("keeps an attachment's room when its host blocks: no other creature lands on the part that peeks out", () => {
    // Serra Angel (with Holy Strength) blocks the opponent's attacking Veteran Armorsmith (the view edited to that).
    const blocking = structuredClone(shown) as SeatView;
    const id = (name: string) => model.cards.find((c) => c.name === name)?.id as ObjectId;
    const armorsmith = blocking.seen[id("Veteran Armorsmith")];
    const angel = blocking.seen[id("Serra Angel")];
    if (armorsmith?.kind !== "card" || angel?.kind !== "card") throw new Error("the combatants");
    armorsmith.attacking = { attacked: { kind: "player", player: "p1" } };
    angel.blocking = [armorsmith.id];
    const m = boardModel(blocking, PHONE);
    const strength = m.cards.find((c) => c.name === "Holy Strength");
    const host = m.cards.find((c) => c.name === "Serra Angel");
    if (strength === undefined || host === undefined) throw new Error("Holy Strength and Serra Angel");
    expect(strength.y).toBe(host.y);
    const peek = { from: strength.x, to: host.x };
    for (const other of m.cards.filter((c) => c.mine && c.row === "creatures" && c.id !== host.id)) {
      if (other.id === strength.id) continue;
      // Another card's own attachment is drawn behind that card, so only cards in front count.
      const overlaps = other.x < peek.to - 0.5 && other.x + other.width > peek.from + 0.5;
      expect(overlaps, `${other.name} over Holy Strength`).toBe(false);
    }
  });

  it("follows its host when combat moves it", () => {
    const attached = attachedByHost(shown);
    const angel = named("Serra Angel");
    const stepped: BoardCard = { ...angel, attachments: 0, y: angel.y - 13 };
    const placed = withAttachments([stepped], attached, shown.player, COMPACT);
    expect(placed.find((c) => c.name === "Holy Strength")?.y).toBe(stepped.y);
  });
});
