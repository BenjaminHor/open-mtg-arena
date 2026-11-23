// The DOM layer over the board (ui.md, "Implementation notes"): the pieces the person reads or presses, placed at the
// board model's anchors. It lets touches through to the canvas except on its own controls (`pointer-events`).
// Portraits in the corners, life crests on the centre line, the phase ladder and the main button at the bottom right
// [R]; whose turn it is shows three ways: where the ladder is, a ring and marker on that player's portrait, and the
// main button's label. The cards a tap acts on are buttons over the canvas (CardButtons), choices the board can't
// offer are in the prompt, and a card with several choices opens a small menu.

import type { Action, ObjectId, PlayerId, SeatView } from "@mtg/engine";
import type { BoardModel, Rect } from "../board-model/board-model.ts";
import { type Choice, type Controls, promptTitle } from "../interaction/controls.ts";
import { CardButtons } from "./CardButtons.tsx";
import { ChoiceMenu } from "./ChoiceMenu.tsx";
import { mainButton } from "./main-button.ts";
import { PhaseLadder } from "./PhaseLadder.tsx";
import { Prompt } from "./Prompt.tsx";
import { place } from "./place.ts";
import { SettingsMenu } from "./SettingsMenu.tsx";

type HudProps = {
  shown: SeatView;
  model: BoardModel;
  controls: Controls;
  busy: boolean;
  act: (action: Action) => void;
  onTap: (id: ObjectId) => void;
  menu: { id: ObjectId; choices: Choice[] } | null;
  closeMenu: () => void;
  handOpen: boolean;
  openHand: () => void;
};

export function Hud(props: HudProps) {
  const { shown, model, controls, busy, act } = props;
  const view = shown.view;
  const me = shown.player;
  const opponent = view.turnOrder.find((p) => p !== me) ?? me;
  const active = view.turn?.activePlayer ?? null;
  const life = (p: PlayerId) => view.players[p]?.life ?? 0;
  const anchors = model.overlay;
  const button = mainButton(shown);
  const result = view.result;
  const deciding = view.decision !== null && view.decision.kind !== "priority" && result === null;
  const menuId = props.menu?.id ?? null;
  const menuAt = menuId === null ? null : model.regions.find((r) => r.members.includes(menuId))?.rect;
  return (
    <section className="hud" aria-label="Match">
      <CardButtons
        model={model}
        controls={controls}
        busy={busy}
        onTap={props.onTap}
        onHand={props.openHand}
        handOpen={props.handOpen}
      />
      <Portrait
        rect={anchors.portrait.opponent}
        label="Opponent"
        side="opponent"
        active={active === opponent}
        targets={controls.players[opponent] ?? []}
        act={act}
      />
      <Portrait
        rect={anchors.portrait.mine}
        label="You"
        side="mine"
        active={active === me}
        targets={controls.players[me] ?? []}
        act={act}
      />
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
      {!button.hidden && (
        <button
          type="button"
          className={`main-button${button.action === null ? " waiting" : ""}`}
          style={place(anchors.mainButton)}
          // Disabled only when it has nothing to do; while an action is on its way it keeps focus (aria-disabled).
          disabled={button.action === null}
          aria-disabled={busy}
          onClick={() => button.action !== null && !busy && act(button.action)}
        >
          <span className="main-label">{button.label}</span>
          {button.detail !== null && (
            <span className="main-detail" style={{ fontSize: detailSize(button.detail, anchors.mainButton.width) }}>
              {button.detail}
            </span>
          )}
        </button>
      )}
      {controls.secondary.map((choice, i) => {
        const at = anchors.secondary[i];
        return at === undefined ? null : (
          <button
            key={choice.label}
            type="button"
            className="secondary-button"
            style={place(at)}
            aria-disabled={busy}
            onClick={() => !busy && act(choice.action)}
          >
            {choice.label}
          </button>
        );
      })}
      <div className="prompt-anchor" style={{ left: anchors.prompt.x, top: anchors.prompt.y }}>
        <Prompt prompt={controls.prompt} title={deciding ? promptTitle(shown) : null} busy={busy} act={act} />
      </div>
      {props.menu !== null && menuAt !== undefined && menuAt !== null && (
        <ChoiceMenu at={menuAt} choices={props.menu.choices} act={act} close={props.closeMenu} />
      )}
      <SettingsMenu concede={controls.concede} act={act} />
      {result !== null && (
        <p role="status" className="result">
          {result.winner === me ? "You win" : result.winner === null ? "Draw" : "You lose"}
        </p>
      )}
    </section>
  );
}

function Portrait(props: {
  rect: Rect;
  label: string;
  side: "mine" | "opponent";
  active: boolean;
  targets: Choice[];
  act: (action: Action) => void;
}) {
  const { rect, label, side, active, targets } = props;
  const target = targets[0];
  const className = `portrait ${side}${active ? " active" : ""}${target !== undefined ? " target" : ""}`;
  const face = (
    <>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="15" r="7" />
        <path d="M7 37 C8 27 14 24 20 24 C26 24 32 27 33 37 Z" />
      </svg>
      {active && <span className="turn-marker" aria-hidden="true" />}
    </>
  );
  // A player who can be targeted now is a button: a tap picks them [R].
  if (target !== undefined) {
    return (
      <button
        type="button"
        className={className}
        style={place(rect)}
        aria-label={`${label}: ${target.label}`}
        onClick={() => props.act(target.action)}
      >
        {face}
      </button>
    );
  }
  return (
    <div className={className} style={place(rect)} role="img" aria-label={active ? `${label}, this turn` : label}>
      {face}
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

/**
 * The main button's second line at 11 px, smaller for a long name so it fits the pill without being cut (ui.md, "Names
 * are never cut off"): a system font's letters average about 0.55 of their size wide.
 */
function detailSize(text: string, buttonWidth: number): number {
  return Math.max(7, Math.min(11, (buttonWidth - 22) / (text.length * 0.55)));
}
