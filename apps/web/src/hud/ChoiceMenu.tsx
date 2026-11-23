// A small menu by a card when a tap on it could mean more than one thing (two abilities; attacking the player or a
// planeswalker). Focus moves to its first entry as it opens, so the keyboard is right there; Escape or a tap elsewhere
// closes it.

import type { Action } from "@mtg/engine";
import { useEffect, useRef } from "react";
import type { Rect } from "../board-model/board-model.ts";
import type { Choice } from "../interaction/controls.ts";
import { ManaText } from "./ManaText.tsx";

export function ChoiceMenu(props: { at: Rect; choices: Choice[]; act: (action: Action) => void; close: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <fieldset
      className="choice-menu"
      aria-label="Choose"
      style={{ left: props.at.x + props.at.width / 2, top: props.at.y }}
    >
      {props.choices.map((choice, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: the menu's choices don't change while it's open
          key={i}
          ref={i === 0 ? first : undefined}
          type="button"
          onClick={() => {
            props.close();
            props.act(choice.action);
          }}
        >
          <ManaText text={choice.label} />
        </button>
      ))}
    </fieldset>
  );
}
