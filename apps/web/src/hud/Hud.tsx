// The DOM layer over the board (ui.md, "Implementation notes"): the pieces the person reads or presses, placed at the
// board model's anchors. It lets touches through to the canvas except on its own controls (`pointer-events`).
// Portraits in the corners, life crests on the centre line, the phase ladder and the main button at the bottom right
// [R]; whose turn it is shows three ways: where the ladder is, a ring and marker on that player's portrait, and the
// main button's label.

import type { Action, PlayerId, SeatView } from "@mtg/engine";
import type { BoardModel, Point, Rect } from "../board-model/board-model.ts";
import { COMPACT } from "../layout/compact.ts";
import { mainButton } from "./main-button.ts";
import { OptionsDrawer } from "./OptionsDrawer.tsx";
import { PhaseLadder } from "./PhaseLadder.tsx";

export function Hud({ shown, model, act }: { shown: SeatView; model: BoardModel; act: (action: Action) => void }) {
  const view = shown.view;
  const me = shown.player;
  const opponent = view.turnOrder.find((p) => p !== me) ?? me;
  const active = view.turn?.activePlayer ?? null;
  const life = (p: PlayerId) => view.players[p]?.life ?? 0;
  const anchors = model.overlay;
  const button = mainButton(shown);
  const result = view.result;
  return (
    <section className="hud" aria-label="Match">
      <Portrait rect={anchors.portrait.opponent} label="Opponent" active={active === opponent} />
      <Portrait rect={anchors.portrait.mine} label="You" active={active === me} />
      {view.turn !== null && (
        <PhaseLadder
          step={view.turn.step}
          side={anchors.ladderSide}
          style={
            anchors.ladderSide === "mine"
              ? { left: anchors.ladder.x, top: anchors.ladder.y, transform: "translate(-50%, -100%)" }
              : // Two phases left of the crest, three right: shift by half an icon so the gap is on the crest.
                { left: anchors.ladder.x, top: anchors.ladder.y, transform: "translate(calc(-50% + 11px), -50%)" }
          }
        />
      )}
      <LifeCrest at={anchors.life.opponent} life={life(opponent)} label="Opponent's life" side="opponent" />
      <LifeCrest at={anchors.life.mine} life={life(me)} label="Your life" side="mine" />

      <button
        type="button"
        className={`main-button${button.action === null ? " waiting" : ""}`}
        style={place(anchors.mainButton)}
        disabled={button.action === null}
        onClick={() => button.action !== null && act(button.action)}
      >
        <span className="main-label">{button.label}</span>
        {button.detail !== null && <span className="main-detail">{button.detail}</span>}
      </button>
      <OptionsDrawer shown={shown} act={act} />
      {result !== null && (
        <p role="status" className="result">
          {result.winner === me ? "You win" : result.winner === null ? "Draw" : "You lose"}
        </p>
      )}
    </section>
  );
}

function place(rect: Rect): React.CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

function Portrait({ rect, label, active }: { rect: Rect; label: string; active: boolean }) {
  return (
    <div
      className={`portrait${active ? " active" : ""}`}
      style={place(rect)}
      role="img"
      aria-label={active ? `${label}, this turn` : label}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="15" r="7" />
        <path d="M7 37 C8 27 14 24 20 24 C26 24 32 27 33 37 Z" />
      </svg>
      {active && <span className="turn-marker" aria-hidden="true" />}
    </div>
  );
}

function LifeCrest({ at, life, label, side }: { at: Point; life: number; label: string; side: "mine" | "opponent" }) {
  const size = COMPACT.life.size;
  return (
    <div
      className={`life life-${side}`}
      style={{ left: at.x - size / 2, top: at.y - size / 2, width: size, height: size }}
      role="img"
      aria-label={`${label} ${life}`}
    >
      {life}
    </div>
  );
}
