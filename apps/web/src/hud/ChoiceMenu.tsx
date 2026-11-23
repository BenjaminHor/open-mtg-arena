// A small menu by a card when a tap on it could mean more than one thing (two abilities; attacking the player or a
// planeswalker). Escape or a tap elsewhere closes it.

import type { Action } from "@mtg/engine";
import type { Rect } from "../board-model/board-model.ts";
import type { Choice } from "../interaction/controls.ts";

export function ChoiceMenu(props: { at: Rect; choices: Choice[]; act: (action: Action) => void; close: () => void }) {
  return (
    <div className="choice-menu" role="menu" style={{ left: props.at.x + props.at.width / 2, top: props.at.y }}>
      {props.choices.map((choice, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: the menu's choices don't change while it's open
          key={i}
          type="button"
          role="menuitem"
          onClick={() => {
            props.close();
            props.act(choice.action);
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
