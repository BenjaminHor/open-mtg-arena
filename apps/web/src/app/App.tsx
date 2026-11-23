// The app shell: one match against the heuristic AI, the board full-bleed on its canvas and the HUD over it. Menus are
// M3-09. The board model is made here, from the seat view and the screen's size, so the canvas and the HUD share it.

import type { Action, GameSetup, ObjectId } from "@mtg/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BoardSize, boardModel, type Insets, NO_INSETS } from "../board-model/board-model.ts";
import { fixtureSetup } from "../fixtures/fixtures.ts";
import { Hud } from "../hud/Hud.tsx";
import { allAttackOffered, nextAllAttackPick } from "../interaction/all-attack.ts";
import { controls, type Selection } from "../interaction/controls.ts";
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

/** How long after an update a press is taken as meant for it, not for what was on screen before. */
const SETTLE_MS = 300;

/**
 * Whether a control has the keyboard's focus: then Space is that control's, not the main button's. A button a tap or
 * click left focused doesn't count (it shows no focus ring), so Space after a tap still presses the main button.
 */
function keyboardFocused(): boolean {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || focused === document.body) return false;
  // A text box (the prompt's filter) takes every key typed into it, a space included.
  const typing = focused instanceof HTMLInputElement && (focused.type === "search" || focused.type === "text");
  return typing || focused.matches(":focus-visible");
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
  // All Attack under way: one pick is sent per update, until no creature is left to pick.
  const [attackingAll, setAttackingAll] = useState(false);
  // An open menu is only which card it's for: its choices are always read from the current controls.
  const [menuFor, setMenuFor] = useState<ObjectId | null>(null);
  const [busy, setBusy] = useState(false);
  // The guard itself, so two presses in the same moment can't both send: the state above only draws it.
  const busyNow = useRef(false);
  // When the reply to the last button press arrived: a press of the main button or one beside it within a moment of it was aimed at what
  // was there before (a double-tap on Next would otherwise pass the next step too, ui.md "Never"), so it's ignored.
  // Taps on cards and targets aren't held back: each says on it what it does, and a quick player shouldn't lose one.
  const updatedAt = useRef(0);
  // Whether the press waiting for its reply was the main button's (or one beside it): only such a reply starts the
  // moment above, so a quick Undo after tapping an attacker isn't lost.
  const settlePress = useRef(false);

  useEffect(() => {
    const started = startMatchWorker((reply) => {
      busyNow.current = false;
      setBusy(false);
      if (reply.type === "update") {
        if (settlePress.current) updatedAt.current = performance.now();
        settlePress.current = false;
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
    () =>
      shown !== null && size !== null
        ? boardModel(shown, size, insets, {
            handOpen,
            selected: selection,
            highlight: controlsNow?.highlight ?? [],
          })
        : null,
    [shown, size, insets, handOpen, selection, controlsNow],
  );
  // Every message that can move the game goes through one guard: one at a time, and a button's press ignored a moment
  // after the reply to the last one.
  const send = useCallback((message: ToWorker, settle: boolean): boolean => {
    if (busyNow.current || (settle && performance.now() - updatedAt.current < SETTLE_MS)) return false;
    settlePress.current = settle;
    busyNow.current = true;
    setBusy(true);
    client.current?.send(message);
    return true;
  }, []);
  const act = useCallback(
    (action: Action, settle = false) => {
      if (!send({ type: "act", action }, settle)) return;
      setMenuFor(null);
      setSelection(null);
      // Playing from the hand puts it down again, as Arena does once a card leaves it.
      if (action.type === "CAST_SPELL" || action.type === "PLAY_LAND") setHandOpen(false);
    },
    [send],
  );
  // All Attack: each reply brings the next pick (the engine re-checks the declaration after every pick), until none
  // is left or the declaration is over; then the person adjusts or finishes it with the main button.
  useEffect(() => {
    if (!attackingAll || busy || shown === null) return;
    const pick = nextAllAttackPick(shown);
    if (pick === null) setAttackingAll(false);
    else act(pick);
  }, [attackingAll, busy, shown, act]);
  const menuTap = menuFor === null ? undefined : controlsNow?.cards[menuFor]?.tap;
  const menu = menuFor !== null && menuTap?.kind === "menu" ? { id: menuFor, choices: menuTap.choices } : null;
  const onTap = useCallback(
    (id: ObjectId) => {
      const tap = controlsNow?.cards[id]?.tap;
      switch (tap?.kind) {
        case "send":
          act(tap.choice.action);
          break;
        case "select":
          setMenuFor(null);
          setSelection(id);
          break;
        case "deselect":
          setSelection(null);
          break;
        case "menu":
          setMenuFor(id);
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
    if (menu !== null) setMenuFor(null);
    else if (selection !== null) setSelection(null);
    else if (handOpen) setHandOpen(false);
  };
  // The keyboard (ui.md, "Mouse and keyboard too"): Escape backs out one level, and a cast or activation under way;
  // Space presses the main button when no other control has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const cancel = controlsNow?.secondary.find(
          (c) => c.action.type === "ANSWER" && c.action.answer.kind === "cancelCast",
        );
        if (menu !== null) setMenuFor(null);
        else if (selection !== null) setSelection(null);
        else if (cancel !== undefined) act(cancel.action);
        else if (handOpen) setHandOpen(false);
      } else if (event.key === " " && !event.repeat && !keyboardFocused()) {
        event.preventDefault();
        if (controlsNow?.main != null) act(controlsNow.main, true);
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
          closeMenu={() => setMenuFor(null)}
          handOpen={handOpen}
          openHand={() => setHandOpen(true)}
          selection={selection}
          fullControl={update?.fullControl ?? false}
          // Only turning it off moves the game on (as Next does), so only that press waits out the moment.
          setFullControl={(on) => send({ type: "fullControl", on }, !on)}
          allAttack={{ offered: !attackingAll && allAttackOffered(shown), start: () => setAttackingAll(true) }}
          drag={{
            // The card lifts as the drag starts, out of the collapsed hand too.
            lift: (id) => {
              setMenuFor(null);
              setHandOpen(true);
              setSelection(id);
            },
            // Let go on the table: what a second tap on the lifted card would do.
            drop: (id) => {
              const tap = controls(shown, id).cards[id]?.tap;
              if (tap?.kind === "send") act(tap.choice.action);
              else if (tap?.kind === "menu") setMenuFor(id);
              else setSelection(null);
            },
            cancel: () => setSelection(null),
          }}
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
