// Auras and Equipment beside the permanent they're attached to (M3-04c slice 4b; the owner's screenshot [R]: "an Aura
// sits as its own card just left of the creature it enchants, joined by a small link mark"). An attached permanent
// (CR 301.5, 303.4) leaves its own row: its host's row keeps room for it, left of the host, and once combat has moved
// the cards it's placed there, behind the host, peeking out. It sits on the host's side of the table, whoever controls
// it: a Pacifism on the opponent's creature is by that creature, as Arena shows it.

import type { ObjectId, PlayerId, SeatView, SeenCard } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import { boardCard } from "./board-card.ts";
import type { BoardCard } from "./board-model.ts";

/** The permanents attached to each host that keeps them beside it (a creature or a land), in battlefield order. */
export type Attached = ReadonlyMap<ObjectId, readonly SeenCard[]>;

/** Which permanents sit beside a host rather than in a row of their own. */
export function attachedByHost(shown: SeatView): Attached {
  const byHost = new Map<ObjectId, SeenCard[]>();
  for (const id of shown.view.zones.battlefield) {
    const card = shown.seen[id];
    if (card?.kind !== "card" || card.attachedTo === null) continue;
    const host = shown.seen[card.attachedTo];
    // A host in the others row (an enchantment, a planeswalker), or one itself attached to something (a land made an
    // Aura), keeps today's placement: none in today's pool.
    if (
      host?.kind !== "card" ||
      host.attachedTo !== null ||
      !host.characteristics.types.some((t) => t === "creature" || t === "land")
    )
      continue;
    byHost.set(host.id, [...(byHost.get(host.id) ?? []), card]);
  }
  return byHost;
}

/** The ids of every permanent placed beside its host, to leave out of the rows. */
export function besideIds(attached: Attached): ReadonlySet<ObjectId> {
  return new Set([...attached.values()].flatMap((cards) => cards.map((c) => c.id)));
}

/** The room a host's row keeps left of it, in px, for what's attached to it: part of a card's width each. */
export function attachedRoom(attached: Attached, host: ObjectId, cardWidth: number, layout: BoardLayout): number {
  return (attached.get(host)?.length ?? 0) * layout.attach.peek * cardWidth;
}

/**
 * The attachments placed beside their hosts, where the hosts are now (after combat moved them), each behind its host
 * in drawing order and peeking out to its left; the host learns how many it holds, for its link mark.
 */
export function withAttachments(
  cards: readonly BoardCard[],
  attached: Attached,
  me: PlayerId,
  layout: BoardLayout,
): BoardCard[] {
  const placed: BoardCard[] = [];
  for (const card of cards) {
    const onIt = attached.get(card.id);
    if (onIt === undefined || card.zone !== "battlefield") {
      placed.push(card);
      continue;
    }
    const peek = layout.attach.peek * card.width;
    // The furthest first, so each nearer one covers it, and the host covers them all.
    for (let k = onIt.length; k >= 1; k--) {
      const attachment = onIt[k - 1];
      if (attachment === undefined) continue;
      const rect = { x: card.x - peek * k, y: card.y, width: card.width, height: card.height };
      const look = attachment.tapped
        ? { rotation: layout.tapped.tilt, dim: layout.tapped.dim }
        : { rotation: 0, dim: 0 };
      const mine = attachment.characteristics.controller === me;
      placed.push(boardCard(attachment, "battlefield", mine, rect, { ...look, row: card.row }));
    }
    placed.push({ ...card, attachments: onIt.length });
  }
  return placed;
}
