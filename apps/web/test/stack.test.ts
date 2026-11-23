// The whole stack at the right (M3-04c slice 6; arena-research.md §5): the top object large, the ones under it peeking
// out to its left, each its own card or ability panel; past a few, counted. Built by the test's own actions with full
// control on, so several objects wait on the stack (CR 405.1, 117.3c: the caster gets priority again).

import type { Action, ObjectId, SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { boardModel } from "../src/board-model/board-model.ts";
import { MOST_UNDER } from "../src/board-model/stack.ts";
import { stackLabels } from "../src/board-model/stack-labels.ts";
import type { Fixture } from "../src/fixtures/fixtures.ts";
import { cardDetails } from "../src/interaction/card-details.ts";
import { stackCards } from "../src/interaction/zones.ts";
import { COMPACT } from "../src/layout/compact.ts";
import { playFrom } from "./fixture-views.ts";

const PHONE = { width: 812, height: 375 };
const LIBRARY = ["Forest", "Forest", "Forest"];

const board = (hand: string[], extra: string[] = []): Fixture => ({
  turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
  players: {
    p1: {
      life: 20,
      hand,
      battlefield: [...Array(6).fill("Mountain"), "Forest", "Forest", "Prodigal Pyromancer", "Grizzly Bears", ...extra],
      library: LIBRARY,
    },
    p2: { life: 20, hand: [], battlefield: ["Plains", "Elite Vanguard"], library: LIBRARY },
  },
});

function idOf(shown: SeatView, name: string): ObjectId {
  const found = Object.values(shown.seen).find((o) => o.kind === "card" && o.characteristics.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found.id;
}

const targetsObject = (id: ObjectId) => (a: Action) =>
  a.type === "ANSWER" &&
  a.answer.kind === "chooseTarget" &&
  a.answer.target.kind === "object" &&
  a.answer.target.object === id;

/** Lightning Bolt at Elite Vanguard, Giant Growth on it in response, then Prodigal Pyromancer at the opponent. */
function threeOnTheStack(): SeatView {
  const m = playFrom(board(["Lightning Bolt", "Giant Growth"]));
  const start = m.shown();
  const vanguard = idOf(start, "Elite Vanguard");
  m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Lightning Bolt"), "cast Lightning Bolt");
  m.act(targetsObject(vanguard), "target Elite Vanguard");
  m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Giant Growth"), "cast Giant Growth");
  m.act(targetsObject(vanguard), "target Elite Vanguard");
  m.act((a) => a.type === "ACTIVATE_ABILITY" && a.object === idOf(start, "Prodigal Pyromancer"), "activate");
  return m.act(
    (a) =>
      a.type === "ANSWER" &&
      a.answer.kind === "chooseTarget" &&
      a.answer.target.kind === "player" &&
      a.answer.target.player === "p2",
    "target the opponent",
  );
}

describe("the stack", () => {
  const shown = threeOnTheStack();
  const stack = boardModel(shown, PHONE).cards.filter((c) => c.zone === "stack");

  it("draws every object, the deepest first, so the top covers the rest (CR 405.2: the last added is on top)", () => {
    expect(shown.view.zones.stack).toHaveLength(3);
    expect(stack.map((c) => c.id)).toEqual(shown.view.zones.stack);
    expect(stack.map((c) => c.name)).toEqual(["Lightning Bolt", "Giant Growth", "Prodigal Pyromancer"]);
  });

  it("puts the top at the right and each one under it a name strip higher, in the top's old place", () => {
    const [bolt, growth, top] = stack;
    if (bolt === undefined || growth === undefined || top === undefined) throw new Error("three");
    expect(top.x > PHONE.width / 2).toBe(true);
    expect(growth.y).toBeLessThan(top.y);
    expect(bolt.y).toBeLessThan(growth.y);
    // A readable name's height each, and no further left than the top: the stack covers no more board than before.
    expect(top.y - growth.y).toBeGreaterThanOrEqual(14);
    expect(new Set(stack.map((c) => c.x)).size).toBe(1);
    expect(new Set(stack.map((c) => c.height)).size).toBe(1);
    const block = { top: bolt.y, bottom: top.y + top.height };
    expect(block.bottom - block.top).toBeCloseTo(COMPACT.stack.h * PHONE.height, 5);
    // The whole stack a tap away, above it.
    const header = boardModel(shown, PHONE).overlay.stack?.header;
    expect(header?.y ?? 0).toBeLessThan(bolt.y);
  });

  // The owner: "when there's something on the stack to resolve, it's not immediately obvious that there's something on
  // the stack" (D-174).
  it("has its header from one object on, so a lone spell reads as the stack, and none when it's empty", () => {
    const one = structuredClone(shown);
    one.view.zones.stack = one.view.zones.stack.slice(-1);
    const model = boardModel(one, PHONE);
    const top = model.cards.find((c) => c.zone === "stack");
    if (top === undefined) throw new Error("one on the stack");
    expect(model.overlay.stack?.header.y ?? Number.POSITIVE_INFINITY).toBeLessThan(top.y);
    const empty = structuredClone(shown);
    empty.view.zones.stack = [];
    expect(boardModel(empty, PHONE).overlay.stack).toBeNull();
  });

  it("gives each object under the top a strip tall enough for its name in words (a row, D-174)", () => {
    for (const under of stack.slice(0, -1)) expect(under.shows?.height ?? 0).toBeGreaterThanOrEqual(20);
  });

  it("draws an ability as a panel: its source's name and art, its kind, its own text", () => {
    const top = stack.at(-1);
    expect(top?.ability).toBe(true);
    expect(top?.typeLine).toBe("Activated ability");
    expect(top?.text).toBe("{T}: This creature deals 1 damage to any target.");
    expect(top?.art).toMatch(/art_crop/);
    expect(stack[0]?.ability).toBe(false);
  });

  it("still draws an ability whose source has left, from its printed card", () => {
    const gone = structuredClone(shown);
    const top = gone.view.zones.stack.at(-1);
    const ability = top === undefined ? undefined : gone.seen[top];
    if (ability?.kind !== "ability") throw new Error("an ability on top");
    delete gone.seen[ability.source];
    const panel = boardModel(gone, PHONE).cards.find((c) => c.id === top);
    expect(panel?.name).toBe("Prodigal Pyromancer");
    expect(panel?.colors).toEqual([]);
  });

  it(`shows at most ${MOST_UNDER} under the top, the rest in the browser`, () => {
    const deep = structuredClone(shown);
    const extra = Array.from({ length: 4 }, (_, i) => `o-extra-${i}` as ObjectId);
    const bolt = deep.view.zones.stack[0];
    if (bolt === undefined) throw new Error("a stack");
    for (const id of extra) deep.seen[id] = { ...(deep.seen[bolt] as object), id } as SeatView["seen"][ObjectId];
    deep.view.zones.stack = [...extra, ...deep.view.zones.stack];
    const cards = boardModel(deep, PHONE).cards.filter((c) => c.zone === "stack");
    expect(cards).toHaveLength(MOST_UNDER + 1);
    expect(boardModel(deep, PHONE).overlay.stack).not.toBeNull();
    expect(stackCards(deep)).toHaveLength(7);
    expect(stackCards(deep)[0]?.name).toBe("Prodigal Pyromancer ability");
    // The top five are drawn, not the bottom five.
    expect(cards.map((c) => c.id)).toEqual(deep.view.zones.stack.slice(-(MOST_UNDER + 1)));
  });
});

describe("a stack object's card view", () => {
  const shown = threeOnTheStack();
  const [bolt, growth, ability] = shown.view.zones.stack;

  it("shows an ability's own panel, not only its source card", () => {
    const details = ability === undefined ? null : cardDetails(shown, ability);
    expect(details?.name).toBe("Prodigal Pyromancer");
    expect(details?.typeLine).toBe("Activated ability");
    expect(details?.oracleText).toBe("{T}: This creature deals 1 damage to any target.");
    expect(details?.image).toBeNull();
    expect(details?.art?.url).toMatch(/art_crop/);
    expect(details?.art?.artist).toBeTruthy();
  });

  it("names each object's targets (CR 601.2c), a player or a card, and what's under it", () => {
    const hanger = (id: ObjectId | undefined, title: string) =>
      (id === undefined ? null : cardDetails(shown, id))?.hangers.find((h) => h.title === title)?.text;
    expect(hanger(ability, "Target")).toBe("Your opponent");
    expect(hanger(bolt, "Target")).toBe("Elite Vanguard");
    expect(hanger(growth, "Target")).toBe("Elite Vanguard");
    expect(hanger(ability, "From")).toBe("Prodigal Pyromancer, on the battlefield");
  });

  it("says what X is for a spell with X (CR 107.3a)", () => {
    const m = playFrom(board(["Fireball"]));
    const start = m.shown();
    m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Fireball"), "cast Fireball");
    m.act((a) => a.type === "ANSWER" && a.answer.kind === "announceX" && a.answer.value === 2, "X = 2");
    let now = m.shown();
    // Fireball asks how many targets, then the target.
    if (now.view.decision?.kind === "chooseTargetCount")
      now = m.act((a) => a.type === "ANSWER" && a.answer.kind === "chooseTargetCount" && a.answer.count === 1, "one");
    now = m.act(targetsObject(idOf(start, "Elite Vanguard")), "target Elite Vanguard");
    const top = now.view.zones.stack.at(-1);
    const details = top === undefined ? null : cardDetails(now, top);
    expect(details?.hangers).toContainEqual({ title: "X", text: "2" });
    expect(details?.hangers).toContainEqual({ title: "Target", text: "Elite Vanguard" });
  });

  it("says how a divided effect is divided among its targets (CR 601.2d)", () => {
    const two = board(["Ignite Disorder"]);
    const m = playFrom({
      ...two,
      players: {
        ...two.players,
        p2: { ...two.players.p2, battlefield: ["Plains", "Elite Vanguard", "Veteran Armorsmith"] },
      },
    });
    const start = m.shown();
    m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Ignite Disorder"), "cast Ignite Disorder");
    m.act((a) => a.type === "ANSWER" && a.answer.kind === "chooseTargetCount" && a.answer.count === 2, "two targets");
    m.act(targetsObject(idOf(start, "Elite Vanguard")), "target Elite Vanguard");
    m.act(targetsObject(idOf(start, "Veteran Armorsmith")), "target Veteran Armorsmith");
    let now = m.shown();
    if (now.view.decision?.kind === "divide") {
      const divide = now.options.find((o) => o.action.type === "ANSWER" && o.action.answer.kind === "divide");
      if (divide === undefined) throw new Error("a division");
      now = m.act((a) => a === divide.action, "divide");
    }
    const top = now.view.zones.stack.at(-1);
    const divided = (top === undefined ? null : cardDetails(now, top))?.hangers.find((h) => h.title === "Targets");
    expect(divided?.text).toMatch(
      /^\d to (Elite Vanguard|Veteran Armorsmith), \d to (Elite Vanguard|Veteran Armorsmith)$/,
    );
  });

  it("names a target in a graveyard by whose graveyard it's in", () => {
    const m = playFrom({
      ...board(["Gravedigger"]),
      players: {
        ...board([]).players,
        p1: {
          ...board(["Gravedigger"]).players.p1,
          battlefield: [...Array(4).fill("Swamp")],
          graveyard: ["Grizzly Bears"],
        },
      },
    });
    const start = m.shown();
    m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Gravedigger"), "cast Gravedigger");
    // Gravedigger resolves (both pass), and its trigger goes on the stack targeting the only creature card there.
    let now = m.act((a) => a.type === "PASS_PRIORITY", "pass");
    if (now.view.decision?.kind === "chooseTarget")
      now = m.act((a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget", "target Grizzly Bears");
    const top = now.view.zones.stack.at(-1);
    const target = (top === undefined ? null : cardDetails(now, top))?.hangers.find((h) => h.title === "Target");
    expect(target?.text).toBe("Grizzly Bears, in your graveyard");
  });
});

describe("the stack while the person chooses", () => {
  it("is small at the right edge, the object under it peeking out too", () => {
    const m = playFrom(board(["Lightning Bolt", "Giant Growth"]));
    const start = m.shown();
    m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Giant Growth"), "cast Giant Growth");
    m.act(targetsObject(idOf(start, "Grizzly Bears")), "target Grizzly Bears");
    // Lightning Bolt is on the stack (CR 601.2a) while its target is chosen.
    const choosing = m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Lightning Bolt"), "cast Bolt");
    const stack = boardModel(choosing, PHONE).cards.filter((c) => c.zone === "stack");
    expect(stack.map((c) => c.name)).toEqual(["Giant Growth", "Lightning Bolt"]);
    const [under, top] = stack;
    // The whole stack fits the small block at the right edge, the one under the top peeking out above it.
    expect((top?.y ?? 0) + (top?.height ?? 0) - (under?.y ?? 0)).toBeLessThanOrEqual(112.001);
    expect((top?.x ?? 0) + (top?.width ?? 0)).toBeGreaterThan(PHONE.width - 20);
    expect(under?.y).toBeLessThan(top?.y ?? 0);
    // Small: a strip too short for a name keeps its card frame (no row); no ring competes with the targets being chosen;
    // the header still says it's the stack.
    const labels = boardModel(choosing, PHONE).overlay.stack;
    expect(under?.shows?.height).toBeGreaterThanOrEqual(14);
    expect(labels?.rows).toEqual([]);
    expect(labels?.ring).toBeNull();
    expect(labels?.tag).toBeNull();
    expect(labels?.header.width).toBeGreaterThanOrEqual(76);
  });
});

// D-174: where the stack's labels go (the HUD only places them).
describe("the stack's labels", () => {
  const shown = threeOnTheStack();
  const model = boardModel(shown, PHONE);
  const stack = model.cards.filter((c) => c.zone === "stack");
  const area = { x: 0, y: 0, ...PHONE };
  const labels = stackLabels(stack, [], area, false);
  const top = stack.at(-1);
  if (labels === null || top === undefined) throw new Error("labels for three objects");

  it("rings the top object clear of the card, the tag under the ring, the header above the deepest", () => {
    const ring = labels.ring?.rect;
    if (ring === undefined) throw new Error("a ring");
    expect(ring.x).toBeLessThan(top.x);
    expect(ring.x + ring.width).toBeGreaterThan(top.x + top.width);
    expect(labels.tag?.y ?? 0).toBeGreaterThanOrEqual(ring.y + ring.height);
    expect(labels.header.y + labels.header.height).toBeLessThanOrEqual(stack[0]?.y ?? 0);
    expect(labels.header.x + labels.header.width).toBeLessThanOrEqual(PHONE.width);
  });

  it("names each row under the top while large, and says whose only when both players have objects on it", () => {
    expect(labels.rows.map((r) => r.id)).toEqual(stack.slice(0, -1).map((c) => c.id));
    expect(labels.rowsSayWhose).toBe(false);
    const mixed = stack.map((c, i) => (i === 0 ? { ...c, mine: false } : c));
    expect(stackLabels(mixed, [], area, false)?.rowsSayWhose).toBe(true);
  });

  it("keeps whose the top is by its controller, not its owner (the card model's `mine`)", () => {
    const bolt = shown.view.zones.stack[0] as ObjectId;
    const theirs = structuredClone(shown);
    const seen = theirs.seen[bolt];
    if (seen?.kind !== "card") throw new Error("Lightning Bolt");
    seen.characteristics.controller = "p2";
    expect(boardModel(theirs, PHONE).cards.find((c) => c.id === bolt)?.mine).toBe(false);
  });

  it("stands the ring, tag and rows down where the open hand would sit on them; the header stays", () => {
    const covering = { ...top, zone: "hand" as const, y: top.y + top.height - 10 };
    const covered = stackLabels(stack, [covering], area, false);
    expect(covered?.ring).toBeNull();
    expect(covered?.tag).toBeNull();
    expect(covered?.rows).toEqual([]);
    expect(covered?.header).toEqual(labels.header);
  });

  it(`leaves the top object most of the block with ${MOST_UNDER} under it`, () => {
    const block = top.y + top.height - (stack[0]?.y ?? 0);
    expect(top.height / block).toBeGreaterThan(0.65);
  });
});
