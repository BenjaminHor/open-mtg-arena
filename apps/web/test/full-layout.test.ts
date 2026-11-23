// The full layout (M3-05, D-176): the unfolded phone (nearly square, either way up), tablets and desktop. The layout is
// picked by the screen's size alone, and the board's invariants hold at every size it's picked for: everything on
// screen, permanents clear of the HUD and of each other's rows, the hand in its strip, the stack clear of the controls.

import type { SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { type BoardModel, boardModel, type Rect } from "../src/board-model/board-model.ts";
import { FULL } from "../src/layout/full.ts";
import { FULL_FROM_HEIGHT, layoutFor } from "../src/layout/layout-for.ts";
import { boardView, fixtureView } from "./fixture-views.ts";

const LIBRARY = Array.from({ length: 20 }, () => "Forest");
const LANDS = [
  "Forest",
  "Island",
  "Mountain",
  "Plains",
  "Swamp",
  "Rootbound Crag",
  "Glacial Fortress",
  "Gargoyle Castle",
];
const manyLands = LANDS.flatMap((card) => [card, { card, tapped: true }]);
const manyPiles = boardView({
  turn: { number: 9, activePlayer: "p2", step: "precombatMain" },
  players: {
    p1: { life: 20, hand: ["Forest"], battlefield: [...manyLands, "Howling Mine"], library: LIBRARY },
    p2: { life: 20, hand: [], battlefield: [...manyLands, "Honor of the Pure"], library: LIBRARY },
  },
});
const BOARDS: [string, SeatView][] = [
  ["mid-game", fixtureView("mid-game")],
  ["crowded", fixtureView("crowded")],
  ["many lands", manyPiles],
];

/** The folded phone in landscape (the owner's, and others), then the full layout's screens. */
const COMPACT_SIZES = [
  { width: 812, height: 375 },
  { width: 667, height: 375 },
  { width: 932, height: 430 },
];
const FULL_SIZES = [
  { width: 1000, height: 860 },
  { width: 860, height: 1000 },
  { width: 700, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 1000, height: FULL_FROM_HEIGHT },
];

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const label = (s: { width: number; height: number }) => `${s.width}x${s.height}`;

describe("which layout a screen gets", () => {
  it("gives a phone in landscape the compact layout, and every taller screen the full one", () => {
    for (const size of COMPACT_SIZES) expect(layoutFor(size).name, label(size)).toBe("compact");
    for (const size of FULL_SIZES) expect(layoutFor(size).name, label(size)).toBe("full");
  });
});

describe.each(FULL_SIZES.map((size) => [label(size), size] as const))("the full layout at %s", (_, size) => {
  const models: [string, BoardModel][] = BOARDS.map(([name, shown]) => [
    name,
    boardModel(shown, size, undefined, undefined, FULL),
  ]);
  const permanents = (model: BoardModel) => model.cards.filter((c) => c.zone === "battlefield");

  it("keeps every permanent on screen and clear of the HUD", () => {
    for (const [name, model] of models) {
      const { player, mainButton, ladder, opponentLadder } = model.overlay;
      const hud = [player.mine, player.opponent, mainButton, ...ladder.pills, ...(opponentLadder?.pills ?? [])];
      for (const card of permanents(model)) {
        expect(card.x, `${name}: ${card.name}`).toBeGreaterThanOrEqual(0);
        expect(card.x + card.width, `${name}: ${card.name}`).toBeLessThanOrEqual(size.width);
        expect(card.y, `${name}: ${card.name}`).toBeGreaterThanOrEqual(0);
        expect(card.y + card.height, `${name}: ${card.name}`).toBeLessThanOrEqual(size.height);
        for (const piece of hud) expect(overlaps(card, piece), `${name}: ${card.name} under the HUD`).toBe(false);
      }
    }
  });

  it("keeps each half's rows apart: the outer row, then the creatures, then the band", () => {
    for (const [name, model] of models) {
      for (const mine of [true, false]) {
        const half = permanents(model).filter((c) => c.mine === mine);
        const creatures = half.filter((c) => c.row === "creatures");
        const outer = half.filter((c) => c.row !== "creatures");
        if (creatures.length === 0 || outer.length === 0) continue;
        if (mine) {
          const creaturesBottom = Math.max(...creatures.map((c) => c.y + c.height));
          expect(Math.min(...outer.map((c) => c.y)), name).toBeGreaterThanOrEqual(creaturesBottom);
        } else {
          const creaturesTop = Math.min(...creatures.map((c) => c.y));
          expect(Math.max(...outer.map((c) => c.y + c.height)), name).toBeLessThanOrEqual(creaturesTop);
        }
      }
    }
  });

  it("keeps the hand in its strip, below the person's outer row and its floating costs", () => {
    for (const [name, model] of models) {
      const hand = model.cards.filter((c) => c.zone === "hand");
      for (const card of hand) {
        expect(card.x, name).toBeGreaterThanOrEqual(size.width * FULL.hand.left - 0.01);
        expect(card.x + card.width, name).toBeLessThanOrEqual(size.width * FULL.hand.right + 0.01);
      }
      if (hand.length === 0) continue;
      const costsTop = Math.min(...hand.map((c) => c.y - 2 * c.costRadius - 2));
      for (const card of permanents(model).filter((c) => c.mine))
        expect(card.y + card.height, `${name}: ${card.name}`).toBeLessThanOrEqual(costsTop);
    }
  });

  it("keeps the stack on screen and clear of the main button and the ladder", () => {
    const [, model] = models[1] ?? [];
    const stack = model?.cards.filter((c) => c.zone === "stack") ?? [];
    expect(stack.length).toBeGreaterThan(0);
    for (const card of stack) {
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(size.width);
      expect(card.y + card.height).toBeLessThanOrEqual(size.height);
      for (const piece of [model?.overlay.mainButton, ...(model?.overlay.ladder.pills ?? [])])
        if (piece !== undefined) expect(overlaps(card, piece)).toBe(false);
    }
  });

  it("names its layout, for the test hook", () => {
    expect(models[0]?.[1].layout).toBe("full");
  });
});

// Each behaviour the full layout added has its own test (code review: removing any of them once passed every test).
describe("the full layout's own rules", () => {
  const [, crowded] = BOARDS[1] ?? [];
  if (crowded === undefined) throw new Error("the crowded board");
  const at = (shown: SeatView, size: { width: number; height: number }) =>
    boardModel(shown, size, undefined, undefined, FULL);

  it("shrinks a land row too wide for its space before it overlaps (as creatures do), and not one that fits", () => {
    const size = { width: 1280, height: 720 };
    const full = FULL.lands.h * Math.min(size.height, FULL.cardBasis * size.width);
    const lands = (shown: SeatView) => at(shown, size).cards.filter((c) => c.row === "lands");
    for (const land of lands(manyPiles)) expect(land.height).toBeLessThan(full);
    const [, midGame] = BOARDS[0] ?? [];
    for (const land of lands(midGame as SeatView)) expect(land.height).toBeCloseTo(full, 5);
  });

  it("starts the opponent's lands at the left edge when they're below their info block, not beside it", () => {
    const size = { width: 1024, height: 768 };
    const model = at(manyPiles, size);
    const theirs = model.cards.filter((c) => c.row === "lands" && !c.mine);
    const info = model.overlay.player.opponent;
    expect(Math.min(...theirs.map((c) => c.x))).toBeLessThan(info.x + info.width);
    for (const land of theirs) expect(overlaps(land, info)).toBe(false);
  });

  it("sizes cards from the width on a screen tall for its width, and caps the stack's width", () => {
    const size = { width: 860, height: 1000 };
    const [, midGame] = BOARDS[0] ?? [];
    const creature = at(midGame as SeatView, size).cards.find((c) => c.row === "creatures");
    expect(creature?.height ?? 0).toBeCloseTo(FULL.creatures.h * FULL.cardBasis * size.width, 5);
    for (const card of at(crowded, size).cards.filter((c) => c.zone === "stack"))
      expect(card.width).toBeLessThanOrEqual(FULL.stack.maxW * size.width + 0.01);
  });

  it("ends a crowded creature row clear of the stack's column, a short one centred", () => {
    for (const size of FULL_SIZES) {
      const creatures = at(crowded, size).cards.filter((c) => c.row === "creatures");
      for (const card of creatures)
        expect(card.x + card.width, label(size)).toBeLessThanOrEqual(FULL.creatures.right * size.width + 0.01);
    }
    const [, midGame] = BOARDS[0] ?? [];
    const mine = at(midGame as SeatView, { width: 1280, height: 720 }).cards.filter(
      (c) => c.row === "creatures" && c.mine,
    );
    const middle = (Math.min(...mine.map((c) => c.x)) + Math.max(...mine.map((c) => c.x + c.width))) / 2;
    expect(Math.abs(middle - 640)).toBeLessThan(1);
  });
});

// The phone's lands keep clear of the person's info block however deep a pile is (code review: a deep pile reached
// into it on a large phone with a bottom inset).
describe("the compact layout's lands and the info blocks", () => {
  const deep = boardView({
    turn: { number: 9, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: {
        life: 20,
        hand: ["Forest"],
        battlefield: [...Array(8).fill("Forest"), { card: "Forest", tapped: true }],
        library: LIBRARY,
      },
      p2: { life: 20, hand: [], battlefield: Array(8).fill("Plains"), library: LIBRARY },
    },
  });
  it("keeps a deep pile clear of the info block on large phones, a bottom inset included", () => {
    for (const [size, bottom] of [
      [{ width: 915, height: 400 }, 21],
      [{ width: 915, height: 412 }, 21],
      [{ width: 932, height: 430 }, 21],
      [{ width: 812, height: 375 }, 0],
    ] as const) {
      const model = boardModel(deep, size, { top: 0, right: 0, bottom, left: 0 });
      expect(model.layout).toBe("compact");
      for (const card of model.cards.filter((c) => c.zone === "battlefield"))
        for (const info of [model.overlay.player.mine, model.overlay.player.opponent])
          expect(overlaps(card, info), `${label(size)}: ${card.name}`).toBe(false);
    }
  });
});
