// What one player sees of each object they can see, with the values the layer system derives (D-135, D-137): the host
// sends these beside the view, so the UI, the heuristic AI and the LLM opponent all read the same data and none of
// them needs the state. Only objects in the viewer's `playerView` are described, so nothing hidden is (D-044). Kept
// out of `playerView` itself, which stays a plain filter of the state.

import { isToken, textOracleId } from "../cards/card-data.ts";
import type { CardDatabase } from "../cards/types.ts";
import { type Characteristics, characteristics } from "../rules/characteristics.ts";
import { attackedNow, isAttacking, isBlocking } from "../rules/combat.ts";
import { controllerOf } from "../rules/controller.ts";
import { isFreeOfSummoningSickness } from "../rules/summoning-sickness.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId, PlayerId } from "../state/ids.ts";
import type { AbilityRef, StackChoices, Target } from "../state/objects.ts";
import type { PlayerView } from "./player-view.ts";

/** A card or token the viewer can see, in any zone they see into. */
export type SeenCard = {
  kind: "card";
  id: ObjectId;
  /** What it is, for its art and text: a copy's is what it copied (CR 707.2); null for a token. */
  oracleId: OracleId | null;
  /** Its characteristics now (CR 613), controller included (D-022). */
  characteristics: Characteristics;
  owner: PlayerId;
  token: boolean;
  /** A copy of a spell on the stack (CR 707.10). */
  copy: boolean;
  tapped: boolean;
  damage: number;
  counters: Record<string, number>;
  attachedTo: ObjectId | null;
  /** A name or basic land type chosen as it entered (CR 614.12a). */
  chosen: string | null;
  /** A creature that can't attack or use {T} abilities yet (CR 302.6). */
  summoningSick: boolean;
  /**
   * While it's an attacking creature: what it attacks (CR 508.1b), or null once the planeswalker it attacked has left
   * combat, when it's still attacking but attacks nothing (CR 506.4c). Null when it isn't attacking.
   */
  attacking: { attacked: Target | null } | null;
  /** The attackers it blocks while it's a blocking creature. */
  blocking: ObjectId[];
  /** Regeneration shields on it this turn (CR 701.19a): public, as everyone saw the ability that made each resolve. */
  regenerationShields: number;
  /** A spell's choices on the stack (targets, X, CR 601.2b-c); null elsewhere. */
  choices: StackChoices | null;
};

/** An activated or triggered ability on the stack (CR 113.1c). */
export type SeenAbility = {
  kind: "ability";
  id: ObjectId;
  source: ObjectId;
  /** The card it came from, for its text. */
  sourceOracleId: OracleId;
  /** Which of that card's abilities it is: activated or triggered, and which (D-028). */
  ability: AbilityRef;
  controller: PlayerId;
  choices: StackChoices;
};

export type SeenObject = SeenCard | SeenAbility;

/** Every object in the view, described: the viewer sees nothing here the view leaves out. */
export function seenObjects(state: GameState, view: PlayerView, cards: CardDatabase): Record<ObjectId, SeenObject> {
  const seen: Record<ObjectId, SeenObject> = {};
  for (const id of Object.keys(view.objects) as ObjectId[]) {
    const described = seenObject(state, id, cards);
    if (described !== null) seen[id] = described;
  }
  return seen;
}

function seenObject(state: GameState, id: ObjectId, cards: CardDatabase): SeenObject | null {
  const obj = state.objects[id];
  if (obj === undefined) return null;
  if (obj.kind === "ability") {
    return {
      kind: "ability",
      id,
      source: obj.source,
      sourceOracleId: obj.sourceOracleId,
      ability: obj.ability,
      controller: controllerOf(state, id, cards),
      choices: obj.choices,
    };
  }
  const c = characteristics(state, id, cards);
  const attack = isAttacking(state, id, cards) ? state.combat?.attacks.find((a) => a.attacker === id) : undefined;
  return {
    kind: "card",
    id,
    oracleId: isToken(obj) ? null : textOracleId(obj),
    characteristics: c,
    owner: obj.owner,
    token: isToken(obj),
    copy: obj.copy === true,
    tapped: obj.tapped,
    damage: obj.damage,
    counters: obj.counters,
    attachedTo: obj.attachedTo ?? null,
    chosen: obj.chosenName ?? obj.chosenLandType ?? null,
    summoningSick: c.types.includes("creature") && !isFreeOfSummoningSickness(state, id, cards),
    attacking: attack === undefined ? null : { attacked: attackedNow(state, attack, cards) },
    blocking: isBlocking(state, id, cards)
      ? (state.combat?.blocks ?? []).filter((b) => b.blocker === id).map((b) => b.attacker)
      : [],
    regenerationShields: state.replacements.filter((r) => r.kind === "regenerationShield" && r.object === id).length,
    choices: obj.choices,
  };
}
