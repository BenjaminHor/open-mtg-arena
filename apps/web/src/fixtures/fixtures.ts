// Fixture boards (M3-04a): matches that start from a hand-built position instead of a mulligan, for the layout tests
// and the screenshots shown to the owner. Written with card names, as the golden games are (D-082), and turned into
// oracle ids from the pool. `?fixture=<name>` in the address starts one.

import { POOL } from "@mtg/cards/pool";
import type { BasicLandType, GameSetup, OracleId, PermanentSetup, PlayerId, PlayerSetup, Turn } from "@mtg/engine";

/**
 * A permanent by name, or with its state. `attachedTo` is the index, in the same player's battlefield, of the
 * permanent it's attached to (an Aura or Equipment).
 */
export type Permanent =
  | string
  | {
      card: string;
      tapped?: boolean;
      sick?: boolean;
      damage?: number;
      counters?: Record<string, number>;
      attachedTo?: number;
      chosenLandType?: BasicLandType;
    };
export type Side = { life: number; hand: string[]; battlefield: Permanent[]; graveyard?: string[]; library: string[] };
export type Fixture = { turn: Turn; players: { p1: Side; p2: Side } };

const ID_BY_NAME = new Map<string, OracleId>(POOL.cards.map((c) => [c.name, c.oracleId]));

function id(name: string): OracleId {
  const found = ID_BY_NAME.get(name);
  if (found === undefined) throw new Error(`no card named "${name}" in the pool`);
  return found;
}

function many(card: string, count: number): string[] {
  return Array.from({ length: count }, () => card);
}

const FIXTURES: Record<string, Fixture> = {
  /** Turn 5, the person's first main phase: a few lands, a few creatures each, a hand of five. */
  "mid-game": {
    turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: {
        life: 17,
        hand: ["Lightning Bolt", "Stampeding Rhino", "Giant Growth", "Mountain", "Shivan Dragon"],
        battlefield: [
          "Forest",
          "Forest",
          "Mountain",
          { card: "Mountain", tapped: true },
          "Llanowar Elves",
          "Prodigal Pyromancer",
          { card: "Deadly Recluse", sick: true },
        ],
        graveyard: ["Shock"],
        library: [...many("Forest", 10), ...many("Mountain", 10)],
      },
      p2: {
        life: 14,
        hand: ["Pacifism", "Serra Angel", "Plains", "Holy Strength"],
        battlefield: [
          "Plains",
          "Plains",
          "Plains",
          { card: "Plains", tapped: true },
          "Elite Vanguard",
          "Veteran Armorsmith",
          "Honor of the Pure",
        ],
        library: many("Plains", 20),
      },
    },
  },
  /** Turn 11, the opponent's turn: full boards, several land piles, artifacts, enchantments and planeswalkers. */
  crowded: {
    turn: { number: 11, activePlayer: "p2", step: "precombatMain" },
    players: {
      p1: {
        life: 9,
        hand: ["Lightning Bolt", "Fireball", "Overrun", "Giant Growth", "Forest", "Bogardan Hellkite", "Mountain"],
        battlefield: [
          ...many("Forest", 4),
          ...many("Mountain", 3),
          { card: "Mountain", tapped: true },
          "Rootbound Crag",
          "Terramorphic Expanse",
          "Llanowar Elves",
          "Prized Unicorn",
          "Deadly Recluse",
          "Prodigal Pyromancer",
          { card: "Stampeding Rhino", damage: 2 },
          "Berserkers of Blood Ridge",
          "Shivan Dragon",
          "Inferno Elemental",
          "Lurking Predators",
          "Dragon's Claw",
          { card: "Garruk Wildspeaker", counters: { loyalty: 4 } },
        ],
        graveyard: ["Shock", "Ball Lightning", "Elvish Visionary"],
        library: [...many("Forest", 8), ...many("Mountain", 8)],
      },
      p2: {
        life: 6,
        hand: many("Plains", 3),
        battlefield: [
          ...many("Plains", 6),
          { card: "Plains", tapped: true },
          { card: "Plains", tapped: true },
          "Elite Vanguard",
          "Elite Vanguard",
          "Soul Warden",
          "Veteran Armorsmith",
          "Veteran Swordsmith",
          "Palace Guard",
          "White Knight",
          "Rhox Pikemaster",
          "Captain of the Watch",
          "Serra Angel",
          "Honor of the Pure",
          "Honor of the Pure",
          { card: "Ajani Goldmane", counters: { loyalty: 5 } },
        ],
        library: many("Plains", 16),
      },
    },
  },
};

export const FIXTURE_NAMES = Object.keys(FIXTURES);

/** The fixture's game setup, or null when there's no fixture by that name. */
export function fixtureSetup(name: string): GameSetup | null {
  return Object.hasOwn(FIXTURES, name) ? setupOf(FIXTURES[name] as Fixture) : null;
}

/** A board written by card names, as a game setup: for the fixtures here and for tests' own boards. */
export function setupOf(fixture: Fixture): GameSetup {
  const sides: [PlayerId, Side][] = [
    ["p1", fixture.players.p1],
    ["p2", fixture.players.p2],
  ];
  const players = sides.map(
    ([player, side]): PlayerSetup => ({
      id: player,
      life: side.life,
      library: side.library.map(id),
      hand: side.hand.map(id),
      battlefield: side.battlefield.map((p) => permanent(p, player)),
      graveyard: (side.graveyard ?? []).map(id),
      exile: [],
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    }),
  );
  return { seed: 1, players, opening: { kind: "fixed", turn: fixture.turn }, ruleModifiers: [] };
}

function permanent(p: Permanent, player: PlayerId): PermanentSetup {
  const spec = typeof p === "string" ? { card: p } : p;
  return {
    oracleId: id(spec.card),
    tapped: spec.tapped ?? false,
    summoningSick: spec.sick ?? false,
    damage: spec.damage ?? 0,
    counters: spec.counters ?? {},
    ...(spec.attachedTo === undefined ? {} : { attachedTo: { player, index: spec.attachedTo } }),
    ...(spec.chosenLandType === undefined ? {} : { chosenLandType: spec.chosenLandType }),
  };
}
