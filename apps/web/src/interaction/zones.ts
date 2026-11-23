// Each player's zones as the person may see them (M3-04c slice 5; arena-research.md, "Library, graveyard, exile":
// "clicking a graveyard or exile opens a view of every card in it", for the opponent's too [R]). The counts in a player's
// info block and the browser's tabs both come from here, so they can't disagree. Pure, from the seat view: it shows only
// what the person may see (D-062).

import type { ObjectId, OracleId, PlayerId, SeatView } from "@mtg/engine";
import { cardInfo } from "../board-model/card-info.ts";

/** What the browser can show of a player: the public zones, and a hand or library top while it's revealed. */
export type ZoneName = "graveyard" | "exile" | "hand" | "library";

/**
 * One card in the browser. A card in a public zone is an object (`id`), so the card view follows it as the game goes
 * on; a revealed card is shown by identity only (`id` null), as the engine reveals it (D-062).
 */
export type ZoneCard = {
  key: string;
  id: ObjectId | null;
  oracleId: OracleId | null;
  name: string;
  /** The card's image, or null (a token: none has one): then its name is shown. */
  image: string | null;
  /** Its art alone, for a small tile; null as the image is. */
  art: string | null;
};

export type PlayerZones = {
  library: number;
  hand: number;
  graveyard: number;
  exile: number;
  /** Their hand is revealed to every player (Telepathy). */
  handRevealed: boolean;
  /** Their library's top card, while it's revealed to every player (Vampire Nocturnus); else null. */
  revealedTop: ZoneCard | null;
};

export type BrowserTab = { zone: ZoneName; label: string; cards: ZoneCard[] };

export function playerZones(shown: SeatView, player: PlayerId): PlayerZones {
  const own = shown.view.zones.players[player];
  return {
    // Anyone may count a library and a hand (CR 401.3, 402.3).
    library: own?.librarySize ?? 0,
    hand: own?.handSize ?? 0,
    graveyard: zoneCards(shown, player, "graveyard").length,
    exile: zoneCards(shown, player, "exile").length,
    handRevealed: own?.revealedHand != null,
    revealedTop: zoneCards(shown, player, "library")[0] ?? null,
  };
}

/** The tabs the browser offers for a player: graveyard and exile always, and what of theirs is revealed. */
export function browserTabs(shown: SeatView, player: PlayerId): BrowserTab[] {
  const tab = (zone: ZoneName, label: string): BrowserTab => ({ zone, label, cards: zoneCards(shown, player, zone) });
  const zones = playerZones(shown, player);
  return [
    tab("graveyard", `Graveyard ${zones.graveyard}`),
    tab("exile", `Exile ${zones.exile}`),
    // The person's own hand is in front of them: a tab for it would only repeat it.
    ...(zones.handRevealed && player !== shown.player ? [tab("hand", `Hand ${zones.hand}`)] : []),
    ...(zones.revealedTop !== null ? [tab("library", "Library top")] : []),
  ];
}

/**
 * The whole stack, its top first (CR 405.2: the last put there): the board draws only the top few, so a deep stack is
 * read here (D-169).
 */
export function stackCards(shown: SeatView): ZoneCard[] {
  return objects(shown, [...shown.view.zones.stack].reverse());
}

/** The cards of one zone of a player's, in the order the browser shows them. */
export function zoneCards(shown: SeatView, player: PlayerId, zone: ZoneName): ZoneCard[] {
  const own = shown.view.zones.players[player];
  switch (zone) {
    case "graveyard":
      // Its top first: anyone may look through a graveyard, and its order is kept (CR 404.2; the last is the top).
      return objects(shown, [...(own?.graveyard ?? [])].reverse());
    case "exile":
      // Exile is shared; each player's are the cards they own, as their info block counts them. Exiled cards are face
      // up and anyone may look (CR 406.3); the newest first, as a graveyard's top is.
      return objects(
        shown,
        [...shown.view.zones.exile].reverse().filter((id) => {
          const seen = shown.seen[id];
          return seen?.kind === "card" && seen.owner === player;
        }),
      );
    case "hand":
      // While revealed (CR 701.20a), by identity only, in the fixed order the view gives (D-062).
      return printed(own?.revealedHand ?? [], "hand");
    case "library":
      // Its top card while revealed (CR 401.5).
      return printed(own?.revealedTop == null ? [] : [own.revealedTop], "top");
  }
}

function objects(shown: SeatView, ids: readonly ObjectId[]): ZoneCard[] {
  return ids.flatMap((id) => {
    const seen = shown.seen[id];
    if (seen === undefined) return [];
    // An ability (on the stack) is shown as its panel, named for its source, with the source's art.
    const oracleId = seen.kind === "card" ? seen.oracleId : seen.sourceOracleId;
    const info = cardInfo(oracleId);
    return [
      {
        key: id,
        id,
        oracleId,
        name: seen.kind === "card" ? seen.characteristics.name : `${info?.name ?? "An"} ability`,
        image: seen.kind === "card" ? (info?.image ?? null) : null,
        art: info?.artCrop ?? null,
      },
    ];
  });
}

/**
 * Revealed cards, keyed by identity and copy ("the second Plains"): the same card twice is two cards, and a card the
 * view is showing keeps its key when one before it leaves (the order is by identity already, D-062, so this tells
 * nothing more).
 */
function printed(oracleIds: readonly OracleId[], prefix: string): ZoneCard[] {
  const copies = new Map<OracleId, number>();
  return oracleIds.map((oracleId) => {
    const n = (copies.get(oracleId) ?? 0) + 1;
    copies.set(oracleId, n);
    const info = cardInfo(oracleId);
    return {
      key: `${prefix}-${oracleId}-${n}`,
      id: null,
      oracleId,
      name: info?.name ?? "A card",
      image: info?.image ?? null,
      art: info?.artCrop ?? null,
    };
  });
}
