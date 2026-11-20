// Writing a game as a scenario (`pnpm cli export --scenario`): its setup, one step per action (grouped where a
// scenario step takes several), and a final `expect` of where everything ended up, so the scenario checks the result
// and not only that the steps were legal. Running the written scenario must pass (a round-trip test checks it).

import {
  type Action,
  abilitiesOf,
  applyAction,
  type CardDatabase,
  controllerOf,
  createGame,
  type GameSetup,
  type GameState,
  type ManaPool,
  type ObjectId,
  type PlayerId,
  sameAbilityRef,
  type Target,
  withForcedAnswers,
} from "@mtg/engine";
import { stringify } from "yaml";
import { nameOf, refOf, scenarioStep } from "./names.ts";

type Step = Record<string, unknown>;

export function scenarioFromGame(
  name: string,
  rules: readonly string[],
  setup: GameSetup,
  actions: readonly Action[],
  cards: CardDatabase,
): string {
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
  const steps: Step[] = [];
  let state = created.state;
  for (let i = 0; i < actions.length; ) {
    const { step, taken } = stepFor(state, actions, i, cards);
    for (const action of actions.slice(i, i + taken)) {
      const result = applyAction(state, action, cards);
      if (!result.ok) throw new Error(`action ${i + 1} is rejected: ${result.error.message}`);
      state = result.state;
    }
    steps.push(step);
    i += taken;
  }
  steps.push({ expect: finalExpect(state, cards) });
  const doc = { name, rules: [...rules], setup: scenarioSetup(setup, cards), steps };
  return stringify(doc, { lineWidth: 120 });
}

/** The scenario step for the action at `i`, and how many actions it takes. */
function stepFor(
  state: GameState,
  actions: readonly Action[],
  i: number,
  cards: CardDatabase,
): { step: Step; taken: number } {
  const action = actions[i] as Action;
  if (action.type === "CONCEDE") return { step: { [`${action.player} concede`]: "now" }, taken: 1 };
  const p = action.player;
  switch (action.type) {
    case "PASS_PRIORITY":
      return { step: { [`${p} pass`]: "once" }, taken: 1 };
    // Which copy in hand is played or cast matters for an exact replay: `Forest#2` when there are several.
    case "PLAY_LAND":
      return { step: { [`${p} play`]: handCardName(state, p, action.object, cards) }, taken: 1 };
    // With no targets or payment, a cast stops at its first decision; the answers follow as `choose` steps.
    case "CAST_SPELL":
      return { step: { [`${p} cast`]: handCardName(state, p, action.object, cards) }, taken: 1 };
    case "ACTIVATE_ABILITY": {
      const ref = refOf(state, action.object, cards) ?? nameOf(state, action.object, cards);
      const step: Step = { [`${p} activate`]: ref };
      // `ability: n` counts in `abilitiesOf` order, as the runner does, and is needed when there's more than one.
      const abilities = abilitiesOf(state, action.object, cards);
      if (abilities.length > 1) step.ability = abilities.findIndex((a) => sameAbilityRef(a.ref, action.ability)) + 1;
      if (action.color !== undefined) step.color = action.color;
      return { step, taken: 1 };
    }
    case "ANSWER":
      return answerStep(state, actions, i, cards);
  }
}

function answerStep(
  state: GameState,
  actions: readonly Action[],
  i: number,
  cards: CardDatabase,
): { step: Step; taken: number } {
  const action = actions[i] as Extract<Action, { type: "ANSWER" }>;
  const p = action.player;
  const answer = action.answer;
  const choose = (value: unknown) => ({ step: { [`${p} choose`]: value }, taken: 1 });
  switch (answer.kind) {
    case "chooseStartingPlayer":
      return choose(answer.player);
    case "mulligan":
      return choose(answer.choice);
    case "mulliganBottom":
    case "discardToHandSize":
      return choose(handCardName(state, p, answer.object, cards));
    case "chooseTarget":
      return choose(targetName(state, answer.target, cards));
    case "chooseTargetCount":
      return choose(answer.count);
    case "announceX":
      return choose(answer.value);
    case "chooseSacrifice":
      return choose(refOf(state, answer.object, cards) ?? nameOf(state, answer.object, cards));
    case "divide":
      return choose(answer.amount);
    case "payMana":
      return choose(nonZero(answer.payment));
    case "cancelCast":
      return choose("cancel");
    case "declareAttacker":
    case "declareBlocker":
    case "finishDeclaring":
      return declaration(state, actions, i, cards);
    case "assignDamage":
      return division(state, actions, i, cards);
    case "chooseCard": {
      // By name, with `#n` among the options of that name when there are several: which copy can matter to a replay.
      const pending = state.pending;
      const option = pending?.kind === "chooseCards" ? pending.options[answer.option] : undefined;
      if (pending?.kind !== "chooseCards" || option === undefined) throw new Error(`no option ${answer.option}`);
      const name = nameOf(state, option, cards);
      const named = pending.options.flatMap((id, j) => (nameOf(state, id, cards) === name ? [j] : []));
      return choose(named.length > 1 ? `${name}#${named.indexOf(answer.option) + 1}` : name);
    }
    case "finishChoosing":
      return choose("finish");
    case "chooseYesNo":
      return choose(answer.yes ? "yes" : "no");
  }
}

/** A permanent named relative to its controller, as `attack`, `block` and `assign` steps name it (`Grizzly Bears#2`). */
function local(state: GameState, id: ObjectId, cards: CardDatabase): string {
  return (refOf(state, id, cards) ?? nameOf(state, id, cards)).replace(/^p\d+:/, "");
}

/** One declaration's answers, up to and including `finishDeclaring`, as one `attack` or `block` step. */
function declaration(
  state: GameState,
  actions: readonly Action[],
  i: number,
  cards: CardDatabase,
): { step: Step; taken: number } {
  const pending = state.pending;
  const p = (actions[i] as Action & { player: PlayerId }).player;
  const end = actions.findIndex((a, j) => j >= i && a.type === "ANSWER" && a.answer.kind === "finishDeclaring");
  if (end < 0) throw new Error("the game stops part way through a declaration, which a scenario can't write");
  const answers = actions.slice(i, end).map((a) => (a.type === "ANSWER" ? a.answer : null));
  // Scenario steps attack the one other player; several defending players can't be written yet.
  const others = state.turnOrder.filter((x) => x !== p);
  if (pending?.kind === "declareAttackers") {
    const attackers = answers.map((a) => {
      if (a?.kind !== "declareAttacker") throw new Error("an unexpected answer in a declaration of attackers");
      if (others.length !== 1 || a.attack.defender !== others[0])
        throw new Error("attacks on several players can't be written");
      return local(state, a.attack.attacker, cards);
    });
    return { step: { [`${p} attack`]: attackers }, taken: end - i + 1 };
  }
  const blocks = answers.map((a): [string, string] => {
    if (a?.kind !== "declareBlocker") throw new Error("an unexpected answer in a declaration of blockers");
    return [local(state, a.block.blocker, cards), local(state, a.block.attacker, cards)];
  });
  // A blocker of several attackers gets a list (Palace Guard). Grouping can reorder blocks across blockers, which only
  // changes the order an attacker's blockers are listed in; `assign` names them in any order.
  const byBlocker: Record<string, string[]> = {};
  for (const [blocker, attacker] of blocks) byBlocker[blocker] = [...(byBlocker[blocker] ?? []), attacker];
  const map = Object.fromEntries(Object.entries(byBlocker).map(([b, as]) => [b, as.length === 1 ? as[0] : as]));
  return { step: { [`${p} block`]: map }, taken: end - i + 1 };
}

/** One attacker's division of damage: an answer per recipient but the last, which gets the rest. */
function division(
  state: GameState,
  actions: readonly Action[],
  i: number,
  cards: CardDatabase,
): { step: Step; taken: number } {
  const pending = state.pending;
  if (pending?.kind !== "assignDamage") throw new Error("an assignDamage answer without its decision");
  // One answer per question; answers with only one legal amount the engine fills in, as it does for the game.
  let amounts: number[] = [];
  let count = 0;
  while (amounts.length < pending.recipients.length - 1) {
    const a = actions[i + count];
    if (a?.type !== "ANSWER" || a.answer.kind !== "assignDamage") {
      throw new Error("the game stops part way through dividing damage, which a scenario can't write");
    }
    amounts = withForcedAnswers({ ...pending, assigned: amounts }, [...amounts, a.answer.amount]);
    count++;
  }
  const last = pending.amount - amounts.reduce((sum, n) => sum + n, 0);
  const name = (to: Target) => (to.kind === "player" ? to.player : local(state, to.object, cards));
  const map = Object.fromEntries(pending.recipients.map((to, j) => [name(to), amounts[j] ?? last]));
  return { step: { [`${pending.player} assign`]: map }, taken: count };
}

/** A card in hand by name, with `#n` when the hand holds several copies (which copy can matter, CR 103.5). */
function handCardName(state: GameState, player: PlayerId, id: ObjectId, cards: CardDatabase): string {
  const name = nameOf(state, id, cards);
  const copies = (state.zones.players[player]?.hand ?? []).filter((x) => nameOf(state, x, cards) === name);
  return copies.length > 1 ? `${name}#${copies.indexOf(id) + 1}` : name;
}

function targetName(state: GameState, target: Target, cards: CardDatabase): string {
  if (target.kind === "player") return target.player;
  return (
    refOf(state, target.object, cards) ??
    spellRef(state, target.object, cards) ??
    graveyardRef(state, target.object, cards) ??
    nameOf(state, target.object, cards)
  );
}

/** A card in a graveyard, named as `targets:` names it (`graveyard:p1:Grizzly Bears`, `#2` counting from the bottom). */
function graveyardRef(state: GameState, id: ObjectId, cards: CardDatabase): string | null {
  const player = state.turnOrder.find((p) => state.zones.players[p]?.graveyard.includes(id));
  if (player === undefined) return null;
  const name = nameOf(state, id, cards);
  const same = (state.zones.players[player]?.graveyard ?? []).filter((x) => nameOf(state, x, cards) === name);
  return same.length > 1 ? `graveyard:${player}:${name}#${same.indexOf(id) + 1}` : `graveyard:${player}:${name}`;
}

/** A spell on the stack, named only as a spell (`spell:p1:Lightning Bolt`, `#2` counting from the bottom). */
function spellRef(state: GameState, id: ObjectId, cards: CardDatabase): string | null {
  if (!state.zones.stack.includes(id) || state.objects[id]?.kind !== "card") return null;
  const player = controllerOf(state, id);
  const name = nameOf(state, id, cards);
  const same = state.zones.stack.filter(
    (x) => state.objects[x]?.kind === "card" && controllerOf(state, x) === player && nameOf(state, x, cards) === name,
  );
  return same.length > 1 ? `spell:${player}:${name}#${same.indexOf(id) + 1}` : `spell:${player}:${name}`;
}

function nonZero(pool: ManaPool): Record<string, number> {
  return Object.fromEntries(Object.entries(pool).filter(([, n]) => n !== 0));
}

/** Where everything ended up: what a reader of the scenario would want checked. */
function finalExpect(state: GameState, cards: CardDatabase): Record<string, unknown> {
  const expect: Record<string, unknown> = {};
  const names = (ids: readonly ObjectId[]) => ids.map((id) => nameOf(state, id, cards));
  for (const p of state.turnOrder) {
    const zones = state.zones.players[p];
    expect[`${p}.life`] = state.players[p]?.life;
    expect[`${p}.hand`] = names(zones?.hand ?? []);
    expect[`${p}.graveyard`] = names(zones?.graveyard ?? []);
    expect[`${p}.battlefield`] = names(
      state.zones.battlefield.filter((id) => refOf(state, id, cards)?.startsWith(`${p}:`)),
    );
  }
  expect.stack = names(state.zones.stack);
  if (state.result !== null) {
    expect.winner = state.result.winner ?? "draw";
  } else {
    if (state.turn !== null) {
      expect.turn = state.turn.number;
      expect.step = scenarioStep(state.turn.step);
    }
    expect.pending = state.pending === null ? null : { player: state.pending.player, kind: state.pending.kind };
  }
  return expect;
}

/** The game's setup in the scenario format (docs/testing.md, "setup"). */
function scenarioSetup(setup: GameSetup, cards: CardDatabase): Record<string, unknown> {
  const card = (oracleId: string) => cards[oracleId]?.printed.name ?? oracleId;
  const out: Record<string, unknown> = { seed: setup.seed };
  switch (setup.opening.kind) {
    case "standard":
      out.opening = "standard";
      if (setup.opening.firstPlayer !== null) out.first = setup.opening.firstPlayer;
      break;
    case "fixed":
      out.turn = {
        active: setup.opening.turn.activePlayer,
        step: scenarioStep(setup.opening.turn.step),
        number: setup.opening.turn.number,
      };
      break;
  }
  if (setup.ruleModifiers.length > 0) out.rules = setup.ruleModifiers;
  for (const player of setup.players) {
    const p: Record<string, unknown> = { life: player.life, library: player.library.map(card) };
    if (player.hand.length > 0) p.hand = player.hand.map(card);
    if (player.battlefield.length > 0) {
      p.battlefield = player.battlefield.map((perm) => {
        const entry: Record<string, unknown> = { card: card(perm.oracleId) };
        if (perm.tapped) entry.tapped = true;
        if (perm.summoningSick) entry.sick = true;
        if (perm.damage > 0) entry.damage = perm.damage;
        if (Object.keys(perm.counters).length > 0) entry.counters = perm.counters;
        return entry;
      });
    }
    if (player.graveyard.length > 0) p.graveyard = player.graveyard.map(card);
    if (player.exile.length > 0) p.exile = player.exile.map(card);
    const pool = nonZero(player.manaPool);
    if (Object.keys(pool).length > 0) p.manaPool = pool;
    out[player.id] = p;
  }
  return out;
}
