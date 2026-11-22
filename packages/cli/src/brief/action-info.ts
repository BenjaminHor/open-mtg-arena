// What `brief` says about each of the viewer's legal actions (M2-15f, part 3): what it costs, whether the viewer's
// mana could pay it now, and what it could target. All of it is the viewer's own business: a brief lists actions only
// for the player who must decide.

import {
  type Action,
  abilitiesOf,
  actionManaCost,
  type CardDatabase,
  type CostPart,
  type GameState,
  isManaAbility,
  legalTargets,
  mightPay,
  type ObjectFilter,
  type ObjectId,
  type PlayerId,
  sameAbilityRef,
  type TargetSpec,
  targetSpecsOf,
} from "@mtg/engine";
import { actionText, targetText } from "../describe.ts";
import { manaCostText } from "./brief-objects.ts";

export type ActionInfo = {
  /** The number `do <file> <n>` takes, as `actions` numbers it. */
  n: number;
  text: string;
  /** A spell's mana cost or an ability's whole cost, `{2}{W}{W}`, `{T}, Sacrifice a creature`; null for the rest. */
  cost: string | null;
  /**
   * A hint, not a rule: whether the viewer's mana in pool and untapped sources could pay the mana part now (X as 0).
   * Starting an action you can't pay is legal, and it's undone when the cost can't be paid (CR 601.2h, 734); a cost increase for extra targets
   * (Fireball) is only known once the targets are chosen. Null when the action has no mana cost.
   */
  payable: boolean | null;
  /** For each "target" in its text, the legal choices now, by reference (CR 115); empty when it has none. */
  targets: string[][];
  /** A mana ability, which doesn't use the stack (CR 605.3b): listed apart, as `pay: auto` usually covers it. */
  mana: boolean;
};

export function actionInfos(
  state: GameState,
  viewer: PlayerId,
  actions: readonly Action[],
  cards: CardDatabase,
): ActionInfo[] {
  return actions.map((action, i) => ({
    n: i + 1,
    text: actionText(state, action, cards),
    ...detail(state, viewer, action, cards),
  }));
}

type Detail = Omit<ActionInfo, "n" | "text">;

const NONE: Detail = { cost: null, payable: null, targets: [], mana: false };

function detail(state: GameState, viewer: PlayerId, action: Action, cards: CardDatabase): Detail {
  switch (action.type) {
    case "CAST_SPELL": {
      const obj = state.objects[action.object];
      if (obj?.kind !== "card") return NONE;
      // The same cost and payability hint the match host's auto-pass reads (`actionManaCost`, `mightPay`).
      const manaCost = actionManaCost(state, action, cards);
      return {
        cost: manaCost === null ? null : manaCostText(manaCost),
        payable: manaCost === null ? null : mightPay(state, viewer, manaCost, cards),
        targets: targetChoices(state, viewer, action.object, targetSpecsOf(state, action.object, cards), cards),
        mana: false,
      };
    }
    case "ACTIVATE_ABILITY": {
      const ability = abilitiesOf(state, action.object, cards).find((a) => sameAbilityRef(a.ref, action.ability));
      if (ability === undefined) return NONE;
      const manaPart = actionManaCost(state, action, cards);
      const mana = isManaAbility(ability.def);
      return {
        cost: ability.def.cost.map(costPartText).join(", "),
        payable: manaPart === null || manaPart.length === 0 ? null : mightPay(state, viewer, manaPart, cards),
        targets: targetChoices(state, viewer, action.object, ability.def.targets, cards),
        mana,
      };
    }
    case "PASS_PRIORITY":
    case "PLAY_LAND":
    case "ANSWER":
    case "CONCEDE":
      return NONE;
  }
}

function targetChoices(
  state: GameState,
  viewer: PlayerId,
  object: ObjectId,
  specs: readonly TargetSpec[],
  cards: CardDatabase,
): string[][] {
  const by = { object, controller: viewer };
  return specs.map((spec) => legalTargets(state, spec, by, cards).map((t) => targetText(state, t, cards)));
}

/** "Goblin", "creature", "artifact creature"; "permanent" when the filter names no type. */
function sacrificeNoun(filter: ObjectFilter): string {
  const words = [...(filter.subtypes ?? []), ...(filter.types ?? [])];
  return words.length === 0 ? "permanent" : words.join(" ");
}

function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/** `{2}{R}`, `{T}`, `Sacrifice a Goblin`, `+1`, `−X`. */
function costPartText(part: CostPart): string {
  switch (part.kind) {
    case "mana":
      return manaCostText(part.cost);
    case "tap":
      return "{T}";
    case "sacrifice":
      return `Sacrifice ${withArticle(sacrificeNoun(part.filter))}`;
    case "sacrificeSelf":
      return "Sacrifice this";
    case "loyalty":
      return part.amount === "minusX" ? "−X" : part.amount >= 0 ? `+${part.amount}` : `−${-part.amount}`;
    case "removeCounters":
      return `Remove ${part.amount} ${part.counter} counter${part.amount > 1 ? "s" : ""}`;
  }
}
