// The game's events in words, one per line (`log`, `auto`), prefixed with the turn: `T6 damage: Craw Wurm -> Giant
// Spider 6`. Events name objects by id; the line names them from the state before and after the action that caused
// them, since an object that left (a dead creature, a resolved spell) is only in the state before.

import {
  type Action,
  applyAction,
  type CardDatabase,
  createGame,
  type EffectChange,
  type GameEvent,
  type GameSetup,
  type GameState,
  type ObjectId,
  type Target,
} from "@mtg/engine";
import { nameOf, refOf, scenarioStep } from "@mtg/scenarios";
import { manaText } from "./describe.ts";

type Namer = (id: ObjectId) => string;

/** Every event of the game, as lines. With `brief`, priority passes and steps beginning are left out. */
export function logLines(setup: GameSetup, actions: readonly Action[], cards: CardDatabase, brief = false): string[] {
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
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
    if (!result.ok) throw new Error(`action ${i + 1} is rejected: ${result.error.message}`);
    add(result.events, state, result.state);
    state = result.state;
  }
  return lines;
}

function nameIn(before: GameState, after: GameState, id: ObjectId, cards: CardDatabase): string {
  return before.objects[id] !== undefined ? nameOf(before, id, cards) : nameOf(after, id, cards);
}

function target(t: Target, name: Namer): string {
  return t.kind === "player" ? t.player : name(t.object);
}

export function eventText(e: GameEvent, name: Namer, cards: CardDatabase): string {
  switch (e.type) {
    case "ZONE_CHANGED": {
      const card = cards[e.object.oracleId]?.printed.name ?? e.object.oracleId;
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
    case "ACTIVATION_CANCELLED":
      return `${e.player} cancels activating ${name(e.source)}`;
    case "ABILITY_DID_NOT_RESOLVE":
      return `${name(e.source)}'s ability doesn't resolve: its targets are illegal (CR 608.2b)`;
    case "SPELL_DID_NOT_RESOLVE":
      return `${name(e.object)} doesn't resolve: its targets are illegal (CR 608.2b)`;
    case "SPELL_RESOLVED":
      return `resolves: ${name(e.object)}`;
    case "ABILITY_RESOLVED":
      return `resolves: ${name(e.source)}'s ability`;
    case "ATTACKERS_DECLARED":
      return `${e.player} attack: ${e.attacks.length === 0 ? "nothing" : e.attacks.map((a) => `${name(a.attacker)} -> ${a.defender}`).join(", ")}`;
    case "BLOCKERS_DECLARED":
      return `${e.player} block: ${e.blocks.length === 0 ? "nothing" : e.blocks.map((b) => `${name(b.blocker)} -> ${name(b.attacker)}`).join(", ")}`;
    case "DAMAGE_DEALT":
      return `${e.combat ? "combat damage" : "damage"}: ${name(e.source)} -> ${target(e.to, name)} ${e.amount}`;
    case "LIFE_LOST":
      return `${e.player} loses ${e.amount} life`;
    case "EFFECT_CREATED":
      return `effect: ${e.effect.affected.map(name).join(", ")} ${ptChange(e.effect.change)} until end of turn`;
    case "EFFECT_ENDED":
      return `effect ends: ${e.effect.affected.map(name).join(", ")} ${ptChange(e.effect.change)}`;
    case "STATE_BASED_ACTIONS":
      return `state-based actions: ${e.actions.map((a) => ("player" in a ? `${a.player} ${a.kind}` : `${name(a.object)} ${a.kind}`)).join(", ")}`;
    case "PERMANENT_DESTROYED":
      return `destroyed: ${name(e.object)}`;
    case "PLAYER_LOST":
      return `${e.player} loses the game (${e.reason})`;
    case "GAME_ENDED":
      return `game over: ${e.result.winner === null ? "a draw" : `${e.result.winner} wins`}`;
    case "MANA_EMPTIED":
      return `${e.player}'s unspent ${manaText(e.lost)} empties`;
    case "MANA_ADDED":
      return `${e.player} adds ${manaText({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, [e.mana]: e.amount })} (${name(e.source)})`;
    case "PERMANENT_TAPPED":
      return `taps: ${name(e.object)}`;
    case "PERMANENT_UNTAPPED":
      return `untaps: ${name(e.object)}`;
    case "DAMAGE_REMOVED":
      return `damage removed: ${name(e.object)} (${e.amount})`;
    case "CARD_DISCARDED":
      return `${e.player} discards ${name(e.newId)}`;
  }
}

function ptChange(change: EffectChange): string {
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  switch (change.kind) {
    case "modifyPT":
      return `${sign(change.power)}/${sign(change.toughness)}`;
  }
}
