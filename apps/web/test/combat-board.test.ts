// Combat on the board (board-model/combat.ts; ui.md "Attacks and blocks"), on the block fixture played through the
// worker's real session: the AI attacks, the person blocks, and the board shows who blocks whom by where they sit.

import type { Action, SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { type BoardCard, boardModel } from "../src/board-model/board-model.ts";
import { fixtureSetup } from "../src/fixtures/fixtures.ts";
import { COMPACT } from "../src/layout/compact.ts";
import { handle, type Session } from "../src/worker/match-session.ts";
import { boardView, cards } from "./fixture-views.ts";

const PHONE = { width: 812, height: 375 };

/**
 * Plays the block fixture to the person's declaration of blockers, declares the blocks `choose` picks one at a time,
 * and returns what the person is shown next.
 */
function blocked(choose: (shown: SeatView) => Action | undefined): SeatView {
  const setup = fixtureSetup("block");
  if (setup === null) throw new Error("no block fixture");
  let step = handle(null, { type: "startFrom", setup, human: "p1" }, cards);
  let declared = false;
  for (let i = 0; i < 40; i++) {
    if (step.reply.type !== "update") throw new Error(step.reply.message);
    const shown = step.reply.shown;
    let pick: Action | undefined;
    if (shown.view.decision?.kind === "declareBlockers") {
      declared = true;
      pick =
        choose(shown) ??
        shown.options.find((o) => o.action.type === "ANSWER" && o.action.answer.kind === "finishDeclaring")?.action;
    } else if (declared) {
      return shown;
    } else {
      // Until the AI has attacked, the person passes whenever they get priority.
      pick = shown.options.find((o) => o.action.type === "PASS_PRIORITY")?.action;
    }
    if (pick === undefined) throw new Error(`stuck at ${shown.view.decision?.kind}`);
    step = handle(step.session as Session, { type: "act", action: pick }, cards);
  }
  throw new Error("blocking never finished");
}

const nameOf = (shown: SeatView, id: string) => {
  const seen = shown.seen[id as keyof typeof shown.seen];
  return seen?.kind === "card" ? seen.characteristics.name : "";
};

/** The first block the options offer of `blocker` on `attacker`, unless that blocker already blocks. */
function block(blocker: string, attacker: string) {
  return (shown: SeatView) =>
    shown.options.find(
      (o) =>
        o.action.type === "ANSWER" &&
        o.action.answer.kind === "declareBlocker" &&
        nameOf(shown, o.action.answer.block.blocker) === blocker &&
        nameOf(shown, o.action.answer.block.attacker) === attacker,
    )?.action;
}

const overlapX = (a: BoardCard, b: BoardCard) => a.x < b.x + b.width && b.x < a.x + a.width;

describe("combat on the board", () => {
  it("steps attackers toward the band and sits a blocker under the attacker it blocks", () => {
    let done = false;
    const shown = blocked((s) => {
      if (done) return undefined;
      const pick = block("Deadly Recluse", "Serra Angel")(s);
      if (pick !== undefined) done = true;
      return pick;
    });
    const model = boardModel(shown, PHONE);
    const attackers = model.cards.filter((c) => c.attacking);
    expect(attackers.length).toBeGreaterThan(0);
    const angel = model.cards.find((c) => c.name === "Serra Angel");
    // The Recluse has reach (CR 702.17b), so it can block the flying Angel.
    const recluse = model.cards.find((c) => c.name === "Deadly Recluse");
    expect(angel?.attacking).toBe(true);
    expect(recluse?.blocking).toEqual([angel?.id]);
    expect(overlapX(recluse as BoardCard, angel as BoardCard)).toBe(true);
    // Under its attacker, the pairing needs no line.
    expect(model.links).toEqual([]);
    // An attacker steps toward the band: the opponent's creature row rests with its bottom edge on the open table's
    // top edge, and the attacking Angel's is lower by exactly the layout's step.
    const step = COMPACT.combat.advance * PHONE.height;
    expect((angel?.y ?? 0) + (angel?.height ?? 0)).toBeCloseTo(model.band.y + step, 5);
  });

  it("huddles the blockers of one attacker together under it", () => {
    const gang = ["Llanowar Elves", "Stampeding Rhino"];
    let next = 0;
    const shown = blocked((s) => {
      const name = gang[next];
      if (name === undefined) return undefined;
      const pick = block(name, "Siege Mastodon")(s);
      if (pick !== undefined) next += 1;
      return pick;
    });
    const model = boardModel(shown, PHONE);
    const mastodon = model.cards.find((c) => c.name === "Siege Mastodon") as BoardCard;
    const blockers = model.cards.filter((c) => c.blocking.includes(mastodon.id));
    expect(blockers.map((c) => c.name).sort()).toEqual([...gang].sort());
    for (const b of blockers) expect(overlapX(b, mastodon)).toBe(true);
  });
});

describe("a declaration under way", () => {
  const LIBRARY = Array.from({ length: 20 }, () => "Forest");
  const board = boardView({
    turn: { number: 6, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: {
        life: 20,
        hand: ["Lightning Bolt"],
        battlefield: ["Mountain", ...Array.from({ length: 3 }, () => "Llanowar Elves")],
        library: LIBRARY,
      },
      p2: {
        life: 20,
        hand: [],
        battlefield: ["Siege Mastodon", { card: "Garruk Wildspeaker", counters: { loyalty: 3 } }],
        library: LIBRARY,
      },
    },
  });
  const ids = (name: string) => board.view.zones.battlefield.filter((id) => nameOf(board, id) === name);
  const elves = ids("Llanowar Elves");
  const [mastodon] = ids("Siege Mastodon");
  const [garruk] = ids("Garruk Wildspeaker");
  const declaring = (decision: object): SeatView => ({
    ...board,
    view: { ...board.view, decision: decision as SeatView["view"]["decision"] },
  });

  it("takes a picked attacker out of its pile, alone, with a link to the planeswalker it attacks", () => {
    const picked = elves[1] as string;
    const model = boardModel(
      declaring({ kind: "declareAttackers", chosen: [{ attacker: picked, defender: "p2", attacked: garruk }] }),
      PHONE,
    );
    const shown = model.cards.filter((c) => c.name === "Llanowar Elves");
    const attacker = shown.find((c) => c.id === picked);
    expect(attacker).toMatchObject({ attacking: true, picked: true, behind: false, pileCount: null, pileOf: picked });
    // The two left behind still make a pile of two.
    expect(shown.filter((c) => c.id !== picked).map((c) => c.pileCount)).toContain(2);
    expect(model.links).toEqual([expect.objectContaining({ kind: "attack" })]);
  });

  it("takes a picked blocker out of its pile and sits it under its attacker, alone", () => {
    const picked = elves[0] as string;
    const model = boardModel(
      declaring({ kind: "declareBlockers", chosen: [{ blocker: picked, attacker: mastodon }] }),
      PHONE,
    );
    const blockers = model.cards.filter((c) => c.blocking.length > 0);
    expect(blockers.map((c) => c.id)).toEqual([picked]);
    const target = model.cards.find((c) => c.id === mastodon) as BoardCard;
    expect(overlapX(blockers[0] as BoardCard, target)).toBe(true);
    // While blockers are being chosen, a beam joins the pick to its attacker [R].
    expect(model.links).toEqual([expect.objectContaining({ kind: "block" })]);
    // The rest of the pile isn't under the Mastodon, and is still a pile of two.
    const rest = model.cards.filter((c) => c.name === "Llanowar Elves" && c.id !== picked);
    expect(rest.map((c) => c.pileCount)).toContain(2);
    for (const c of rest) expect(overlapX(c, target)).toBe(false);
  });
});
