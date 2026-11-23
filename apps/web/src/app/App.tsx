// The app shell: one match against the heuristic AI, the board full-bleed on its canvas and the HUD over it. Menus are
// M3-09. The board model is made here, from the seat view and the screen's size, so the canvas and the HUD share it.

import type { Action, GameSetup, ObjectId, SeatView } from "@mtg/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BoardSize, boardModel, type Insets, NO_INSETS } from "../board-model/board-model.ts";
import { stackIsSmall } from "../board-model/stack.ts";
import { fixtureSetup } from "../fixtures/fixtures.ts";
import type { Inspected } from "../hud/CardView.tsx";
import { cardAt } from "../hud/card-inspect.ts";
import { Hud } from "../hud/Hud.tsx";
import type { Browsing } from "../hud/ZoneBrowser.tsx";
import {
  allAttackGoal,
  allAttackOffered,
  stepToward,
  type WantedAttack,
  withoutAttacker,
} from "../interaction/all-attack.ts";
import { cardDetails } from "../interaction/card-details.ts";
import { controls, type Selection } from "../interaction/controls.ts";
import { frameHold } from "../interaction/pacing.ts";
import { turnBanner } from "../interaction/turn-banner.ts";
import { BoardCanvas } from "../renderer/BoardCanvas.tsx";
import { type MatchClient, startMatchWorker } from "../worker/client.ts";
import type { FromWorker, ToWorker } from "../worker/protocol.ts";
import { readInsets } from "./safe-area.ts";
import { TurnYourPhone } from "./TurnYourPhone.tsx";
import { type Pace, usePlayback } from "./use-playback.ts";
import { usePortraitPhone } from "./use-portrait.ts";

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

/**
 * How fast what the host did is shown (D-172): normal, or instant (every frame skipped, the end at once), as the e2e
 * build plays so its tests don't wait ("tests run at instant speed", M3-07); `?pace=` in the address overrides.
 */
function paceFromUrl(): Pace {
  const asked = new URLSearchParams(location.search).get("pace");
  if (asked === "normal" || asked === "instant") return asked;
  return import.meta.env.VITE_TEST_HOOKS === "1" ? "instant" : "normal";
}

/** Whether a reply has frames to hold at this pace (`use-playback.ts`). */
function repliesPlay(reply: Extract<FromWorker, { type: "update" }>, pace: Pace): boolean {
  return pace === "normal" && reply.frames.some((f) => frameHold(f.events, f.shown.player) > 0);
}

/** How long after an update a press is taken as meant for it, not for what was on screen before. */
const SETTLE_MS = 300;

/**
 * The declaration's batch button, in one fixed place beside the main button [guess: arena-research.md has All Attack
 * as a label, not its place]: "All Attack" while two or more could
 * still attack, "Clear Attacks" once some are attacking (D-158). Kept, disabled, while the app works toward its goal.
 */
function attackBatch(
  shown: SeatView,
  running: string | null,
  aim: (goal: WantedAttack[], label: string) => void,
): { label: string; run: () => void; running: boolean } | null {
  const decision = shown.view.decision;
  if (decision?.kind !== "declareAttackers") return null;
  // While it runs: the label pressed, disabled, in its place.
  if (running !== null) return { label: running, run: () => {}, running: true };
  if (allAttackOffered(shown)) {
    return { label: "All Attack", run: () => aim(allAttackGoal(shown), "All Attack"), running: false };
  }
  const canTakeBack = shown.options.some((o) => o.action.type === "ANSWER" && o.action.answer.kind === "takeBack");
  if (decision.chosen.length > 0 && canTakeBack) {
    return { label: "Clear Attacks", run: () => aim([], "Clear Attacks"), running: false };
  }
  return null;
}

/**
 * Whether a control has the keyboard's focus: then Space is that control's, not the main button's. A button a tap or
 * click left focused doesn't count (it shows no focus ring), so Space after a tap still presses the main button.
 */
function keyboardFocused(): boolean {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || focused === document.body) return false;
  // A text box (the prompt's filter) takes every key typed into it, a space included.
  const typing = focused instanceof HTMLInputElement && (focused.type === "search" || focused.type === "text");
  // A card that's only there to be looked at ("i"), or the stack while it can't change size, has nothing to press:
  // Space still presses the main button.
  if (focused.matches(".inspect-region, .tap-shield[aria-disabled='true']")) return false;
  return typing || focused.matches(":focus-visible");
}

/** ms: how long a new turn's banner shows. */
const BANNER_MS = 1600;

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
  // The attackers wanted, while the app moves the declaration there a step per reply (`all-attack.ts`): All Attack,
  // Clear Attacks, a tap taking one attacker out. `lastStep` is what went out last: the same step again, from the
  // same declaration, means it didn't land, and the app stops rather than send it once more.
  const [attackGoal, setAttackGoal] = useState<WantedAttack[] | null>(null);
  const lastStep = useRef<string | null>(null);
  // The batch button's label while the app works toward its goal: kept as pressed, not flipping as attackers come and go.
  const runningLabel = useRef("All Attack");
  // The card being looked at (the card view, M3-04c): a full view, or a mouse's preview.
  const [inspected, setInspected] = useState<Inspected | null>(null);
  // A phone held upright: the match pauses behind a prompt to turn it (ui.md, "Layouts").
  const portrait = usePortraitPhone();
  // A player's zones being browsed (M3-04c slice 5), or null.
  const [browsing, setBrowsing] = useState<Browsing | null>(null);
  // The stack made small by a tap, for the object on top then: a new object on top shows large again (D-170).
  const [stackSmallFor, setStackSmallFor] = useState<ObjectId | null>(null);
  // Whether the hand was open when a drag lifted a card from it, to put it back that way if the drag is cancelled.
  const handBeforeDrag = useRef(false);
  // An open menu is only which card it's for: its choices are always read from the current controls.
  const [menuFor, setMenuFor] = useState<ObjectId | null>(null);
  const [busy, setBusy] = useState(false);
  // How fast what the host did is shown, and whether a frame of it is on screen now (for `send`, a ref: read at once).
  const [pace] = useState(paceFromUrl);
  const playingNow = useRef(false);
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
        // Whether this reply will play frames, known now: no tap in the moment before it's drawn may act on the view
        // it replaces (`send`).
        playingNow.current = repliesPlay(reply, paceFromUrl());
        if (settlePress.current) updatedAt.current = performance.now();
        settlePress.current = false;
        setUpdate(reply);
        setError(null);
      } else {
        setError(reply.message);
        // A refused step would only be sent again: the app stops, and the person carries on by hand.
        setAttackGoal(null);
      }
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

  // What the host did on the way here, shown in order before the person's decision (D-172): `shown` is what's drawn,
  // a frame while one holds. Nothing sends a game action meanwhile (`send`); a skip jumps to the end.
  const playback = usePlayback(update, pace);
  playingNow.current = playback.playing;
  const shown = playback.drawn;
  // When playback ends, on its own or by a skip, the decision it uncovers is new: the settle moment starts there, so a
  // press meant for Skip, or a second tap, isn't taken for it (ui.md, "Never").
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (wasPlaying.current && !playback.playing) updatedAt.current = performance.now();
    wasPlaying.current = playback.playing;
  }, [playback.playing]);
  const skip = useCallback(() => {
    playback.skip();
    updatedAt.current = performance.now();
  }, [playback.skip]);
  // A new turn's banner (interaction/turn-banner.ts), shown for a moment: a turn the host passed through is never
  // invisible.
  const [banner, setBanner] = useState<string | null>(null);
  const lastTurn = useRef<number | null>(null);
  useEffect(() => {
    if (shown === null) return;
    const text = turnBanner(lastTurn.current, shown);
    lastTurn.current = shown.view.turn?.number ?? lastTurn.current;
    if (text !== null) setBanner(text);
  }, [shown]);
  // Its own timer, from when it's set: the next frame or update mustn't cancel it and leave it up for good.
  useEffect(() => {
    if (banner === null) return;
    const gone = setTimeout(() => setBanner(null), BANNER_MS);
    return () => clearTimeout(gone);
  }, [banner]);
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
            stackSmall: stackIsSmall(shown, stackSmallFor),
          })
        : null,
    [shown, size, insets, handOpen, selection, controlsNow, stackSmallFor],
  );
  // Every message that can move the game goes through one guard: one at a time, and a button's press ignored a moment
  // after the reply to the last one.
  const send = useCallback((message: ToWorker, settle: boolean): boolean => {
    if (busyNow.current || (settle && performance.now() - updatedAt.current < SETTLE_MS)) return false;
    // While what happened plays, the frame on screen isn't the decision: no game action is sent from it. Conceding
    // and full control aren't about the frame, and always go.
    if (playingNow.current && message.type === "act" && message.action.type !== "CONCEDE") return false;
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
  // Toward the attack goal: each reply brings the next step (a pick, or a take-back), each one the engine re-checks,
  // until the declaration is there, is over, or a step didn't land; then the person adjusts or finishes it.
  useEffect(() => {
    if (attackGoal === null || busy || playback.playing || shown === null) return;
    const step = stepToward(shown, attackGoal);
    const decision = shown.view.decision;
    const at = `${JSON.stringify(decision?.kind === "declareAttackers" ? decision.chosen : null)} ${JSON.stringify(step)}`;
    if (step === null || at === lastStep.current) {
      setAttackGoal(null);
      lastStep.current = null;
      // A second tap on the button would land on what's under it now: the settle moment starts here (ui.md "Never").
      updatedAt.current = performance.now();
      return;
    }
    lastStep.current = at;
    act(step);
  }, [attackGoal, busy, playback.playing, shown, act]);
  // Starting toward a goal is a button's press: not a moment after a button's reply (the settle guard, above).
  const aimAttack = useCallback((goal: WantedAttack[], label: string) => {
    if (busyNow.current || performance.now() - updatedAt.current < SETTLE_MS) return;
    lastStep.current = null;
    runningLabel.current = label;
    setAttackGoal(goal);
  }, []);
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
        case "withdraw":
          if (shown !== null) setAttackGoal(withoutAttacker(shown, id));
          break;
        case undefined:
          break;
      }
    },
    [controlsNow, act, shown],
  );
  // What the card view shows, read from the seat view as it is now. A card that has gone (it died, it changed zones and
  // so is a new object, CR 400.7) closes the view.
  const looking = inspected === null || shown === null ? null : cardDetails(shown, inspected.id);
  useEffect(() => {
    if (inspected !== null && looking === null) setInspected(null);
  }, [inspected, looking]);
  // A preview goes when the mouse leaves its card. The card's region may go first (redrawn, or the card gone) with no
  // "leave" to say so, so while a preview shows, any move away from that card ends it.
  // Checked against the view as it is when the move arrives: a sweep to the next card has already swapped it.
  const previewing = inspected?.mode === "preview";
  useEffect(() => {
    if (!previewing) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const under = cardAt(e.clientX, e.clientY);
      setInspected((now) => (now?.mode === "preview" && under !== now.id ? null : now));
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [previewing]);
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
      // Paused behind the "turn your phone" prompt: no key reaches the match.
      if (portrait) return;
      // The zone browser is modal and handles its own keys (Escape: its card view, then itself).
      if (browsing !== null) return;
      // Escape closes a full view and nothing else; a preview goes, and the Escape does what it would without one.
      if (event.key === "Escape" && inspected !== null) {
        setInspected(null);
        if (inspected.mode === "full") return;
      }
      // Behind a full view nothing takes a key: its Close button has focus and handles its own.
      if (inspected?.mode === "full") return;
      // "i" looks at the focused card, the keyboard's way to the card view (a long-press or a right-click otherwise).
      if (event.key === "i" && !event.repeat && shown !== null) {
        const id = (document.activeElement as HTMLElement | null)?.dataset.card as ObjectId | undefined;
        if (id !== undefined && cardDetails(shown, id) !== null) setInspected({ mode: "full", id });
        return;
      }
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
        if (playback.playing) skip();
        else if (controlsNow?.main != null) act(controlsNow.main, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controlsNow, menu, selection, handOpen, act, inspected, shown, browsing, portrait, playback.playing, skip]);

  return (
    <>
      {/* A phone held upright pauses behind the "turn your phone" prompt: nothing behind it takes a tap, focus or key. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard's way to put things down is Escape (above) */}
      <main className="app" ref={main} onClick={onTable} inert={portrait}>
        <BoardCanvas model={model} onError={setError} />
        {update === null && error === null && <p className="loading">Starting a match…</p>}
        {shown !== null && model !== null && controlsNow !== null && (
          <Hud
            shown={shown}
            model={model}
            controls={controlsNow}
            busy={busy || playback.playing}
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
            inspect={{
              open: (id, mode) => {
                // A hover never replaces a view opened on purpose.
                if (cardDetails(shown, id) !== null && !(mode === "preview" && inspected?.mode === "full"))
                  setInspected({ mode, id });
              },
              closePreview: () => setInspected((now) => (now?.mode === "preview" ? null : now)),
              prefetch: (id) => {
                const image = cardDetails(shown, id)?.image;
                // The browser keeps it: the view's own <img> then finds it loaded, or on its way.
                if (image != null) new Image().src = image;
              },
            }}
            inspected={inspected === null || looking === null ? null : { ...inspected, details: looking }}
            banner={banner}
            line={playback.playing ? playback.line : null}
            playing={playback.playing}
            skip={skip}
            closeInspected={() => setInspected(null)}
            // A tap on the stack makes it small or large again, but not while it's small to choose for it.
            toggleStack={
              shown.view.casting?.player === shown.player
                ? null
                : () => {
                    const top = shown.view.zones.stack.at(-1) ?? null;
                    setStackSmallFor((now) => (now === top ? null : top));
                  }
            }
            browsing={browsing}
            browse={(next) => {
              // Looking through zones is reading: a preview goes, and nothing else changes.
              setInspected(null);
              setBrowsing(next);
            }}
            attackBatch={attackBatch(shown, attackGoal === null ? null : runningLabel.current, aimAttack)}
            drag={{
              // The card lifts as the drag starts, out of the collapsed hand too.
              lift: (id) => {
                // A long-press opened the card view: looking, not playing.
                if (inspected?.mode === "full") return;
                setMenuFor(null);
                handBeforeDrag.current = handOpen;
                setHandOpen(true);
                setSelection(id);
              },
              // Let go on the table: what a second tap on the lifted card would do.
              drop: (id) => {
                if (inspected?.mode === "full") return;
                const tap = controls(shown, id).cards[id]?.tap;
                if (tap?.kind === "send") act(tap.choice.action);
                else if (tap?.kind === "menu") setMenuFor(id);
                else setSelection(null);
              },
              // Put down: the hand as it was before the drag (a drag from the collapsed hand leaves it collapsed).
              cancel: () => {
                setSelection(null);
                setHandOpen(handBeforeDrag.current);
              },
            }}
          />
        )}
        {error !== null && (
          <p role="alert" className="toast">
            {error}
          </p>
        )}
      </main>
      {portrait && <TurnYourPhone />}
    </>
  );
}
