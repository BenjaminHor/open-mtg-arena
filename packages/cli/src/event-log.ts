// The game's events in words, one per line (`log`, `auto`), prefixed with the turn: `T6 damage: Craw Wurm -> Giant
// Spider 6`. Events name objects by id; the line names them from the state before and after the action that caused
// them, since an object that left (a dead creature, a resolved spell) is only in the state before.

import {
  type Action,
  applyAction,
  type Becomes,
  type CardDatabase,
  cardDataByOracleId,
  cardDataOf,
  createGame,
  type EffectChange,
  type GameEvent,
  type GameSetup,
  type GameState,
  type ObjectId,
  type Target,
} from "@mtg/engine";
import { nameOf, refOf, scenarioStep } from "@mtg/scenarios";
import { durationText, manaText } from "./describe.ts";

type Namer = (id: ObjectId) => string;

/** Every event of the game, as lines. With `brief`, priority passes and steps beginning are left out. */
export function logLines(setup: GameSetup, actions: readonly Action[], cards: CardDatabase, brief = false): string[] {
  const { lines, rejected } = logUntilRejected(setup, actions, cards, brief);
  if (rejected !== null) throw new Error(rejected);
  return lines;
}

/**
 * The log as far as the game goes: if an action is rejected, the lines before it and why it was rejected, so a golden
 * game that no longer plays out still shows where it went differently.
 */
export function logUntilRejected(
  setup: GameSetup,
  actions: readonly Action[],
  cards: CardDatabase,
  brief = false,
): { lines: string[]; rejected: string | null } {
  const created = createGame(setup, cards);
  if (!created.ok) return { lines: [], rejected: `the setup is rejected: ${created.error.message}` };
  const lines: string[] = [];
  const add = (events: readonly GameEvent[], before: GameState, after: GameState) => {
    const name: Namer = (id) => refOf(before, id, cards) ?? refOf(after, id, cards) ?? nameIn(before, after, id, cards);
    // One action can end a turn and begin the next, so the turn is followed event by event.
    let turn = before.turn?.number ?? 0;
    for (const event of events) {
      if (event.type === "TURN_BEGAN") turn = event.turn;
      if (brief && (event.type === "PRIORITY_PASSED" || event.type === "STEP_BEGAN")) continue;
      lines.push(`T${turn} ${eventText(event, name, cards)}`);
    }
  };
  add(created.events, created.state, created.state);
  let state = created.state;
  for (const [i, action] of actions.entries()) {
    const result = applyAction(state, action, cards);
    if (!result.ok) return { lines, rejected: `action ${i + 1} is rejected: ${result.error.message}` };
    add(result.events, state, result.state);
    state = result.state;
  }
  return { lines, rejected: null };
}

function nameIn(before: GameState, after: GameState, id: ObjectId, cards: CardDatabase): string {
  const known = (s: GameState) => s.objects[id] !== undefined || s.lastKnown[id] !== undefined;
  return known(before) ? nameOf(before, id, cards) : nameOf(after, id, cards);
}

function target(t: Target, name: Namer): string {
  return t.kind === "player" ? t.player : name(t.object);
}

export function eventText(e: GameEvent, name: Namer, cards: CardDatabase): string {
  switch (e.type) {
    case "ZONE_CHANGED": {
      const card = cardDataOf(e.object, cards)?.printed.name ?? e.object.oracleId;
      const zone = (z: typeof e.from) => ("player" in z ? `${z.player}'s ${z.zone}` : z.zone);
      return `moves: ${card}, ${zone(e.from)} -> ${zone(e.to)}`;
    }
    case "STARTING_PLAYER_CHOSEN":
      return `${e.player} goes first${e.chosenBy === null ? "" : ` (chosen by ${e.chosenBy})`}`;
    case "LIBRARY_SHUFFLED":
      return `${e.player} shuffles their library`;
    case "CARD_DRAWN":
      return `${e.player} draws`;
    case "MULLIGAN_DECLARED":
      return `${e.player} ${e.choice === "keep" ? "keeps" : "mulligans"}`;
    case "TURN_BEGAN":
      return `turn ${e.turn} begins (${e.activePlayer})`;
    case "STEP_BEGAN":
      return `step: ${scenarioStep(e.step)}`;
    case "PRIORITY_PASSED":
      return `${e.player} passes`;
    case "LAND_PLAYED":
      return `${e.player} plays ${name(e.newId)}`;
    case "SPELL_CAST":
      return `${e.player} casts ${name(e.object)}`;
    case "CAST_CANCELLED":
      return `${e.player} cancels casting ${name(e.restored)}`;
    case "ABILITY_ACTIVATED":
      return `${e.player} activates ${name(e.source)}`;
    case "ABILITY_TRIGGERED": {
      // A delayed trigger's source may be long gone: then it's named by the ability itself ("Dragon Whelp ability").
      const source = name(e.source);
      return `${source.startsWith("(gone") ? name(e.object) : source} triggers (${e.controller})`;
    }
    case "ACTIVATION_CANCELLED":
      return `${e.player} cancels activating ${name(e.source)}`;
    case "ABILITY_DID_NOT_RESOLVE":
      return e.reason === "illegalTargets"
        ? `${name(e.source)}'s ability doesn't resolve: its targets are illegal (CR 608.2b)`
        : `${name(e.source)}'s ability doesn't resolve: its condition is false (CR 603.4)`;
    case "SPELL_DID_NOT_RESOLVE":
      return `${name(e.object)} doesn't resolve: its targets are illegal (CR 608.2b)`;
    case "SPELL_RESOLVED":
      return `resolves: ${name(e.object)}`;
    case "ABILITY_RESOLVED":
      return `resolves: ${name(e.source)}'s ability`;
    case "ATTACKERS_DECLARED":
      return `${e.player} attack: ${e.attacks.length === 0 ? "nothing" : e.attacks.map((a) => `${name(a.attacker)} -> ${a.planeswalker === undefined ? a.defender : name(a.planeswalker)}`).join(", ")}`;
    case "BLOCKERS_DECLARED":
      return `${e.player} block: ${e.blocks.length === 0 ? "nothing" : e.blocks.map((b) => `${name(b.blocker)} -> ${name(b.attacker)}`).join(", ")}`;
    case "DAMAGE_DEALT":
      return `${e.combat ? "combat damage" : "damage"}: ${name(e.source)} -> ${target(e.to, name)} ${e.amount}`;
    case "LIFE_LOST":
      return `${e.player} loses ${e.amount} life`;
    case "EFFECT_CREATED":
      return `effect: ${e.effect.affected.map(name).join(", ")} ${effectChangeText(e.effect.change)} ${durationText(e.effect.duration)}`;
    case "EFFECT_ENDED":
      return `effect ends: ${e.effect.affected.map(name).join(", ")} ${effectChangeText(e.effect.change)}`;
    case "STATE_BASED_ACTIONS":
      return `state-based actions: ${e.actions.map((a) => ("player" in a ? `${a.player} ${a.kind}` : `${name(a.object)} ${a.kind}`)).join(", ")}`;
    case "PERMANENT_DESTROYED":
      return `destroyed: ${name(e.object)}`;
    case "PERMANENT_SACRIFICED":
      return `${e.player} sacrifices ${name(e.object)}`;
    case "SPELL_COUNTERED":
      return `countered: ${name(e.object)}`;
    case "ABILITY_COUNTERED":
      return `countered: ${name(e.source)}'s ability`;
    case "LIFE_GAINED":
      return `${e.player} gains ${e.amount} life`;
    case "PLAYER_LOST":
      return `${e.player} loses the game (${e.reason})`;
    case "GAME_ENDED":
      return `game over: ${e.result.winner === null ? "a draw" : `${e.result.winner} wins`}`;
    case "MANA_EMPTIED":
      return `${e.player}'s unspent ${manaText(e.lost)} empties`;
    case "MANA_ADDED":
      return `${e.player} adds ${manaText({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, [e.mana]: e.amount })} (${name(e.source)})`;
    case "BECAME_TARGET":
      return `targeted: ${name(e.object)} by ${name(e.by)}`;
    case "TAPPED_FOR_MANA":
      return `${e.player} taps ${name(e.object)} for mana`;
    case "PERMANENT_TAPPED":
      return `taps: ${name(e.object)}`;
    case "PERMANENT_UNTAPPED":
      return `untaps: ${name(e.object)}`;
    case "COUNTERS_PUT":
      return `${e.amount} ${e.counter} counter${e.amount === 1 ? "" : "s"} put on ${name(e.object)}`;
    case "COUNTERS_REMOVED":
      return `${e.amount} ${e.counter} counter${e.amount === 1 ? "" : "s"} removed from ${name(e.object)}`;
    case "ATTACHED":
      return `attached: ${name(e.object)} to ${name(e.to)}${e.from === null ? "" : ` (from ${name(e.from)})`}`;
    case "AURA_HOST_CHOSEN":
      return `${e.player} chooses ${name(e.host)} for ${name(e.aura)} to enchant`;
    case "UNATTACHED":
      return `unattached: ${name(e.object)} from ${name(e.from)}`;
    case "TOKEN_CREATED":
      return `${e.player} creates ${name(e.object)}`;
    case "TOKEN_CEASED_TO_EXIST":
      return `ceases to exist: ${cardDataOf(e.object, cards)?.printed.name ?? e.object.oracleId} (${e.from.zone})`;
    case "PERMANENT_REGENERATED":
      return `regenerates: ${name(e.object)}`;
    case "DAMAGE_PREVENTED":
      return `prevented: ${name(e.source)} -> ${target(e.to, name)} ${e.amount} (${cardDataByOracleId(e.by, cards)?.printed.name ?? e.by})`;
    case "DAMAGE_REMOVED":
      return `damage removed: ${name(e.object)} (${e.amount})`;
    case "CARD_DISCARDED":
      return `${e.player} discards ${e.newId === null ? "a card, which went somewhere hidden" : name(e.newId)}`;
    case "CARDS_REVEALED": {
      const owner = "player" in e.from ? `${e.from.player}'s ` : "";
      const shown = e.cards.map((oracleId) => cardDataByOracleId(oracleId, cards)?.printed.name ?? oracleId);
      return `${owner}${e.from.zone} is revealed: ${shown.length === 0 ? "no cards" : shown.join(", ")}`;
    }
  }
}

function effectChangeText(change: EffectChange): string {
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  switch (change.kind) {
    case "modifyPT":
      return `${sign(change.power)}/${sign(change.toughness)}`;
    case "cantBlock":
      return "can't block";
    case "mustAttack":
      return `attacks ${change.player} if able`;
    case "addKeywords":
      return `gains ${change.keywords.join(", ")}`;
    case "cantBeBlocked":
      return "can't be blocked";
    case "becomes":
      return becomesText(change);
    case "gainControl":
      return `controlled by ${change.player}`;
    case "cantCastSpells":
      return `${change.players.join(" and ")} can't cast spells`;
  }
}

/** "becomes 4/5, colors G, also creature, also Treefolk": what each layer sets or adds. */
export function becomesText(change: Becomes): string {
  const parts = [
    change.setPT === undefined ? null : `${change.setPT.power}/${change.setPT.toughness}`,
    change.colors === undefined
      ? null
      : "set" in change.colors
        ? `colors ${change.colors.set.join("") || "none"}`
        : `also ${change.colors.add.join("")}`,
    change.addTypes.length === 0 ? null : `also ${change.addTypes.join(" ")}`,
    change.addSubtypes.length === 0 ? null : `also ${change.addSubtypes.join(" ")}`,
  ];
  return `becomes ${parts.filter((p) => p !== null).join(", ")}`;
}
