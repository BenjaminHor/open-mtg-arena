// A game setup with card names in place of oracle ids, for files people read (golden games, D-082): "Grizzly Bears"
// rather than a UUID. Names are unique in the pool, so the swap goes both ways.

import type { CardDatabase, GameSetup, OracleId, PlayerSetup } from "@mtg/engine";

/** The setup with each card named. */
export function setupWithNames(setup: GameSetup, cards: CardDatabase): GameSetup {
  const name = (id: OracleId) => {
    const found = cards[id]?.printed.name;
    if (found === undefined) throw new Error(`no card ${id} in the pool`);
    return found;
  };
  return { ...setup, players: setup.players.map((p) => mapCards(p, name)) };
}

/** The setup with each card name back to its oracle id. */
export function setupFromNames(setup: GameSetup, cards: CardDatabase): GameSetup {
  const ids = new Map<string, string>();
  for (const card of Object.values(cards)) {
    // Split and double-faced cards (later: CR 709, 712) could share a name; a name must stand for one card.
    if (ids.has(card.printed.name)) throw new Error(`two cards named "${card.printed.name}" in the pool`);
    ids.set(card.printed.name, card.oracleId);
  }
  const id = (name: string) => {
    const found = ids.get(name);
    if (found === undefined) throw new Error(`no card named "${name}" in the pool`);
    return found;
  };
  return { ...setup, players: setup.players.map((p) => mapCards(p, id)) };
}

function mapCards(player: PlayerSetup, map: (card: string) => string): PlayerSetup {
  return {
    ...player,
    library: player.library.map(map),
    hand: player.hand.map(map),
    graveyard: player.graveyard.map(map),
    exile: player.exile.map(map),
    battlefield: player.battlefield.map((p) => ({ ...p, oracleId: map(p.oracleId) })),
  };
}
