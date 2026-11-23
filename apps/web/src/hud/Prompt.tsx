// What the game is waiting for, in words, and the choices the board can't offer on a card (M3-04b; ui.md "Clarity":
// always say what the game is waiting for). A banner between the battlefields ("Choose a target", "Choose X for
// Fireball") [R], with the choices under it, laid out for what they are (`interaction/prompt-text.ts`): buttons
// ("Keep 7", "Mulligan"), a compact row of numbers (X, dividing damage), or a list with a filter box when there are
// too many to show at once (naming a card: every name in the database).

import type { Action } from "@mtg/engine";
import { useEffect, useState } from "react";
import type { Choice, Controls } from "../interaction/controls.ts";
import type { PromptLayout } from "../interaction/prompt-text.ts";
import { ManaText } from "./ManaText.tsx";

/** How many matches a filtered list shows at once: more is a cue to type more, not a wall of buttons. */
const MOST_SHOWN = 8;

export function Prompt({
  prompt,
  title,
  layout,
  busy,
  act,
}: {
  prompt: Controls["prompt"];
  title: string | null;
  layout: PromptLayout;
  busy: boolean;
  act: (action: Action) => void;
}) {
  if (prompt === null && title === null) return null;
  return (
    <section className="prompt" aria-label={prompt?.title ?? title ?? undefined}>
      {/* Announced as it changes, so a screen reader hears what the game waits for. */}
      <p className="prompt-title" aria-live="polite">
        {prompt?.title ?? title}
      </p>
      {prompt !== null &&
        (layout === "filtered" ? (
          <FilteredChoices choices={prompt.choices} busy={busy} act={act} />
        ) : (
          <Choices choices={prompt.choices} numbers={layout === "numbers"} busy={busy} act={act} />
        ))}
    </section>
  );
}

function Choices(props: { choices: Choice[]; numbers: boolean; busy: boolean; act: (action: Action) => void }) {
  return (
    <div className={`prompt-choices${props.numbers ? " numbers" : ""}`}>
      {props.choices.map((choice) => (
        <button
          // Labels are unique within a prompt (controls.ts numbers repeats), so they're stable keys.
          key={choice.label}
          type="button"
          aria-disabled={props.busy}
          onClick={() => !props.busy && props.act(choice.action)}
        >
          <ManaText text={choice.label} />
        </button>
      ))}
    </div>
  );
}

/** A long list: a filter box (focused, so typing starts at once) and the first matches under it. */
function FilteredChoices(props: { choices: Choice[]; busy: boolean; act: (action: Action) => void }) {
  const [filter, setFilter] = useState("");
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  useEffect(() => input?.focus(), [input]);
  const wanted = filter.trim().toLowerCase();
  const matches = props.choices.filter((c) => c.label.toLowerCase().includes(wanted));
  return (
    <div className="prompt-filtered">
      <input
        ref={setInput}
        type="search"
        className="prompt-filter"
        placeholder="Type to find it"
        aria-label="Filter the choices"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          // Enter takes the only match, or the first, as a search box does.
          const first = matches[0];
          if (e.key === "Enter" && first !== undefined && !props.busy) props.act(first.action);
        }}
      />
      <Choices choices={matches.slice(0, MOST_SHOWN)} numbers={false} busy={props.busy} act={props.act} />
      {matches.length > MOST_SHOWN && (
        <p className="prompt-more">{matches.length - MOST_SHOWN} more: type to narrow it down</p>
      )}
      {matches.length === 0 && <p className="prompt-more">Nothing matches "{filter}"</p>}
    </div>
  );
}
