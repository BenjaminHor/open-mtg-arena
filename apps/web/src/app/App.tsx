// The app shell for M3-03: one match against the heuristic AI, the board on its canvas, and a plain DOM layer with
// life totals, the step, and a button for each legal action. Menus are M3-09; the real prompts and HUD are M3-04.

import type { PlayerId } from "@mtg/engine";
import { useEffect, useRef, useState } from "react";
import { BoardCanvas } from "../renderer/BoardCanvas.tsx";
import { type MatchClient, startMatchWorker } from "../worker/client.ts";
import type { FromWorker } from "../worker/protocol.ts";
import { optionLabel } from "./option-label.ts";

type Update = Extract<FromWorker, { type: "update" }>;

/** `?seed=12&deck=red-aggro&vs=white-soldiers` start a given match, for tests and bug reports. */
function matchFromUrl(): { seed: number; decks: [string, string] } {
  const params = new URLSearchParams(location.search);
  const asked = Number(params.get("seed"));
  // A seed that isn't a whole number (a typo in the address) gets a random one instead.
  const seed =
    params.has("seed") && Number.isSafeInteger(asked) && asked >= 0 ? asked : Math.floor(Math.random() * 1_000_000_000);
  return { seed, decks: [params.get("deck") ?? "red-green-beats", params.get("vs") ?? "white-soldiers"] };
}

export function App() {
  const client = useRef<MatchClient | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const started = startMatchWorker((reply) => {
      if (reply.type === "update") {
        setUpdate(reply);
        setError(null);
      } else setError(reply.message);
    });
    client.current = started;
    const { seed, decks } = matchFromUrl();
    started.send({ type: "start", decks, seed, human: "p1" });
    return () => started.stop();
  }, []);

  if (update === null) {
    return error === null ? (
      <p className="loading">Starting a match…</p>
    ) : (
      <p role="alert" className="loading">
        {error}
      </p>
    );
  }
  const { shown } = update;
  const view = shown.view;
  const life = (p: PlayerId) => view.players[p]?.life ?? 0;
  const opponent = view.turnOrder.find((p) => p !== shown.player) ?? shown.player;
  const result = view.result;
  return (
    <main className="app">
      <BoardCanvas shown={shown} onError={setError} />
      <section className="hud" aria-label="Match">
        <p>
          You {life(shown.player)} · Opponent {life(opponent)} · Turn {view.turn?.number ?? 0}, {view.turn?.step ?? ""}
        </p>
        {result !== null && (
          <p role="status">
            {result.winner === shown.player ? "You win" : result.winner === null ? "Draw" : "You lose"}
          </p>
        )}
        {error !== null && <p role="alert">{error}</p>}
        <div className="options">
          {shown.options.map((option, i) => (
            <button
              type="button"
              // The options are listed in the engine's order, which doesn't change while they're shown.
              // biome-ignore lint/suspicious/noArrayIndexKey: no other stable key for an action
              key={i}
              // A spell or ability the person's mana can't pay for now is shown but not offered (seatView's hint).
              disabled={option.mightPay === false}
              onClick={() => client.current?.send({ type: "act", action: option.action })}
            >
              {optionLabel(shown, option.action)}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
