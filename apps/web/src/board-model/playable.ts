// What the person can act with right now, for the cyan outline [R] (arena-research.md, "The owner's phone screenshots,
// second set"): a land they can play, a spell they can cast or a non-mana ability they can activate (unless their mana
// surely can't pay for it), a creature they can declare as an attacker or a blocker, a card they can choose (a target,
// one to put on the bottom, discard or sacrifice). Read from the seat view's options, so the
// UI never decides legality itself (ui.md, "Touch interaction").

import { isManaAbility, type ObjectId, type SeatView } from "@mtg/engine";

export function playableIds(shown: SeatView): Set<ObjectId> {
  const ids = new Set<ObjectId>();
  for (const option of shown.options) {
    const action = option.action;
    switch (action.type) {
      case "PLAY_LAND":
        ids.add(action.object);
        break;
      case "CAST_SPELL":
        if (option.mightPay !== false) ids.add(action.object);
        break;
      case "ACTIVATE_ABILITY":
        // Tapping for mana is how a cost gets paid, not something to do on its own: lands and mana creatures don't
        // light up for it, as in Arena [R].
        if (option.mightPay !== false && !(option.ability !== null && isManaAbility(option.ability))) {
          ids.add(action.object);
        }
        break;
      case "ANSWER":
        switch (action.answer.kind) {
          case "declareAttacker":
            ids.add(action.answer.attack.attacker);
            break;
          case "declareBlocker":
            ids.add(action.answer.block.blocker);
            break;
          // A card that can be chosen now: a valid target glows [R] (ui.md "Clarity"), as does a card to put on the
          // bottom, discard or sacrifice.
          case "chooseTarget":
            if (action.answer.target.kind === "object") ids.add(action.answer.target.object);
            break;
          case "mulliganBottom":
          case "discardToHandSize":
          case "chooseSacrifice":
            ids.add(action.answer.object);
            break;
          default:
            break;
        }
        break;
      case "PASS_PRIORITY":
      case "CONCEDE":
        break;
    }
  }
  return ids;
}
