// What the card view adds for an object on the stack (M3-04c slice 6; arena-research.md §5): an ability's own panel
// (its source's name and art, its kind and its own text [R]) rather than its source card, and for every object what
// was chosen as it was put there: its targets and their shares of a divided effect, X (CR 601.2b-d). The UX review of slice 2 asked for
// these; Arena shows targets on hover [R] and X on the spell [R].

import type { ObjectId, SeatView, SeenAbility, StackChoices, Target } from "@mtg/engine";
import { abilityKind, abilityText } from "../board-model/ability-text.ts";
import { cardInfo } from "../board-model/card-info.ts";
import type { CardDetails } from "./card-details.ts";
import { objectName, who } from "./names.ts";

/** An ability on the stack as its own panel, with where it came from and what it chose. */
export function abilityDetails(shown: SeatView, ability: SeenAbility): CardDetails {
  const info = cardInfo(ability.sourceOracleId);
  const source = shown.seen[ability.source];
  return {
    name: info?.name ?? "Ability",
    image: null,
    // A crop of the source's art, so its artist is credited beside it (data-sources.md).
    art: info === null ? null : { url: info.artCrop, artist: info.artist },
    manaCost: "",
    typeLine: abilityKind(ability),
    oracleText: abilityText(info?.oracleText ?? "", ability.ability) ?? info?.oracleText ?? "",
    powerToughness: null,
    hangers: [
      {
        title: "From",
        // Its source may be gone since (a "dies" trigger, a sacrifice for its cost): the ability goes on without it
        // (CR 113.7a).
        text:
          source?.kind === "card"
            ? `${source.characteristics.name}, ${where(shown, source.id)}`
            : "Its source is no longer there",
      },
      ...choiceHangers(shown, ability.choices),
    ],
  };
}

/**
 * What was chosen for a spell or ability as it was put on the stack: its targets (with each one's share, when an effect
 * is divided among them, CR 601.2d), and X.
 */
export function choiceHangers(shown: SeatView, choices: StackChoices | null): CardDetails["hangers"] {
  if (choices === null) return [];
  const hangers: CardDetails["hangers"] = [];
  const targets = choices.targets.flat();
  const shares = choices.division?.shares ?? [];
  if (targets.length > 0) {
    hangers.push({
      title: targets.length === 1 ? "Target" : "Targets",
      text: targets
        .map((t) => {
          const share = shares.find((s) => sameTarget(s.target, t));
          return share === undefined ? targetText(shown, t) : `${share.amount} to ${targetText(shown, t)}`;
        })
        .join(", "),
    });
  }
  if (choices.x !== null) hangers.push({ title: "X", text: `${choices.x}` });
  return hangers;
}

function sameTarget(a: Target, b: Target): boolean {
  return a.kind === "player"
    ? b.kind === "player" && a.player === b.player
    : b.kind === "object" && a.object === b.object;
}

/** A target as the person reads it: a player, or an object by name, with where it is when that isn't plain. */
function targetText(shown: SeatView, target: Target): string {
  if (target.kind === "player") return who(shown, target.player);
  // Gone from where the person can see it (a new object elsewhere, CR 400.7; a token ceased to exist; resolved).
  if (shown.seen[target.object] === undefined) return "one no longer there";
  const name = objectName(shown, target.object);
  return shown.view.zones.battlefield.includes(target.object) ? name : `${name}, ${where(shown, target.object)}`;
}

/** Where an object the person can see is, in words: a graveyard by whose it is (CR 404.1: each player has one). */
function where(shown: SeatView, id: ObjectId): string {
  const zones = shown.view.zones;
  if (zones.battlefield.includes(id)) return "on the battlefield";
  if (zones.stack.includes(id)) return "on the stack";
  if (zones.exile.includes(id)) return "in exile";
  for (const [player, own] of Object.entries(zones.players)) {
    const whose = player === shown.player ? "your" : "your opponent's";
    if (own.graveyard.includes(id)) return `in ${whose} graveyard`;
    if (own.hand?.includes(id)) return `in ${whose} hand`;
  }
  return "out of view";
}
