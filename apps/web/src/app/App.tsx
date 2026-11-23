// The app shell: one match against the heuristic AI, the board full-bleed on its canvas and the HUD over it. Menus are
// M3-09. The board model is made here, from the seat view and the screen's size, so the canvas and the HUD share it.

import type { Action, GameSetup, ObjectId } from "@mtg/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BoardSize, boardModel, type Insets, NO_INSETS } from "../board-model/board-model.ts";
import { fixtureSetup } from "../fixtures/fixtures.ts";
import { Hud } from "../hud/Hud.tsx";
import { type Choice, controls, type Selection } from "../interaction/controls.ts";
import { BoardCanvas } from "../renderer/BoardCanvas.tsx";
import { type MatchClient, startMatchWorker } from "../worker/client.ts";
import type { FromWorker, ToWorker } from "../worker/protocol.ts";
import { readInsets } from "./safe-area.ts";

type Update = Extract<FromWorker, { type: "update" }>;

/**
 * The match the address asks for: `?fixture=mid-game` a fixture board, `?seed=12&deck=red-aggro&vs=white-soldiers` a
 * given match, for tests and bug reports. A missing or mistyped seed gets a random one.
 */
function startFromUrl(): ToWorker | { error: string } {
  const params = new URLSearchParams(location.search);
  const fixture = params.get("fixture");
  if (fixture !== null) {
    const setup: GameSetup | null = fixtureSetup(fixture);
    return setup === null ? { error: `no fixture ${fixture}` } : { type: "startFrom", setup, human: "p1" };
  }
  const asked = Number(params.get("seed"));
  const seed =
    params.has("seed") && Number.isSafeInteger(asked) && asked >= 0 ? asked : Math.floor(Math.random() * 1_000_000_000);
  return {
    type: "start",
    decks: [params.get("deck") ?? "red-green-beats", params.get("vs") ?? "white-soldiers"],
    seed,
    human: "p1",
  };
}

export function App() {
  const client = useRef<MatchClient | null>(null);
  const main = useRef<HTMLElement>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<BoardSize | null>(null);
  const [insets, setInsets] = useState<Insets>(NO_INSETS);
  const [handOpen, setHandOpen] = useState(false);
  // The UI's own side of a choice under way (interaction/controls.ts): a lifted hand card or a picked blocker, a card's
  // menu open, and an action on its way to the worker (no second press until the next update, ui.md).
  const [selection, setSelection] = useState<Selection>(null);
  const [menu, setMenu] = useState<{ id: ObjectId; choices: Choice[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const started = startMatchWorker((reply) => {
      setBusy(false);
      if (reply.type === "update") {
        setUpdate(reply);
        setError(null);
      } else setError(reply.message);
    });
    client.current = started;
    const start = startFromUrl();
    if ("error" in start) setError(start.error);
    else started.send(start);
    return () => started.stop();
  }, []);

  // The board follows the screen: a turn or a fold re-lays it out (ui.md, "Layouts").
  useEffect(() => {
    const element = main.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      setInsets(readInsets());
    });
    observer.observe(element);
    // A half turn between the two landscape sides keeps the size but moves the notch: read the insets again.
    const turned = () => setInsets(readInsets());
    screen.orientation?.addEventListener("change", turned);
    window.addEventListener("orientationchange", turned);
    return () => {
      observer.disconnect();
      screen.orientation?.removeEventListener("change", turned);
      window.removeEventListener("orientationchange", turned);
    };
  }, []);

  const shown = update?.shown ?? null;
  const controlsNow = useMemo(() => (shown === null ? null : controls(shown, selection)), [shown, selection]);
  // A decision about the hand's cards opens the hand: to see the hand you keep or mulligan [R], to tap the card you
  // discard or put on the bottom.
  const decisionKind = shown?.view.decision?.kind;
  useEffect(() => {
    if (decisionKind === "mulligan" || decisionKind === "discardToHandSize" || decisionKind === "mulliganBottom") {
      setHandOpen(true);
    }
  }, [decisionKind]);
  // A selection the new view no longer offers (the card was played, the step moved on) is dropped.
  useEffect(() => {
    if (shown !== null && selection !== null && controls(shown, null).cards[selection] === undefined)
      setSelection(null);
  }, [shown, selection]);
  const model = useMemo(
    () => (shown !== null && size !== null ? boardModel(shown, size, insets, { handOpen, selected: selection }) : null),
    [shown, size, insets, handOpen, selection],
  );
  const act = useCallback(
    (action: Action) => {
      if (busy) return;
      setBusy(true);
      setMenu(null);
      setSelection(null);
      // Playing from the hand puts it down again, as Arena does once a card leaves it.
      if (action.type === "CAST_SPELL" || action.type === "PLAY_LAND") setHandOpen(false);
      client.current?.send({ type: "act", action });
    },
    [busy],
  );
  const onTap = useCallback(
    (id: ObjectId) => {
      const tap = controlsNow?.cards[id]?.tap;
      switch (tap?.kind) {
        case "send":
          act(tap.choice.action);
          break;
        case "select":
          setMenu(null);
          setSelection(id);
          break;
        case "deselect":
          setSelection(null);
          break;
        case "menu":
          setMenu({ id, choices: tap.choices });
          break;
        case undefined:
          break;
      }
    },
    [controlsNow, act],
  );
  // A tap on the table, not on a control, puts things down: the menu, then the selection, then the open hand.
  const onTable = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("button") !== null) return;
    if (menu !== null) setMenu(null);
    else if (selection !== null) setSelection(null);
    else if (handOpen) setHandOpen(false);
  };
  // The keyboard (ui.md, "Mouse and keyboard too"): Escape backs out one level, and a cast or activation under way;
  // Space presses the main button when no other control has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const cancel = controlsNow?.secondary.find((c) => c.label === "Cancel");
        if (menu !== null) setMenu(null);
        else if (selection !== null) setSelection(null);
        else if (cancel !== undefined) act(cancel.action);
        else if (handOpen) setHandOpen(false);
      } else if (event.key === " " && (document.activeElement === document.body || document.activeElement === null)) {
        event.preventDefault();
        if (controlsNow?.main != null) act(controlsNow.main);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controlsNow, menu, selection, handOpen, act]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard's way to put things down is Escape (above)
    <main className="app" ref={main} onClick={onTable}>
      <BoardCanvas model={model} onError={setError} />
      {update === null && error === null && <p className="loading">Starting a match…</p>}
      {shown !== null && model !== null && controlsNow !== null && (
        <Hud
          shown={shown}
          model={model}
          controls={controlsNow}
          busy={busy}
          act={act}
          onTap={onTap}
          menu={menu}
          closeMenu={() => setMenu(null)}
          handOpen={handOpen}
          openHand={() => setHandOpen(true)}
        />
      )}
      {error !== null && (
        <p role="alert" className="toast">
          {error}
        </p>
      )}
    </main>
  );
}
