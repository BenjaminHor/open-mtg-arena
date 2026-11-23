// The app shell: one match against the heuristic AI, the board full-bleed on its canvas and the HUD over it. Menus are
// M3-09. The board model is made here, from the seat view and the screen's size, so the canvas and the HUD share it.

import type { Action, GameSetup } from "@mtg/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BoardSize, boardModel, type Insets, NO_INSETS } from "../board-model/board-model.ts";
import { fixtureSetup } from "../fixtures/fixtures.ts";
import { Hud } from "../hud/Hud.tsx";
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

  useEffect(() => {
    const started = startMatchWorker((reply) => {
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
    return () => observer.disconnect();
  }, []);

  const model = useMemo(
    () => (update !== null && size !== null ? boardModel(update.shown, size, insets) : null),
    [update, size, insets],
  );
  const act = useCallback((action: Action) => client.current?.send({ type: "act", action }), []);

  return (
    <main className="app" ref={main}>
      <BoardCanvas model={model} onError={setError} />
      {update === null && error === null && <p className="loading">Starting a match…</p>}
      {update !== null && model !== null && <Hud shown={update.shown} model={model} act={act} />}
      {error !== null && (
        <p role="alert" className="toast">
          {error}
        </p>
      )}
    </main>
  );
}
