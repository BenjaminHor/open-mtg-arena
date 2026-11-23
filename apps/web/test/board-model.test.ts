// The board model (ui.md, "Board structure"): where each card the person can see goes, tested without drawing. The
// compact layout follows the owner's phone screenshots (arena-research.md): creatures by the band across the middle,
// lands further out at the left in piles, the hand along the bottom, the opponent's hand as backs along the top.

import type { SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { type BoardCard, type BoardModel, boardModel, type Rect } from "../src/board-model/board-model.ts";
import { COMPACT } from "../src/layout/compact.ts";
import { boardView, fixtureView, mulliganView } from "./fixture-views.ts";

const PHONE = { width: 812, height: 375 };
const midGame = fixtureView("mid-game");
const crowded = fixtureView("crowded");

const LIBRARY = Array.from({ length: 20 }, () => "Forest");
/** Every land in the pool, untapped and tapped: twenty-four piles a side, far more than fit. */
const LAND_NAMES = [
  "Dragonskull Summit",
  "Drowned Catacomb",
  "Forest",
  "Gargoyle Castle",
  "Glacial Fortress",
  "Island",
  "Mountain",
  "Plains",
  "Rootbound Crag",
  "Sunpetal Grove",
  "Swamp",
  "Terramorphic Expanse",
];
const manyLands = LAND_NAMES.flatMap((card) => [card, { card, tapped: true }]);
function manyPiles(activePlayer: "p1" | "p2") {
  return boardView({
    turn: { number: 9, activePlayer, step: "precombatMain" },
    players: {
      p1: {
        life: 20,
        hand: [],
        battlefield: [...manyLands, { card: "Garruk Wildspeaker", counters: { loyalty: 3 } }, "Howling Mine"],
        library: LIBRARY,
      },
      p2: {
        life: 20,
        hand: [],
        battlefield: [...manyLands, { card: "Ajani Goldmane", counters: { loyalty: 4 } }, "Honor of the Pure"],
        library: LIBRARY,
      },
    },
  });
}

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
      // The stack's top is drawn too, large at the right (stack.ts); this counts the battlefield and the hand.
      const drawn = model.cards.filter((c) => c.zone !== "stack").map((c) => c.id);
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
    expect(tapped?.dim).toBeGreaterThan(0);
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

  it("keeps every permanent clear of the HUD: portraits, life crests, the phase ladder, the main button", () => {
    for (const shown of [midGame, crowded, manyPiles("p1"), manyPiles("p2")]) {
      const model = boardModel(shown, PHONE);
      const { portrait, life, mainButton, ladder, opponentLadder } = model.overlay;
      const hud = [
        portrait.mine,
        portrait.opponent,
        life.mine,
        life.opponent,
        mainButton,
        ...ladder.pills,
        ...(opponentLadder?.pills ?? []),
      ];
      for (const card of model.cards.filter((c) => c.zone === "battlefield")) {
        for (const piece of hud)
          expect(overlaps(card, piece), `${card.name} under the HUD at ${piece.x},${piece.y}`).toBe(false);
      }
    }
  });

  it("doesn't pile a land with counters, or one something is attached to", () => {
    const model = boardModel(
      boardView({
        turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
        players: {
          p1: {
            life: 20,
            hand: [],
            battlefield: [
              "Island",
              "Island",
              { card: "Island", counters: { charge: 1 } },
              "Island",
              { card: "Convincing Mirage", attachedTo: 3, chosenLandType: "Swamp" },
            ],
            library: LIBRARY,
          },
          p2: { life: 20, hand: [], battlefield: [], library: LIBRARY },
        },
      }),
      PHONE,
    );
    const islands = named(model, "Island");
    // Two plain Islands pile; the one with a counter and the enchanted one (now a Swamp in type only) stand alone.
    expect(islands.map((c) => c.pileCount).filter((n) => n !== null)).toEqual([2]);
    expect(islands).toHaveLength(4);
    const xs = new Set(islands.map((c) => Math.round(c.x)));
    expect(xs.size).toBeGreaterThanOrEqual(3);
  });

  it("puts planeswalkers last in the outer row, at the right", () => {
    const model = boardModel(manyPiles("p1"), PHONE);
    const garruk = named(model, "Garruk Wildspeaker")[0];
    const mine = named(model, "Howling Mine")[0];
    expect(garruk?.x).toBeGreaterThan(mine?.x ?? Number.POSITIVE_INFINITY);
  });

  it("keeps a big hand inside its strip", () => {
    const hand = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? "Forest" : "Lightning Bolt"));
    const model = boardModel(
      boardView({
        turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
        players: {
          p1: { life: 20, hand, battlefield: [], library: LIBRARY },
          p2: { life: 20, hand: [], battlefield: [], library: LIBRARY },
        },
      }),
      PHONE,
    );
    const cards = model.cards.filter((c) => c.zone === "hand");
    expect(cards).toHaveLength(12);
    for (const card of cards) {
      expect(card.x).toBeGreaterThanOrEqual(PHONE.width * COMPACT.hand.left - 0.01);
      expect(card.x + card.width).toBeLessThanOrEqual(PHONE.width * COMPACT.hand.right + 0.01);
    }
  });

  it("parts the hand around the life crest, so no card hides under it, and fits each cost to its card's strip", () => {
    const model = boardModel(crowded, PHONE);
    const crest = model.overlay.life.mine;
    const hand = model.cards.filter((c) => c.zone === "hand").sort((a, b) => a.x - b.x);
    hand.forEach((card, i) => {
      const next = hand[i + 1];
      const stripEnd = next === undefined ? card.x + card.width : next.x;
      // Some of each card's strip shows outside the crest.
      const shows = Math.max(0, crest.x - card.x) + Math.max(0, stripEnd - (crest.x + crest.width));
      expect(shows, card.name).toBeGreaterThan(10);
      expect(card.costRadius).toBeGreaterThanOrEqual(COMPACT.hand.minCost);
    });
  });

  it("puts a small hand either side of the life crest", () => {
    const small = boardModel(
      boardView({
        turn: { number: 9, activePlayer: "p1", step: "precombatMain" },
        players: {
          p1: { life: 20, hand: ["Lightning Bolt", "Giant Growth"], battlefield: ["Mountain"], library: LIBRARY },
          p2: { life: 20, hand: [], battlefield: [], library: LIBRARY },
        },
      }),
      PHONE,
    );
    const crest = small.overlay.life.mine;
    const hand = small.cards.filter((c) => c.zone === "hand");
    expect(hand.some((c) => c.x + c.width / 2 < crest.x)).toBe(true);
    expect(hand.some((c) => c.x > crest.x + crest.width)).toBe(true);
  });

  it("keeps the person's outer row above the hand's floating costs", () => {
    for (const shown of [midGame, crowded, manyPiles("p1")]) {
      const model = boardModel(shown, PHONE);
      const hand = model.cards.filter((c) => c.zone === "hand");
      const costsTop = Math.min(...hand.map((c) => c.y - 2 * c.costRadius - 2));
      for (const card of model.cards.filter((c) => c.zone === "battlefield" && c.mine)) {
        expect(card.y + card.height, card.name).toBeLessThanOrEqual(costsTop);
      }
    }
  });

  it("piles identical creatures with a count, as Arena piles tokens", () => {
    const model = boardModel(crowded, PHONE);
    const vanguards = named(model, "Elite Vanguard");
    expect(vanguards.map((c) => c.pileCount)).toEqual([null, 2]);
    expect(vanguards.map((c) => c.behind)).toEqual([true, false]);
  });

  it("shrinks a crowded creature row before it overlaps", () => {
    // Nine creatures that can't pile: each has a different number of +1/+1 counters.
    const names = ["Grizzly Bears", "Hill Giant", "Gray Ogre"];
    const creatures = Array.from({ length: 9 }, (_, i) => ({
      card: names[i % 3] as string,
      counters: { "+1/+1": i + 1 },
    }));
    const model = boardModel(
      boardView({
        turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
        players: {
          p1: { life: 20, hand: [], battlefield: creatures, library: LIBRARY },
          p2: { life: 20, hand: [], battlefield: [], library: LIBRARY },
        },
      }),
      PHONE,
    );
    const row = model.cards.filter((c) => c.zone === "battlefield").sort((a, b) => a.x - b.x);
    expect(row).toHaveLength(9);
    expect(row[0]?.height).toBeLessThan(COMPACT.creatures.h * PHONE.height);
    row.slice(1).forEach((card, i) => {
      expect(card.x).toBeGreaterThanOrEqual((row[i]?.x ?? 0) + (row[i]?.width ?? 0));
    });
  });

  it("keeps each land slot in place when one of its lands taps", () => {
    const board = (tapped: boolean) =>
      boardModel(
        boardView({
          turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
          players: {
            p1: {
              life: 20,
              // A spell to cast, so the person stops in this main phase rather than auto-pass on to a later turn.
              hand: ["Lightning Bolt"],
              battlefield: [
                { card: "Forest", tapped },
                "Forest",
                "Forest",
                "Mountain",
                { card: "Mountain", tapped: true },
                "Swamp",
              ],
              library: LIBRARY,
            },
            p2: { life: 20, hand: [], battlefield: [], library: LIBRARY },
          },
        }),
        PHONE,
      );
    const swampX = (tapped: boolean) => named(board(tapped), "Swamp")[0]?.x;
    // Untapped Forests and a tapped one share a slot: tapping one Forest moves nothing after it.
    const withTapped = board(true);
    expect(swampX(true)).toBeDefined();
    expect(withTapped.cards.filter((c) => c.name === "Forest" && c.pileCount !== null).map((c) => c.pileCount)).toEqual(
      [2],
    );
    expect(swampX(false)).toBeCloseTo(swampX(true) as number, 5);
    // The tapped Forest sits on top of the pile (the owner, ui.md "Tapped lands in a pile"): drawn after every
    // untapped one, so it's in front.
    const order = withTapped.cards.filter((c) => c.name === "Forest").map((c) => c.tapped);
    expect(order).toEqual([false, false, true]);
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

  it("puts the turn's ladder over the main button, and the opponent's around their crest on their turn", () => {
    const mine = boardModel(midGame, PHONE).overlay;
    expect(mine.ladder.icons.map((i) => i.icon)).toEqual(["cap", "card", "swords", "card", "cap"]);
    expect(mine.ladder.icons.filter((i) => i.lit).map((i) => i.key)).toEqual(["main1"]);
    for (const icon of mine.ladder.icons) expect(icon.rect.y + icon.rect.height).toBeLessThanOrEqual(mine.mainButton.y);
    expect(mine.opponentLadder).toBeNull();
    const theirs = boardModel(crowded, PHONE).overlay;
    const crest = theirs.life.opponent;
    const around = theirs.opponentLadder?.icons ?? [];
    // Two rungs each side of the crest, none under it: the crest is the combat rung.
    expect(around.map((i) => i.key)).toEqual(["beginning", "main1", "main2", "end"]);
    expect(around.slice(0, 2).every((i) => i.rect.x + i.rect.width <= crest.x)).toBe(true);
    expect(around.slice(2).every((i) => i.rect.x >= crest.x + crest.width)).toBe(true);
    expect(theirs.opponentInCombat).toBe(false);
  });

  it("opens combat into its steps on the ladder during combat", () => {
    const turn = midGame.view.turn;
    if (turn === null) throw new Error("no turn");
    const blocking: SeatView = { ...midGame, view: { ...midGame.view, turn: { ...turn, step: "declareBlockers" } } };
    const ladder = boardModel(blocking, PHONE).overlay.ladder;
    expect(ladder.icons.map((i) => i.icon)).toEqual(["cap", "card", "sword", "shield", "burst", "cap", "card", "cap"]);
    expect(ladder.icons.filter((i) => i.lit).map((i) => i.key)).toEqual(["blockers"]);
    const theirs: SeatView = {
      ...midGame,
      view: { ...midGame.view, turn: { ...turn, step: "declareBlockers", activePlayer: "p2" } },
    };
    expect(boardModel(theirs, PHONE).overlay.opponentInCombat).toBe(true);
  });

  it("outlines what the person can play now, from the options, and not lands for their mana", () => {
    const model = boardModel(midGame, PHONE);
    const lit = (name: string, zone: BoardCard["zone"]) =>
      model.cards.find((c) => c.name === name && c.zone === zone)?.playable;
    // In hand: the land drop and the spells their lands can pay for.
    expect(lit("Mountain", "hand")).toBe(true);
    expect(lit("Lightning Bolt", "hand")).toBe(true);
    expect(lit("Shivan Dragon", "hand")).toBe(false);
    // On the battlefield: the Pyromancer's ping, but not the lands or the Elves for their mana.
    expect(lit("Prodigal Pyromancer", "battlefield")).toBe(true);
    expect(lit("Forest", "battlefield")).toBe(false);
    expect(lit("Llanowar Elves", "battlefield")).toBe(false);
    // Nothing of the opponent's.
    expect(model.cards.some((c) => !c.mine && c.playable)).toBe(false);
  });

  it("shows what's on top of the stack, large at the right: an ability as the card it came from", () => {
    const top = crowded.view.zones.stack.at(-1);
    const stack = boardModel(crowded, PHONE).cards.filter((c) => c.zone === "stack");
    expect(stack.map((c) => c.id)).toEqual(top === undefined ? [] : [top]);
    if (top !== undefined) {
      expect(stack[0]?.name).toBe("Ajani Goldmane ability");
      expect((stack[0]?.x ?? 0) > PHONE.width / 2).toBe(true);
    }
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
