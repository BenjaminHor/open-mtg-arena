// Writing a declaration of attackers or blockers, and a division of combat damage, as scenario steps (export.ts).

import {
  type Action,
  type Answer,
  type Attack,
  type CardDatabase,
  type GameState,
  type ObjectId,
  type PlayerId,
  type Target,
  withForcedAnswers,
} from "@mtg/engine";
import { nameOf, refOf } from "./names.ts";

type Step = Record<string, unknown>;

/** A permanent named relative to its controller, as `attack`, `block` and `assign` steps name it (`Grizzly Bears#2`). */
export function local(state: GameState, id: ObjectId, cards: CardDatabase): string {
  return (refOf(state, id, cards) ?? nameOf(state, id, cards)).replace(/^p\d+:/, "");
}

/** One declaration's answers, up to and including `finishDeclaring`, as one `attack` or `block` step. */
export function declaration(
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
  // A declaration with a pick taken back is written one answer at a time, as `choose:` steps, so the replay takes the
  // same decisions: from its first answer to its last, once picks are already declared too.
  const pickedAlready =
    (pending?.kind === "declareAttackers" || pending?.kind === "declareBlockers") && pending.chosen.length > 0;
  if (pickedAlready || answers.some((a) => a?.kind === "takeBack"))
    return { step: { [`${p} choose`]: declarationChoice(state, answerOf(actions[i]), cards) }, taken: 1 };
  // Scenario steps attack the one other player; several defending players can't be written yet.
  const others = state.turnOrder.filter((x) => x !== p);
  if (pending?.kind === "declareAttackers") {
    const attackers = answers.map((a) => {
      if (a?.kind !== "declareAttacker") throw new Error("an unexpected answer in a declaration of attackers");
      if (others.length !== 1 || a.attack.defender !== others[0])
        throw new Error("attacks on several players can't be written");
      return attackText(state, a.attack, cards);
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
export function division(
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

/** One answer of a declaration as a `choose:` value: "Runeclaw Bear", "Giant Spider blocks Craw Wurm", "take back". */
function declarationChoice(state: GameState, answer: Answer | null, cards: CardDatabase): string {
  switch (answer?.kind) {
    case "declareAttacker":
      return attackText(state, answer.attack, cards);
    case "declareBlocker":
      return `${local(state, answer.block.blocker, cards)} blocks ${local(state, answer.block.attacker, cards)}`;
    case "takeBack":
      return "take back";
    case "finishDeclaring":
      return "done";
    default:
      throw new Error("an unexpected answer in a declaration");
  }
}

function answerOf(action: Action | undefined): Answer | null {
  return action?.type === "ANSWER" ? action.answer : null;
}

/** An attack as a step names it: the attacker, and "-> <planeswalker>" when it attacks one (CR 508.1b). */
function attackText(state: GameState, attack: Attack, cards: CardDatabase): string {
  const attacker = local(state, attack.attacker, cards);
  return attack.planeswalker === undefined ? attacker : `${attacker} -> ${local(state, attack.planeswalker, cards)}`;
}
