// The DOM layer over the board (ui.md, "Implementation notes"): the pieces the person reads or presses, placed at the
// board model's anchors. It lets touches through to the canvas except on its own controls (`pointer-events`).
// Portraits in the corners, life crests on the centre line, the phase ladder and the main button at the bottom right
// [R]; whose turn it is shows three ways: where the ladder is, a ring and marker on that player's portrait, and the
// main button's label.

import type { Action, PlayerId, SeatView } from "@mtg/engine";
import type { BoardModel, Rect } from "../board-model/board-model.ts";
import { mainButton } from "./main-button.ts";
import { OptionsDrawer } from "./OptionsDrawer.tsx";
import { PhaseLadder } from "./PhaseLadder.tsx";
import { place } from "./place.ts";

type HudProps = {
  shown: SeatView;
  model: BoardModel;
  act: (action: Action) => void;
  handOpen: boolean;
  toggleHand: () => void;
};

export function Hud({ shown, model, act, handOpen, toggleHand }: HudProps) {
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
      <PhaseLadder ladder={anchors.ladder} label={active === me ? "Your turn" : "Opponent's turn"} />
      {anchors.opponentLadder !== null && <PhaseLadder ladder={anchors.opponentLadder} label={null} />}
      <LifeCrest
        rect={anchors.life.opponent}
        life={life(opponent)}
        label="Opponent's life"
        side="opponent"
        combat={anchors.opponentInCombat}
      />
      <LifeCrest rect={anchors.life.mine} life={life(me)} label="Your life" side="mine" combat={false} />
      {/* While a choice other than priority waits, its prompt answers it: no button that does nothing. */}
      {button.label !== "Choose" && (
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
      )}
      {anchors.hand !== null && (
        // A tap on the hand opens it, and on the open hand closes it [R]. Playing a card from it is M3-04b.
        <button
          type="button"
          className="hand-toggle"
          style={place(anchors.hand)}
          aria-label={handOpen ? "Close your hand" : "Open your hand"}
          aria-expanded={handOpen}
          onClick={toggleHand}
        />
      )}
      <OptionsDrawer shown={shown} act={act} />
      {result !== null && (
        <p role="status" className="result">
          {result.winner === me ? "You win" : result.winner === null ? "Draw" : "You lose"}
        </p>
      )}
    </section>
  );
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

/** A life total in its crest [R]. The opponent's crest is also the combat rung of their ladder: it glows then. */
function LifeCrest(props: { rect: Rect; life: number; label: string; side: "mine" | "opponent"; combat: boolean }) {
  return (
    <div
      className={`life life-${props.side}${props.combat ? " combat" : ""}`}
      style={place(props.rect)}
      role="img"
      aria-label={`${props.label} ${props.life}`}
    >
      {props.life}
    </div>
  );
}
