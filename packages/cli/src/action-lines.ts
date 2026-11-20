// Golden games' compact action format (D-082): one readable line per action, such as `pass 4`, `land o85`, `cast o12`,
// `activate o5 printed 0 for G`, `chooseTarget p2` or `declareBlocker o7 o5`. A line leaves out the decision id and the
// acting player: both follow from the pending decision, so decoding replays the game to fill them in. A run of
// passes, by either player, is one line. Each kind of action and answer is one case of a switch, so a new one can't be
// left out.

import {
  type AbilityRef,
  type Action,
  type Answer,
  applyAction,
  type BasicLandType,
  type CardDatabase,
  type Color,
  createGame,
  type GameSetup,
  type GameState,
  type ManaPool,
  type ObjectId,
  type PlayerId,
  type Target,
} from "@mtg/engine";

/** The actions as lines: each one in words, runs of passes counted. */
export function actionLines(actions: readonly Action[]): string[] {
  const lines: string[] = [];
  let passes = 0;
  const flush = () => {
    if (passes > 0) lines.push(passes === 1 ? "pass" : `pass ${passes}`);
    passes = 0;
  };
  for (const action of actions) {
    if (action.type === "PASS_PRIORITY") {
      passes++;
      continue;
    }
    flush();
    lines.push(actionLine(action));
  }
  flush();
  return lines;
}

/**
 * The actions these lines stand for, replayed from the setup to fill in each decision id and acting player. Once an
 * action is rejected (the engine changed), the game can't go on, so the actions end with that one: replaying them
 * stops there and says why, as a golden game's log does (D-047).
 */
export function actionsFromLines(setup: GameSetup, lines: readonly string[], cards: CardDatabase): Action[] {
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
  let state = created.state;
  const actions: Action[] = [];
  /** Takes the action; false once one is rejected. */
  const take = (action: Action): boolean => {
    actions.push(action);
    const result = applyAction(state, action, cards);
    if (!result.ok) return false;
    state = result.state;
    return true;
  };
  for (const [i, line] of lines.entries()) {
    const [word = "", ...rest] = line.split(" ");
    const count = word === "pass" && rest.length > 0 ? Number(rest[0]) : 1;
    for (let n = 0; n < count; n++) {
      // A game that ended, or a decision gone, means the rest no longer fits the game: stop as at a rejection.
      if (state.pending === null && word !== "concede") return actions;
      if (!take(fromWords(state, word, rest, i))) return actions;
    }
  }
  return actions;
}

function actionLine(action: Exclude<Action, { type: "PASS_PRIORITY" }>): string {
  switch (action.type) {
    case "PLAY_LAND":
      return `land ${action.object}`;
    case "CAST_SPELL":
      return `cast ${action.object}`;
    case "ACTIVATE_ABILITY":
      return `activate ${action.object} ${abilityWords(action.ability)}${action.color === undefined ? "" : ` for ${action.color}`}`;
    case "CONCEDE":
      return `concede ${action.player}`;
    case "ANSWER":
      return answerLine(action.answer);
  }
}

function abilityWords(ref: AbilityRef): string {
  switch (ref.kind) {
    case "printed":
      return `printed ${ref.index}`;
    case "basicLandType":
      return `land ${ref.landType}`;
    case "triggered":
      return `triggered ${ref.index}`;
  }
}

function answerLine(answer: Answer): string {
  switch (answer.kind) {
    case "chooseStartingPlayer":
      return `${answer.kind} ${answer.player}`;
    case "mulligan":
      return `${answer.kind} ${answer.choice}`;
    case "mulliganBottom":
    case "discardToHandSize":
    case "chooseSacrifice":
      return `${answer.kind} ${answer.object}`;
    case "chooseTarget":
      return `${answer.kind} ${answer.target.kind === "player" ? answer.target.player : answer.target.object}`;
    case "announceX":
      return `${answer.kind} ${answer.value}`;
    case "chooseTargetCount":
      return `${answer.kind} ${answer.count}`;
    case "divide":
    case "assignDamage":
      return `${answer.kind} ${answer.amount}`;
    case "payMana":
      return `${answer.kind} ${manaWords(answer.payment)}`;
    case "declareAttacker":
      return `${answer.kind} ${answer.attack.attacker} ${answer.attack.defender}`;
    case "declareBlocker":
      return `${answer.kind} ${answer.block.blocker} ${answer.block.attacker}`;
    case "orderTrigger":
      return `${answer.kind} ${answer.index}`;
    case "chooseCard":
      return `${answer.kind} ${answer.option}`;
    case "chooseYesNo":
      return `${answer.kind} ${answer.yes ? "yes" : "no"}`;
    case "cancelCast":
    case "finishDeclaring":
    case "takeBack":
    case "finishChoosing":
      return answer.kind;
  }
}

/** A payment as its nonzero amounts, `R2 G1`, or `none`. */
function manaWords(pool: ManaPool): string {
  const parts = (["W", "U", "B", "R", "G", "C"] as const).filter((t) => pool[t] > 0).map((t) => `${t}${pool[t]}`);
  return parts.length === 0 ? "none" : parts.join(" ");
}

/** The action a line's words stand for, answering the pending decision. */
function fromWords(state: GameState, word: string, args: readonly string[], line: number): Action {
  if (word === "concede") return { type: "CONCEDE", player: args[0] as PlayerId };
  const pending = state.pending;
  if (pending === null) throw new Error(`line ${line + 1}: nothing is pending`);
  const asked = { decisionId: pending.id, player: pending.player };
  const object = (i = 0) => args[i] as ObjectId;
  switch (word) {
    case "pass":
      return { type: "PASS_PRIORITY", ...asked };
    case "land":
      return { type: "PLAY_LAND", ...asked, object: object() };
    case "cast":
      return { type: "CAST_SPELL", ...asked, object: object() };
    case "activate": {
      const ability = abilityFrom(args[1], args[2], line);
      const color = args[3] === "for" ? (args[4] as Color) : undefined;
      return {
        type: "ACTIVATE_ABILITY",
        ...asked,
        object: object(),
        ability,
        ...(color === undefined ? {} : { color }),
      };
    }
    default:
      return { type: "ANSWER", ...asked, answer: answerFrom(word, args, line) };
  }
}

function abilityFrom(kind: string | undefined, value: string | undefined, line: number): AbilityRef {
  if (kind === "printed") return { kind: "printed", index: Number(value) };
  if (kind === "land") return { kind: "basicLandType", landType: value as BasicLandType };
  if (kind === "triggered") return { kind: "triggered", index: Number(value) };
  throw new Error(`line ${line + 1}: no ability "${kind}"`);
}

function answerFrom(kind: string, args: readonly string[], line: number): Answer {
  const [a = "", b = ""] = args;
  switch (kind) {
    case "chooseStartingPlayer":
      return { kind, player: a as PlayerId };
    case "mulligan":
      return { kind, choice: a === "keep" ? "keep" : "mulligan" };
    case "mulliganBottom":
    case "discardToHandSize":
    case "chooseSacrifice":
      return { kind, object: a as ObjectId };
    case "chooseTarget":
      return { kind, target: targetFrom(a) };
    case "announceX":
      return { kind, value: Number(a) };
    case "chooseTargetCount":
      return { kind, count: Number(a) };
    case "divide":
    case "assignDamage":
      return { kind, amount: Number(a) };
    case "payMana":
      return { kind, payment: manaFrom(args) };
    case "declareAttacker":
      return { kind, attack: { attacker: a as ObjectId, defender: b as PlayerId } };
    case "declareBlocker":
      return { kind, block: { blocker: a as ObjectId, attacker: b as ObjectId } };
    case "orderTrigger":
      return { kind, index: Number(a) };
    case "chooseCard":
      return { kind, option: Number(a) };
    case "chooseYesNo":
      return { kind, yes: a === "yes" };
    case "cancelCast":
    case "finishDeclaring":
    case "takeBack":
    case "finishChoosing":
      return { kind };
    default:
      throw new Error(`line ${line + 1}: no action "${kind}"`);
  }
}

/** Object ids are `o<number>`, player ids `p<number>` (state/ids.ts). */
function targetFrom(id: string): Target {
  return /^o\d+$/.test(id) ? { kind: "object", object: id as ObjectId } : { kind: "player", player: id as PlayerId };
}

function manaFrom(words: readonly string[]): ManaPool {
  const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const word of words) {
    if (word === "none") continue;
    const type = word[0] as keyof ManaPool;
    pool[type] = Number(word.slice(1));
  }
  return pool;
}
