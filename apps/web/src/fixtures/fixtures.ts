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
export type Side = {
  life: number;
  hand: string[];
  battlefield: Permanent[];
  graveyard?: string[];
  exile?: string[];
  library: string[];
};
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
  /** For the prompts (M3-04b slice 2): X (Fireball), dividing damage (Ignite Disorder), naming a card (Pithing Needle). */
  prompts: {
    turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: {
        life: 20,
        hand: ["Fireball", "Ignite Disorder", "Pithing Needle"],
        battlefield: [...many("Mountain", 7), "Llanowar Elves", "Deadly Recluse", "Prodigal Pyromancer"],
        library: many("Mountain", 20),
      },
      p2: {
        life: 20,
        hand: [],
        battlefield: ["Plains", "Plains", "Elite Vanguard", "Veteran Armorsmith", "Serra Angel"],
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
  /** The person's turn, ready to attack into a few blockers; Giant Growth in hand to keep priority in combat. */
  attack: {
    turn: { number: 7, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: {
        life: 15,
        hand: ["Giant Growth", "Lightning Bolt", "Forest"],
        battlefield: [
          ...many("Forest", 3),
          ...many("Mountain", 2),
          "Stampeding Rhino",
          "Shivan Dragon",
          "Berserkers of Blood Ridge",
          "Llanowar Elves",
        ],
        library: [...many("Forest", 10), ...many("Mountain", 10)],
      },
      p2: {
        life: 16,
        hand: ["Plains", "Pacifism"],
        battlefield: [
          ...many("Plains", 5),
          "Elite Vanguard",
          "Veteran Armorsmith",
          "Siege Mastodon",
          "Honor of the Pure",
        ],
        library: many("Plains", 20),
      },
    },
  },
  /** The opponent's turn, their bigger creatures ready to attack the person's; Giant Growth in hand to answer. */
  block: {
    turn: { number: 8, activePlayer: "p2", step: "precombatMain" },
    players: {
      p1: {
        life: 11,
        hand: ["Giant Growth", "Shock"],
        battlefield: [
          ...many("Forest", 3),
          ...many("Mountain", 2),
          "Deadly Recluse",
          "Prodigal Pyromancer",
          "Llanowar Elves",
          "Stampeding Rhino",
        ],
        library: [...many("Forest", 10), ...many("Mountain", 10)],
      },
      p2: {
        life: 18,
        hand: ["Plains"],
        battlefield: [
          ...many("Plains", 6),
          "Serra Angel",
          "Siege Mastodon",
          "Rhox Pikemaster",
          "Elite Vanguard",
          "Veteran Swordsmith",
          "Honor of the Pure",
        ],
        library: many("Plains", 20),
      },
    },
  },
  /**
   * Badges (M3-04c, D-166): keywords and an ellipsis, protection, counters (+1/+1 and −1/−1), loyalty, a sick creature
   * with two keywords, at the creature row's crowded size; Serra Angel in hand too (a hand card wears no badges). A
   * token's badges show on the `tokens` board once Siege-Gang Commander is cast.
   */
  badges: {
    turn: { number: 6, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: {
        life: 20,
        hand: ["Serra Angel"],
        battlefield: [
          "Mountain",
          "Forest",
          { card: "Llanowar Elves", sick: true },
          { card: "Grizzly Bears", counters: { "+1/+1": 2 } },
          { card: "Serra Angel", sick: true },
          { card: "Stampeding Rhino", counters: { "-1/-1": 1 } },
          "Prized Unicorn",
          "Deadly Recluse",
          "Shivan Dragon",
          { card: "Garruk Wildspeaker", counters: { loyalty: 3 } },
        ],
        library: many("Forest", 20),
      },
      p2: {
        life: 20,
        hand: ["Plains"],
        battlefield: [
          "Plains",
          "Plains",
          "Baneslayer Angel",
          "White Knight",
          { card: "Elite Vanguard", sick: true },
          "Veteran Armorsmith",
          "Palace Guard",
          { card: "Ajani Goldmane", counters: { loyalty: 4 } },
        ],
        library: many("Plains", 20),
      },
    },
  },
  /**
   * Attachments (M3-04c slice 4b): an Aura and an Equipment on the person's creatures, an Aura on the opponent's, one
   * on a land: each beside its host, joined by a link mark.
   */
  attachments: {
    turn: { number: 7, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: {
        life: 20,
        hand: ["Lightning Bolt"],
        battlefield: [
          "Forest",
          "Forest",
          "Plains",
          "Serra Angel",
          { card: "Holy Strength", attachedTo: 3 },
          "Llanowar Elves",
          "Grizzly Bears",
          { card: "Whispersilk Cloak", attachedTo: 6 },
        ],
        library: many("Forest", 20),
      },
      p2: {
        life: 20,
        hand: ["Plains"],
        battlefield: [
          "Island",
          "Island",
          { card: "Convincing Mirage", attachedTo: 1, chosenLandType: "Swamp" },
          "Elite Vanguard",
          { card: "Pacifism", attachedTo: 3 },
          "Veteran Armorsmith",
        ],
        library: many("Island", 20),
      },
    },
  },
  /**
   * Graveyards, exile and revealed cards (M3-04c slice 5): a long graveyard to scroll, exiled cards of both players,
   * a Telepathy on each side (both hands revealed) and the opponent's Vampire Nocturnus (their library top revealed).
   */
  zones: {
    turn: { number: 9, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: {
        life: 14,
        hand: ["Lightning Bolt", "Giant Growth"],
        battlefield: [...many("Forest", 3), ...many("Mountain", 2), "Telepathy", "Grizzly Bears"],
        graveyard: ["Shock", "Llanowar Elves", "Giant Growth"],
        exile: ["Serra Angel"],
        library: many("Forest", 20),
      },
      p2: {
        life: 11,
        hand: ["Plains", "Pacifism", "Plains"],
        battlefield: [...many("Swamp", 4), "Telepathy", "Vampire Nocturnus"],
        graveyard: [
          ...many("Elite Vanguard", 8),
          ...many("Pacifism", 6),
          ...many("Grizzly Bears", 8),
          ...many("Shock", 8),
          "Serra Angel",
        ],
        exile: ["Veteran Armorsmith", "Lightning Bolt"],
        library: ["Shock", ...many("Swamp", 19)],
      },
    },
  },
  /**
   * The stack (M3-04c slice 6): with full control on, Lightning Bolt, Giant Growth in response and Prodigal
   * Pyromancer's ability on top make three objects, a spell's targets and an ability's own panel.
   */
  stack: {
    turn: { number: 6, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: {
        life: 20,
        hand: ["Lightning Bolt", "Giant Growth"],
        battlefield: [...many("Mountain", 4), ...many("Forest", 2), "Prodigal Pyromancer", "Grizzly Bears"],
        library: many("Forest", 20),
      },
      p2: {
        life: 20,
        hand: ["Plains"],
        battlefield: [...many("Plains", 3), "Elite Vanguard", "Veteran Armorsmith"],
        library: many("Plains", 20),
      },
    },
  },
  /** Siege-Gang Commander to cast (three Goblin tokens), and colourless permanents: frames of every kind. */
  tokens: {
    turn: { number: 6, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: {
        life: 18,
        hand: ["Siege-Gang Commander", "Lightning Bolt"],
        battlefield: [...many("Mountain", 5), "Rootbound Crag", "Ornithopter", "Howling Mine", "Llanowar Elves"],
        library: [...many("Forest", 10), ...many("Mountain", 10)],
      },
      p2: {
        life: 20,
        hand: ["Plains"],
        battlefield: [...many("Plains", 4), "Elite Vanguard"],
        library: many("Plains", 20),
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
      exile: (side.exile ?? []).map(id),
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
