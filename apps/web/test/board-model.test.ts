// The board model (ui.md, "Board structure"): where each card the person can see goes, tested without drawing. The
// compact layout follows the owner's phone screenshots (arena-research.md): creatures by the band across the middle,
// lands further out at the left in piles, the hand along the bottom, the opponent's hand as backs along the top.

import type { SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { type BoardCard, type BoardModel, boardModel, type Rect } from "../src/board-model/board-model.ts";
import { fixtureView, mulliganView } from "./fixture-views.ts";

const PHONE = { width: 812, height: 375 };
const midGame = fixtureView("mid-game");
const crowded = fixtureView("crowded");

const named = (model: BoardModel, name: string) => model.cards.filter((c) => c.name === name);
const centreY = (c: { y: number; height: number }) => c.y + c.height / 2;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function battlefieldIds(shown: SeatView): string[] {
  return shown.view.zones.battlefield.filter((id) => shown.seen[id]?.kind === "card");
}

describe("the compact board model", () => {
  it("draws every permanent and every card in the person's hand once, and no card of the opponent's hand", () => {
    for (const shown of [midGame, crowded]) {
      const model = boardModel(shown, PHONE);
      const drawn = model.cards.map((c) => c.id);
      expect(new Set(drawn).size).toBe(drawn.length);
      const hand = shown.view.zones.players.p1?.hand ?? [];
      expect(drawn.sort()).toEqual([...battlefieldIds(shown), ...hand].sort());
      // The opponent's hand is hidden (CR 402.3): only its size, as backs.
      expect(model.backs).toHaveLength(shown.view.zones.players.p2?.handSize ?? -1);
    }
  });

  it("puts each player's creatures by the band, theirs above it and the person's below", () => {
    const model = boardModel(midGame, PHONE);
    const band = centreY(model.band);
    for (const name of ["Elite Vanguard", "Veteran Armorsmith"])
      expect(centreY(named(model, name)[0] as BoardCard)).toBeLessThan(band);
    for (const name of ["Llanowar Elves", "Prodigal Pyromancer", "Deadly Recluse"]) {
      expect(centreY(named(model, name)[0] as BoardCard)).toBeGreaterThan(band);
    }
  });

  it("puts lands further from the band than creatures, at the left", () => {
    const model = boardModel(midGame, PHONE);
    const band = centreY(model.band);
    const distance = (c: BoardCard) => Math.abs(centreY(c) - band);
    const lands = model.cards.filter((c) => c.land && c.zone === "battlefield");
    const creatures = model.cards.filter((c) => c.zone === "battlefield" && c.power !== null);
    for (const land of lands) {
      for (const creature of creatures.filter((c) => c.mine === land.mine))
        expect(distance(land)).toBeGreaterThan(distance(creature));
      expect(land.x + land.width / 2).toBeLessThan(PHONE.width / 2);
    }
  });

  it("piles lands with the same name and state, the count on the front card", () => {
    const model = boardModel(midGame, PHONE);
    const forests = named(model, "Forest");
    expect(forests.map((c) => c.pileCount)).toEqual([null, 2]);
    // A tapped Mountain isn't piled with an untapped one.
    const mountains = named(model, "Mountain").filter((c) => c.zone === "battlefield");
    expect(mountains.map((c) => c.pileCount)).toEqual([null, null]);
    expect(mountains.map((c) => c.tapped).sort()).toEqual([false, true]);
  });

  it("tilts and dims a tapped permanent rather than turning it sideways [R]", () => {
    const model = boardModel(midGame, PHONE);
    const [tapped] = named(model, "Mountain").filter((c) => c.tapped);
    expect(tapped?.rotation).toBeGreaterThan(0);
    expect(tapped?.rotation).toBeLessThan(Math.PI / 8);
    expect(tapped?.alpha).toBeLessThan(1);
  });

  it("shows only the top of the person's hand, along the bottom centre, with each card's mana cost", () => {
    const model = boardModel(midGame, PHONE);
    const hand = model.cards.filter((c) => c.zone === "hand");
    expect(hand).toHaveLength(5);
    for (const card of hand) {
      expect(card.y).toBeGreaterThan(PHONE.height * 0.85);
      expect(card.x).toBeGreaterThan(PHONE.width * 0.25);
      expect(card.x + card.width).toBeLessThan(PHONE.width * 0.75);
    }
    expect(named(model, "Shivan Dragon")[0]?.manaCost).toEqual(["4", "R", "R"]);
    expect(named(model, "Mountain").find((c) => c.zone === "hand")?.manaCost).toEqual([]);
  });

  it("keeps a crowded board inside the screen and clear of the main button", () => {
    const model = boardModel(crowded, PHONE);
    for (const card of model.cards.filter((c) => c.zone === "battlefield")) {
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(PHONE.width);
      expect(card.y).toBeGreaterThanOrEqual(0);
      expect(card.y + card.height).toBeLessThanOrEqual(PHONE.height);
      if (card.mine) expect(overlaps(card, model.overlay.mainButton)).toBe(false);
    }
  });

  it("lays out inside the safe-area insets", () => {
    const insets = { top: 0, right: 44, bottom: 21, left: 44 };
    const model = boardModel(crowded, PHONE, insets);
    for (const card of model.cards.filter((c) => c.zone === "battlefield")) {
      expect(card.x).toBeGreaterThanOrEqual(insets.left);
      expect(card.x + card.width).toBeLessThanOrEqual(PHONE.width - insets.right);
    }
    const { mine, opponent } = model.overlay.portrait;
    expect(opponent.x).toBeGreaterThanOrEqual(insets.left);
    expect(mine.y + mine.height).toBeLessThanOrEqual(PHONE.height - insets.bottom);
    const button = model.overlay.mainButton;
    expect(button.x + button.width).toBeLessThanOrEqual(PHONE.width - insets.right);
  });

  it("puts the phase ladder over the main button on the person's turn and at the opponent's crest on theirs", () => {
    expect(boardModel(midGame, PHONE).overlay.ladderSide).toBe("mine");
    const theirs = boardModel(crowded, PHONE).overlay;
    expect(theirs.ladderSide).toBe("opponent");
    expect(theirs.ladder).toEqual(theirs.life.opponent);
  });

  it("counts each library", () => {
    const model = boardModel(midGame, PHONE);
    const mine = model.libraries.find((l) => l.mine);
    expect(mine?.count).toBe(midGame.view.zones.players.p1?.librarySize);
    expect(model.libraries.find((l) => !l.mine)?.count).toBe(midGame.view.zones.players.p2?.librarySize);
  });

  it("draws an opening hand of seven before the first turn", () => {
    expect(boardModel(mulliganView(), PHONE).cards.filter((c) => c.zone === "hand")).toHaveLength(7);
  });
});
