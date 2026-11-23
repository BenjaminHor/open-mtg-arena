// What the game is waiting for, in words, and the choices the board can't offer on a card (M3-04b; ui.md "Clarity":
// always say what the game is waiting for). A banner between the battlefields ("Choose a target", "Choose blockers")
// [R], with a row of buttons under it when there are choices to make here: keep or mulligan, X, how to divide damage,
// which trigger first.

import type { Action } from "@mtg/engine";
import type { Controls } from "../interaction/controls.ts";

export function Prompt({
  prompt,
  title,
  busy,
  act,
}: {
  prompt: Controls["prompt"];
  title: string | null;
  busy: boolean;
  act: (action: Action) => void;
}) {
  if (prompt === null && title === null) return null;
  return (
    <section className="prompt" aria-label={prompt?.title ?? title ?? undefined}>
      <p className="prompt-title">{prompt?.title ?? title}</p>
      {prompt !== null && (
        <div className="prompt-choices">
          {prompt.choices.map((choice, i) => (
            <button
              // The choices keep the engine's order while they're shown.
              // biome-ignore lint/suspicious/noArrayIndexKey: no other stable key for an action
              key={i}
              type="button"
              disabled={busy}
              onClick={() => act(choice.action)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
