// The stack's targets on the board (M3-04c slice 6b; arena-research.md: "a targeting arc is drawn as a glowing curve
// from the stack item to its target" [R]): an arrow from the top object to each target the board shows, the large
// card made small by a tap (Arena's collapse tab [R]), and a spell on the stack outlined as a counterspell's target.

import type { Action, ObjectId, SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { boardModel, NO_INSETS } from "../src/board-model/board-model.ts";
import { stackIsSmall } from "../src/board-model/stack.ts";
import type { Fixture } from "../src/fixtures/fixtures.ts";
import { controls } from "../src/interaction/controls.ts";
import { COMPACT } from "../src/layout/compact.ts";
import { playFrom } from "./fixture-views.ts";

const PHONE = { width: 812, height: 375 };
const LIBRARY = ["Island", "Island", "Island"];

const board: Fixture = {
  turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
  players: {
    p1: {
      life: 20,
      hand: ["Lightning Bolt", "Cancel"],
      battlefield: [...Array(3).fill("Mountain"), ...Array(3).fill("Island"), "Prodigal Pyromancer"],
      library: LIBRARY,
    },
    p2: { life: 20, hand: [], battlefield: ["Plains", "Elite Vanguard"], library: LIBRARY },
  },
};

function idOf(shown: SeatView, name: string): ObjectId {
  const found = Object.values(shown.seen).find((o) => o.kind === "card" && o.characteristics.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found.id;
}

const targets = (id: ObjectId) => (a: Action) =>
  a.type === "ANSWER" &&
  a.answer.kind === "chooseTarget" &&
  a.answer.target.kind === "object" &&
  a.answer.target.object === id;

function boltAtVanguard() {
  const m = playFrom(board);
  const start = m.shown();
  m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Lightning Bolt"), "cast Lightning Bolt");
  const shown = m.act(targets(idOf(start, "Elite Vanguard")), "target Elite Vanguard");
  return { m, start, shown };
}

const centre = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

describe("arrows from the top of the stack to its targets", () => {
  it("points from the top object to a creature it targets", () => {
    const { shown } = boltAtVanguard();
    const model = boardModel(shown, PHONE);
    const vanguard = model.cards.find((c) => c.name === "Elite Vanguard");
    const top = model.cards.filter((c) => c.zone === "stack").at(-1);
    if (vanguard === undefined || top === undefined) throw new Error("both drawn");
    expect(model.arrows).toHaveLength(1);
    expect(model.arrows[0]?.to).toEqual(centre(vanguard));
    // From the top object's left edge, toward the board.
    expect(model.arrows[0]?.from.x).toBeCloseTo(top.x, 5);
  });

  it("points at a player's info block when a player is the target", () => {
    const m = playFrom(board);
    const start = m.shown();
    m.act((a) => a.type === "ACTIVATE_ABILITY" && a.object === idOf(start, "Prodigal Pyromancer"), "activate");
    const shown = m.act(
      (a) =>
        a.type === "ANSWER" &&
        a.answer.kind === "chooseTarget" &&
        a.answer.target.kind === "player" &&
        a.answer.target.player === "p2",
      "target the opponent",
    );
    const model = boardModel(shown, PHONE);
    // At the block's edge facing the board, so its life total isn't under the arrowhead.
    const block = model.overlay.player.opponent;
    expect(model.arrows.map((a) => a.to)).toEqual([{ x: block.x + block.width, y: block.y + block.height / 2 }]);
  });

  it("draws none for an empty stack, or while the person is still choosing", () => {
    const m = playFrom(board);
    expect(boardModel(m.shown(), PHONE).arrows).toEqual([]);
    const start = m.shown();
    const choosing = m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Lightning Bolt"), "cast");
    expect(boardModel(choosing, PHONE).arrows).toEqual([]);
  });

  it("points at the part of an Aura that shows beside its host, not at the host (Naturalize at Pacifism)", () => {
    const m = playFrom({
      ...board,
      players: {
        p1: { ...board.players.p1, hand: ["Naturalize"], battlefield: [...Array(2).fill("Forest"), "Mountain"] },
        p2: { ...board.players.p2, battlefield: ["Plains", "Elite Vanguard", { card: "Pacifism", attachedTo: 1 }] },
      },
    });
    const start = m.shown();
    m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Naturalize"), "cast Naturalize");
    const shown = m.act(targets(idOf(start, "Pacifism")), "target Pacifism");
    const model = boardModel(shown, PHONE);
    const pacifism = model.cards.find((c) => c.name === "Pacifism");
    const host = model.cards.find((c) => c.name === "Elite Vanguard");
    if (pacifism?.shows == null || host === undefined) throw new Error("Pacifism beside Elite Vanguard");
    const to = model.arrows[0]?.to;
    expect(to).toEqual(centre(pacifism.shows));
    expect((to?.x ?? 0) < host.x).toBe(true);
  });

  it("points at a spell under the top at its strip's left edge, beside the stack, not across its face", () => {
    const { m, start } = boltAtVanguard();
    const bolt = m.shown().view.zones.stack.at(-1);
    m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Cancel"), "cast Cancel");
    const shown = m.act(targets(bolt as ObjectId), "target Lightning Bolt");
    const model = boardModel(shown, PHONE);
    const strip = model.cards.find((c) => c.id === bolt);
    if (strip?.shows == null) throw new Error("Lightning Bolt's strip under Cancel");
    expect(model.arrows).toHaveLength(1);
    expect(model.arrows[0]?.to).toEqual({ x: strip.x, y: strip.shows.y + strip.shows.height / 2 });
  });

  it("draws none to a target the board doesn't show: a card in a graveyard (Gravedigger)", () => {
    const m = playFrom({
      ...board,
      players: {
        ...board.players,
        p1: {
          ...board.players.p1,
          hand: ["Gravedigger"],
          battlefield: Array(4).fill("Swamp"),
          graveyard: ["Grizzly Bears"],
        },
      },
    });
    const start = m.shown();
    m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Gravedigger"), "cast Gravedigger");
    let shown = m.act((a) => a.type === "PASS_PRIORITY", "pass");
    if (shown.view.decision?.kind === "chooseTarget")
      shown = m.act((a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget", "target Grizzly Bears");
    expect(shown.seen[shown.view.zones.stack.at(-1) as ObjectId]?.kind).toBe("ability");
    expect(boardModel(shown, PHONE).arrows).toEqual([]);
  });
});

describe("the large stack, made small", () => {
  it("stays small only while the object it was made small for is on top", () => {
    const { m, start, shown } = boltAtVanguard();
    const bolt = shown.view.zones.stack.at(-1) ?? null;
    expect(stackIsSmall(shown, bolt)).toBe(true);
    expect(stackIsSmall(shown, null)).toBe(false);
    m.act((a) => a.type === "ACTIVATE_ABILITY" && a.object === idOf(start, "Prodigal Pyromancer"), "activate");
    const newTop = m.act(
      (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget" && a.answer.target.kind === "player",
      "target a player",
    );
    // A new object on top shows large again.
    expect(stackIsSmall(newTop, bolt)).toBe(false);
  });

  it("is small when the person shrinks it, where a second tap makes it large again", () => {
    const { shown } = boltAtVanguard();
    const large = boardModel(shown, PHONE)
      .cards.filter((c) => c.zone === "stack")
      .at(-1);
    const small = boardModel(shown, PHONE, NO_INSETS, { handOpen: false, stackSmall: true })
      .cards.filter((c) => c.zone === "stack")
      .at(-1);
    if (large === undefined || small === undefined) throw new Error("drawn");
    expect(large.height).toBeGreaterThan(COMPACT.stack.smallMaxH);
    expect(small.height).toBeLessThanOrEqual(COMPACT.stack.smallMaxH);
    // In the large one's top right corner: a second tap where the first was lands on it again.
    const tap = centre(large);
    expect(
      tap.x >= small.x && tap.x <= small.x + small.width && tap.y >= small.y && tap.y <= small.y + small.height,
    ).toBe(true);
  });
});

describe("a spell on the stack as a target", () => {
  it("is outlined as a target where it's drawn, and picked in the prompt by name (Cancel targets a spell, CR 115.1)", () => {
    const { m, start } = boltAtVanguard();
    const bolt = m.shown().view.zones.stack.at(-1);
    if (bolt === undefined) throw new Error("Lightning Bolt on the stack");
    const choosing = m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Cancel"), "cast Cancel");
    // Under Cancel it shows only a name strip: too small a tap, so the prompt has it.
    expect(controls(choosing, null).cards[bolt]).toBeUndefined();
    expect(controls(choosing, null).prompt?.choices.map((c) => c.label)).toContain("Target Lightning Bolt");
    const drawn = boardModel(choosing, PHONE).cards.find((c) => c.id === bolt);
    expect(drawn?.targetable).toBe(true);
  });
});
