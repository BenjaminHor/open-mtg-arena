// Copies of spells (CR 707.10): putting one on the stack. A copy is a spell with no card: an object like a card's,
// marked `copy`, with the original's characteristics (its oracle id, CR 707.2) and the choices made for it (modes,
// targets, X, the division). It isn't cast. Outside the stack it ceases to exist (CR 707.10a, `tokens.ts`).

import { newCardId, newObjectId, newTimestamp } from "../game/ids.ts";
import type { Progress } from "../game/progress.ts";
import type { SpellCopied } from "../pipeline/proposed.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import { withZoneList, zoneList } from "./zone-list.ts";

/**
 * The copy becomes the topmost object of the stack, owned and controlled by `player`, who put it there (CR 707.10), with
 * a timestamp of its own (CR 613.7d).
 */
export function putSpellCopy(state: GameState, player: PlayerId, spell: SpellCopied): Progress {
  const allocated = newObjectId(state);
  const stamped = newTimestamp(allocated.state);
  // The UI follows objects by card id (D-054), so a copy gets one of its own, as a token does.
  const minted = newCardId(stamped.state);
  const obj: CardObject = {
    kind: "card",
    id: allocated.id,
    cardId: minted.id,
    oracleId: spell.oracleId,
    owner: player,
    baseController: player,
    timestamp: stamped.timestamp,
    tapped: false,
    damage: 0,
    counters: {},
    controlledSinceTurnStart: false,
    choices: spell.choices,
    copy: true,
  };
  const next = { ...minted.state, objects: { ...minted.state.objects, [obj.id]: obj } };
  const stack = { zone: "stack" } as const;
  return {
    state: withZoneList(next, stack, [...zoneList(next, stack), obj.id]),
    events: [{ type: "SPELL_COPIED", player, object: obj.id, original: spell.original }],
  };
}
