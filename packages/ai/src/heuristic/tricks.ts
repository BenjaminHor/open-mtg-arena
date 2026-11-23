// Combat tricks: what a pump until end of turn (Giant Growth, Overrun, Firebreathing) is worth now. Only once blockers
// are declared (CR 509), when the fights are known: then it's worth a creature it saves, the creatures it lets its own
// kill, or the game when it makes the damage getting through lethal. Before that, or on a creature out of combat, it's
// worth nothing and the heuristic keeps it in hand.

import type { PlayerId, SeatView, SeenCard } from "@mtg/engine";
import { creatureValue, has, lifeOf, permanents, seenCard, toughnessLeft } from "./board.ts";
import { damageDealt, kills, type Pump, pumped } from "./fights.ts";

/** A pump for one creature. */
export type Pumping = { creature: SeenCard; pump: Pump };

const LETHAL = 100;

/** What these pumps, together, are worth to the heuristic now. */
export function pumpsValue(shown: SeatView, pumps: readonly Pumping[]): number {
  if (shown.view.turn?.step !== "declareBlockers" || shown.view.combat === null) return 0;
  const mine = pumps.filter((p) => p.creature.characteristics.controller === shown.player);
  if (mine.length === 0) return 0;
  const after = (c: SeenCard) => {
    const p = mine.find((m) => m.creature.id === c.id);
    return p === undefined ? c : pumped(c, p.pump);
  };
  const fights = mine.reduce((sum, p) => sum + fightGain(shown, p.creature, after(p.creature)), 0);
  return becomesLethal(shown, after) ? LETHAL + fights : fights;
}

/** What the pump changes in this creature's own fight: whether it lives, and what it kills. */
function fightGain(shown: SeatView, before: SeenCard, after: SeenCard): number {
  const foes = foesOf(shown, before);
  if (foes.length === 0) return 0;
  const saved = !survives(before, foes) && survives(after, foes) ? creatureValue(before) : 0;
  return saved + killedWorth(after, foes) - killedWorth(before, foes);
}

/** Whether it dies in the fight it's in now, once blockers are declared (CR 510.2). */
export function losesFight(shown: SeatView, creature: SeenCard): boolean {
  if (shown.view.turn?.step !== "declareBlockers") return false;
  const foes = foesOf(shown, creature);
  return foes.length > 0 && !survives(creature, foes);
}

/** The creatures it fights: an attacker's blockers, or the attackers a blocker blocks. */
function foesOf(shown: SeatView, creature: SeenCard): SeenCard[] {
  if (creature.attacking !== null) return blockersOf(shown, creature);
  return creature.blocking.flatMap((id) => seenCard(shown, id) ?? []);
}

function blockersOf(shown: SeatView, attacker: SeenCard): SeenCard[] {
  return permanents(shown).filter((c) => c.blocking.includes(attacker.id));
}

/** Whether it lives through the damage of all its foes (CR 510.2), first strike aside. */
function survives(creature: SeenCard, foes: readonly SeenCard[]): boolean {
  if (foes.length === 1) return !kills(foes[0] as SeenCard, creature);
  if (has(creature, "indestructible")) return true;
  if (foes.some((f) => has(f, "deathtouch") && damageDealt(f) > 0)) return false;
  return foes.reduce((sum, f) => sum + damageDealt(f), 0) < toughnessLeft(creature);
}

/** What its damage kills among its foes: lethal to each in turn, the easiest first (CR 510.1c). */
function killedWorth(creature: SeenCard, foes: readonly SeenCard[]): number {
  if (foes.length === 1) return kills(creature, foes[0] as SeenCard) ? creatureValue(foes[0] as SeenCard) : 0;
  let left = damageDealt(creature);
  let worth = 0;
  for (const foe of [...foes].sort((a, b) => toughnessLeft(a) - toughnessLeft(b))) {
    const needed = has(creature, "deathtouch") ? 1 : toughnessLeft(foe);
    if (left < needed) break;
    left -= needed;
    worth += creatureValue(foe);
  }
  return worth;
}

/** The pumps make the damage getting through to a player lethal, when it wasn't (trample counted, CR 702.19b). */
function becomesLethal(shown: SeatView, after: (c: SeenCard) => SeenCard): boolean {
  const attackers = permanents(shown).filter(
    (c) => c.attacking !== null && c.characteristics.controller === shown.player,
  );
  const through = (pick: (c: SeenCard) => SeenCard, player: PlayerId) =>
    attackers
      .filter((a) => a.attacking?.attacked?.kind === "player" && a.attacking.attacked.player === player)
      .reduce((sum, a) => sum + damageThrough(shown, pick(a), a), 0);
  return shown.view.turnOrder
    .filter((p) => p !== shown.player)
    .some((p) => through((c) => c, p) < lifeOf(shown, p) && through(after, p) >= lifeOf(shown, p));
}

/** The damage an attacker deals the player: all of it unblocked, what's left over its blockers with trample. */
function damageThrough(shown: SeatView, attacker: SeenCard, original: SeenCard): number {
  const blockers = blockersOf(shown, original);
  if (blockers.length === 0) return damageDealt(attacker);
  if (!has(attacker, "trample")) return 0;
  const absorbed = blockers.reduce((sum, b) => sum + (has(attacker, "deathtouch") ? 1 : toughnessLeft(b)), 0);
  return Math.max(0, damageDealt(attacker) - absorbed);
}
