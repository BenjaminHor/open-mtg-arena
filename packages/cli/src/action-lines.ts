// Golden games' compact action format (D-082, D-083): one readable line per action, starting with the player who acted,
// such as `p1 land o85`, `p2 cast o12`, `p1 activate o5 printed 0 for G`, `p2 chooseTarget p1` or `p2 declareBlocker
// o7 o5`; a run of passes is one line naming who passed, in order: `pass p1 p2 p1 p2`. Only the decision id is left
// out: it follows from the pending decision, so decoding replays the game to fill it in, and the engine refuses a line
// whose player isn't the one being asked, so a change in who gets priority shows. A new kind of action or answer
// can't be left out: encoding uses exhaustive switches, and decoding tables keyed by every kind, both checked by the
// compiler.

import {
  type AbilityRef,
  type Action,
  type Answer,
  applyAction,
  type BasicLandType,
  type CardDatabase,
  type Color,
  createGame,
  type DecisionId,
  type GameSetup,
  type ManaPool,
  type ObjectId,
  type PlayerId,
  type Target,
} from "@mtg/engine";

/** The actions as lines: each one in words after its player, a run of passes as one line naming who passed. */
export function actionLines(actions: readonly Action[]): string[] {
  const lines: string[] = [];
  let passes: PlayerId[] = [];
  const flush = () => {
    if (passes.length > 0) lines.push(`pass ${passes.join(" ")}`);
    passes = [];
  };
  for (const action of actions) {
    if (action.type === "PASS_PRIORITY") {
      passes.push(action.player);
      continue;
    }
    flush();
    lines.push(`${action.player} ${actionLine(action)}`);
  }
  flush();
  return lines;
}

/** What reading lines back gives: the actions, and how many lines were left unread because the game had ended. */
export type ReadBack = { actions: Action[]; unread: number };

/**
 * The actions these lines stand for, replayed from the setup to fill in each decision id; the engine checks each line's
 * player is the one being asked (D-083). Once an
 * action is rejected (the engine changed), the game can't go on, so the actions end with that one: replaying them
 * stops there and says why, as a golden game's log does (D-047). Lines left after the game ended are counted, not
 * dropped in silence, so `pnpm golden:update` can say the game ends earlier now.
 */
export function actionsFromLines(setup: GameSetup, lines: readonly string[], cards: CardDatabase): ReadBack {
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
  let state = created.state;
  const actions: Action[] = [];
  for (const [i, line] of lines.entries()) {
    // Each action of the line, as its player and its words: one per player of a run of passes.
    const words = line.split(" ");
    const steps: [string, string[]][] =
      words[0] === "pass" ? words.slice(1).map((player) => [player, ["pass"]]) : [[words[0] ?? "", words.slice(1)]];
    if (steps.length === 0) throw new Error(`line ${i + 1}: a pass names no player`);
    // One way to write a pass, so files written the same way compare the same.
    if (words[0] !== "pass" && words[1] === "pass") throw new Error(`line ${i + 1}: write passes as "pass p1 p2 ..."`);
    for (const [player, [word = "", ...rest]] of steps) {
      // The game has ended: what's left no longer fits it.
      if (state.pending === null && word !== "concede") return { actions, unread: lines.length - i };
      const action = fromWords(playerFrom(player, i), state.pending?.id ?? null, word, rest, i);
      actions.push(action);
      const result = applyAction(state, action, cards);
      if (!result.ok) return { actions, unread: lines.length - i - 1 };
      state = result.state;
    }
  }
  return { actions, unread: 0 };
}

function playerFrom(word: string, line: number): PlayerId {
  if (!/^p\d+$/.test(word)) throw new Error(`line ${line + 1}: "${word}" isn't a player`);
  return word as PlayerId;
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
      return "concede";
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
    case "delayed":
      // Only `ACTIVATE_ABILITY` names an ability, and a triggered ability is never activated (CR 603.1).
      throw new Error("a delayed triggered ability is never activated");
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
      // The attacked planeswalker last, only when there is one (CR 508.1b).
      return [answer.kind, answer.attack.attacker, answer.attack.defender, answer.attack.attacked ?? ""]
        .join(" ")
        .trim();
    case "declareBlocker":
      return `${answer.kind} ${answer.block.blocker} ${answer.block.attacker}`;
    case "orderTrigger":
      return `${answer.kind} ${answer.index}`;
    case "chooseCard":
    case "chooseReplacement":
      return `${answer.kind} ${answer.option}`;
    case "chooseYesNo":
      return `${answer.kind} ${answer.yes ? "yes" : "no"}`;
    case "chooseName":
      return `${answer.kind} ${answer.name}`;
    case "chooseNewTarget":
      return `${answer.kind} ${answer.target === null ? "keep" : answer.target.kind === "player" ? answer.target.player : answer.target.object}`;
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

/**
 * The action one line (not a run of passes) stands for, answering decision `decisionId` (null when nothing is pending:
 * only a concession fits).
 */
export function actionFromLine(line: string, decisionId: DecisionId | null): Action {
  const [player = "", word = "", ...rest] = line.split(" ");
  return fromWords(playerFrom(player, 0), decisionId, word, rest, 0);
}

/** The action a line's words stand for, by `player`, answering decision `decisionId`. */
function fromWords(
  player: PlayerId,
  decisionId: DecisionId | null,
  word: string,
  args: readonly string[],
  line: number,
): Action {
  if (word === "concede") return { type: "CONCEDE", player };
  if (decisionId === null) throw new Error(`line ${line + 1}: nothing is pending`);
  const asked = { decisionId, player };
  const object = args[0] as ObjectId;
  switch (word) {
    case "pass":
      return { type: "PASS_PRIORITY", ...asked };
    case "land":
      return { type: "PLAY_LAND", ...asked, object };
    case "cast":
      return { type: "CAST_SPELL", ...asked, object };
    case "activate": {
      const ability = abilityFrom(args[1], args[2], line);
      const color = args[3] === "for" ? (args[4] as Color) : undefined;
      return { type: "ACTIVATE_ABILITY", ...asked, object, ability, ...(color === undefined ? {} : { color }) };
    }
  }
  const decode = ANSWERS[word as Answer["kind"]];
  if (decode === undefined) throw new Error(`line ${line + 1}: no action "${word}"`);
  return { type: "ANSWER", ...asked, answer: decode(args, line) };
}

/** Each ability reference by its word in a line; a new `AbilityRef` kind must be added here. */
const ABILITIES: { [K in AbilityRef["kind"]]: (value: string) => Extract<AbilityRef, { kind: K }> } = {
  printed: (value) => ({ kind: "printed", index: Number(value) }),
  basicLandType: (value) => ({ kind: "basicLandType", landType: value as BasicLandType }),
  triggered: (value) => ({ kind: "triggered", index: Number(value) }),
  delayed: () => {
    throw new Error("a delayed triggered ability is never activated");
  },
};
const ABILITY_WORDS: Record<string, AbilityRef["kind"]> = {
  printed: "printed",
  land: "basicLandType",
  triggered: "triggered",
};

function abilityFrom(word: string | undefined, value: string | undefined, line: number): AbilityRef {
  const kind = ABILITY_WORDS[word ?? ""];
  if (kind === undefined || value === undefined) throw new Error(`line ${line + 1}: no ability "${word} ${value}"`);
  return ABILITIES[kind](value);
}

/** One of these words, or the line is wrong. */
function oneOf<T extends string>(word: string | undefined, allowed: readonly T[], line: number): T {
  if (!allowed.includes(word as T)) throw new Error(`line ${line + 1}: "${word}" isn't one of ${allowed.join(", ")}`);
  return word as T;
}

type Decode<K extends Answer["kind"]> = (args: readonly string[], line: number) => Extract<Answer, { kind: K }>;

/** Each answer read back from its words; a new `Answer` kind must be added here, as in `answerLine`. */
const ANSWERS: { [K in Answer["kind"]]: Decode<K> } = {
  chooseStartingPlayer: ([a]) => ({ kind: "chooseStartingPlayer", player: a as PlayerId }),
  mulligan: ([a], line) => ({ kind: "mulligan", choice: oneOf(a, ["keep", "mulligan"], line) }),
  mulliganBottom: ([a]) => ({ kind: "mulliganBottom", object: a as ObjectId }),
  discardToHandSize: ([a]) => ({ kind: "discardToHandSize", object: a as ObjectId }),
  chooseSacrifice: ([a]) => ({ kind: "chooseSacrifice", object: a as ObjectId }),
  chooseTarget: ([a = ""]) => ({ kind: "chooseTarget", target: targetFrom(a) }),
  announceX: ([a]) => ({ kind: "announceX", value: Number(a) }),
  chooseTargetCount: ([a]) => ({ kind: "chooseTargetCount", count: Number(a) }),
  divide: ([a]) => ({ kind: "divide", amount: Number(a) }),
  assignDamage: ([a]) => ({ kind: "assignDamage", amount: Number(a) }),
  payMana: (args) => ({ kind: "payMana", payment: manaFrom(args) }),
  declareAttacker: ([a, b, c]) => ({
    kind: "declareAttacker",
    attack: {
      attacker: a as ObjectId,
      defender: b as PlayerId,
      ...(c === undefined ? {} : { attacked: c as ObjectId }),
    },
  }),
  declareBlocker: ([a, b]) => ({ kind: "declareBlocker", block: { blocker: a as ObjectId, attacker: b as ObjectId } }),
  orderTrigger: ([a]) => ({ kind: "orderTrigger", index: Number(a) }),
  chooseCard: ([a]) => ({ kind: "chooseCard", option: Number(a) }),
  chooseReplacement: ([a]) => ({ kind: "chooseReplacement", option: Number(a) }),
  // A card name may have spaces: every word after the kind.
  chooseName: (args) => ({ kind: "chooseName", name: args.join(" ") }),
  chooseNewTarget: ([a = ""]) => ({ kind: "chooseNewTarget", target: a === "keep" ? null : targetFrom(a) }),
  chooseYesNo: ([a], line) => ({ kind: "chooseYesNo", yes: oneOf(a, ["yes", "no"], line) === "yes" }),
  cancelCast: () => ({ kind: "cancelCast" }),
  finishDeclaring: () => ({ kind: "finishDeclaring" }),
  takeBack: () => ({ kind: "takeBack" }),
  finishChoosing: () => ({ kind: "finishChoosing" }),
};

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
