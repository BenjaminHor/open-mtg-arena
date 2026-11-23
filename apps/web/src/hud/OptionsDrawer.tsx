// Every legal action as a button, the M3-03 list kept as a drawer at the top right until M3-04b gives each decision
// its own prompt (tap a card to cast it, tap to attack). It opens by itself when a decision other than priority waits,
// since the main button can't answer it.

import type { Action, SeatView } from "@mtg/engine";
import { useState } from "react";
import { optionLabel } from "../app/option-label.ts";

export function OptionsDrawer({ shown, act }: { shown: SeatView; act: (action: Action) => void }) {
  const [asked, setAsked] = useState(false);
  const deciding = shown.options.length > 0 && !shown.options.some((o) => o.action.type === "PASS_PRIORITY");
  const open = asked || deciding;
  return (
    <div className="drawer">
      <button type="button" className="drawer-toggle" aria-expanded={open} onClick={() => setAsked(!asked)}>
        Actions {shown.options.length}
      </button>
      {open && (
        <fieldset className="options" aria-label="Actions">
          {shown.options.map((option, i) => (
            <button
              type="button"
              // The options are listed in the engine's order, which doesn't change while they're shown.
              // biome-ignore lint/suspicious/noArrayIndexKey: no other stable key for an action
              key={i}
              // A spell or ability the person's mana can't pay for now is shown but not offered (seatView's hint).
              disabled={option.mightPay === false}
              onClick={() => act(option.action)}
            >
              {optionLabel(shown, option.action)}
            </button>
          ))}
        </fieldset>
      )}
    </div>
  );
}
