// What the card view adds for an object on the stack (M3-04c slice 6; arena-research.md §5): an ability's own panel
// (its source's name and art, its kind and its own text [R]) rather than its source card, and for every object what
// was chosen as it was put there: its targets, X, a divided effect (CR 601.2b-d). The UX review of slice 2 asked for
// these; Arena shows targets on hover [R] and X on the spell [R].

import type { ObjectId, SeatView, SeenAbility, StackChoices, Target } from "@mtg/engine";
import { abilityText } from "../board-model/ability-text.ts";
import { cardInfo } from "../board-model/card-info.ts";
import { abilityKind } from "../board-model/stack.ts";
import type { CardDetails } from "./card-details.ts";
import { objectName } from "./prompt-text.ts";

/** An ability on the stack as its own panel, with where it came from and what it chose. */
export function abilityDetails(shown: SeatView, ability: SeenAbility): CardDetails {
  const info = cardInfo(ability.sourceOracleId);
  const source = shown.seen[ability.source];
  return {
    name: info?.name ?? "Ability",
    image: null,
    art: info?.artCrop ?? null,
    manaCost: "",
    typeLine: abilityKind(ability),
    oracleText: abilityText(info?.oracleText ?? "", ability.ability) ?? info?.oracleText ?? "",
    powerToughness: null,
    hangers: [
      {
        title: "From",
        // Its source may have left since (a "dies" trigger, a sacrifice for its cost): the ability goes on without it
        // (CR 113.7a).
        text:
          source?.kind === "card"
            ? `${source.characteristics.name}, ${where(shown, source.id)}`
            : "Its source has left",
      },
      ...choiceHangers(shown, ability.choices),
    ],
  };
}

/** What was chosen for a spell or ability as it was put on the stack: its targets, X, how an effect is divided. */
export function choiceHangers(shown: SeatView, choices: StackChoices | null): CardDetails["hangers"] {
  if (choices === null) return [];
  const hangers: CardDetails["hangers"] = [];
  const targets = choices.targets.flat();
  if (targets.length > 0) {
    hangers.push({
      title: targets.length === 1 ? "Target" : "Targets",
      text: targets.map((t) => targetText(shown, t)).join(", "),
    });
  }
  if (choices.x !== null) hangers.push({ title: "X", text: `${choices.x}` });
  if (choices.division !== null) {
    hangers.push({
      title: "Divided",
      text: choices.division.shares.map((s) => `${s.amount} to ${targetText(shown, s.target)}`).join(", "),
    });
  }
  return hangers;
}

/** A target as the person reads it: a player, or an object by name, with where it is when that isn't plain. */
function targetText(shown: SeatView, target: Target): string {
  if (target.kind === "player") return target.player === shown.player ? "You" : "Your opponent";
  const seen = shown.seen[target.object];
  // Gone from where the person can see it (a new object elsewhere, CR 400.7): the target is no longer there.
  if (seen === undefined) return "a card that has left";
  const name = objectName(shown, target.object);
  return shown.view.zones.battlefield.includes(target.object) ? name : `${name}, ${where(shown, target.object)}`;
}

function where(shown: SeatView, id: ObjectId): string {
  const zones = shown.view.zones;
  if (zones.battlefield.includes(id)) return "on the battlefield";
  if (zones.stack.includes(id)) return "on the stack";
  if (zones.exile.includes(id)) return "in exile";
  if (Object.values(zones.players).some((p) => p.graveyard.includes(id))) return "in a graveyard";
  return "in a hand";
}
