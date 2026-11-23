// Plays the frames of a worker reply in order (D-172; ui.md, "The game never jumps"): each is drawn for its hold
// (`interaction/pacing.ts`), with a line saying what happened, then the reply's own view. Playback is for looking:
// the app sends no game action until it ends, and a skip jumps to the end. A reply arriving mid-way starts its own.
// At "instant" pace (the e2e build, D-172) every hold is 0, so the same path shows the end at once.

import type { SeatView, ViewEvent } from "@mtg/engine";
import { useCallback, useEffect, useState } from "react";
import { eventLine } from "../interaction/event-line.ts";
import { frameHold } from "../interaction/pacing.ts";
import type { FromWorker } from "../worker/protocol.ts";

type Update = Extract<FromWorker, { type: "update" }>;
export type Pace = "normal" | "instant";

/**
 * Where a reply's playback is: the frame drawn now, or past the last (`index` = the frames' length); and the view the
 * person saw before the reply, to name what its first frame leaves behind (a spell that resolved).
 */
type Position = { update: Update; index: number; before: SeatView | null; skipped: boolean };

export type Playback = {
  /** What to draw: the frame being held, else the reply's own view. */
  drawn: SeatView | null;
  /** A frame is being held: the person looks, and nothing they press sends a game action. */
  playing: boolean;
  /** What the held frame shows, in words ("Your opponent cast Lightning Bolt"). */
  line: string | null;
  /** Jumps to the end: the reply's own view, ready to act on. */
  skip: () => void;
  /**
   * The events that led to what's drawn from the view before it (the held frame's, or the reply's own after its
   * frames): the ladder walks them. None after a skip: it jumps, as the person asked.
   */
  events: readonly ViewEvent[];
  /** How long what's drawn holds, ms (0 at the end: the person's decision). */
  holdMs: number;
};

/**
 * `paused`: the person is looking (a card view or the zone browser open): the frame on screen holds until they're done,
 * then its whole hold again, so looking never lets the game move on unseen (UX review).
 */
export function usePlayback(update: Update | null, pace: Pace, paused: boolean): Playback {
  const [at, setAt] = useState<Position | null>(null);
  // A new reply starts at its first frame worth holding; at instant pace, at its end.
  useEffect(() => {
    if (update === null) return;
    setAt((was) => ({ update, index: firstHeld(update, 0, pace), before: was?.update.shown ?? null, skipped: false }));
  }, [update, pace]);
  const current = at !== null && at.update === update ? at : null;
  const frame = current === null ? undefined : current.update.frames[current.index];
  const holdMs = frame === undefined ? 0 : frameHold(frame.events, frame.shown.player);
  useEffect(() => {
    if (current === null || frame === undefined || paused) return;
    const next = setTimeout(
      () => setAt({ ...current, index: firstHeld(current.update, current.index + 1, pace) }),
      holdMs,
    );
    return () => clearTimeout(next);
  }, [current, frame, holdMs, pace, paused]);
  const skip = useCallback(() => {
    if (update !== null)
      setAt((was) => ({ update, index: update.frames.length, before: was?.before ?? null, skipped: true }));
  }, [update]);
  if (update === null) return { drawn: null, playing: false, line: null, skip, events: [], holdMs: 0 };
  // Until the effect above has started this reply, it's the start of its playback, not its end: never a flash of it.
  const index = current?.index ?? firstHeld(update, 0, pace);
  const held = update.frames[index];
  if (held === undefined) {
    const events = current?.skipped === true ? [] : update.events;
    return { drawn: update.shown, playing: false, line: null, skip, events, holdMs: 0 };
  }
  // Before the effect has stored it, the view before this reply is still the last reply's.
  const before =
    index === 0 ? (current?.before ?? at?.update.shown ?? null) : (update.frames[index - 1]?.shown ?? null);
  return {
    drawn: held.shown,
    playing: true,
    line: eventLine(held.events, before, held.shown),
    skip,
    events: held.events,
    holdMs: frameHold(held.events, held.shown.player),
  };
}

/** The first frame from `from` on with a hold at this pace; the frames' length when none has (play the end). */
function firstHeld(update: Update, from: number, pace: Pace): number {
  if (pace === "instant") return update.frames.length;
  for (let i = from; i < update.frames.length; i++) {
    const frame = update.frames[i];
    if (frame !== undefined && frameHold(frame.events, frame.shown.player) > 0) return i;
  }
  return update.frames.length;
}
