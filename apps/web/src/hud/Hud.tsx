// The DOM layer over the board (ui.md, "Implementation notes"): the pieces the person reads or presses, placed at the
// board model's anchors. It lets touches through to the canvas except on its own controls (`pointer-events`).
// Each player's info in a left corner (life and zone counts, D-164), the phase ladder and the main button at the bottom
// right [R]; whose turn it is shows three ways: where the ladder is, a marker on that player's info, and the main
// button's label. The cards a tap acts on are buttons over the canvas (CardButtons), choices the board can't
// offer are in the prompt, and a card with several choices opens a small menu.

import type { Action, ObjectId, SeatView } from "@mtg/engine";
import type { BoardModel, Rect } from "../board-model/board-model.ts";
import type { CardDetails } from "../interaction/card-details.ts";
import type { Choice, Controls } from "../interaction/controls.ts";
import { promptLayout, promptTitle } from "../interaction/prompt-text.ts";
import type { ZoneName } from "../interaction/zones.ts";
import { CardButtons } from "./CardButtons.tsx";
import { CardView, type Inspected } from "./CardView.tsx";
import { ChoiceMenu } from "./ChoiceMenu.tsx";
import type { InspectCallbacks } from "./card-inspect.ts";
import type { HandDragCallbacks } from "./hand-drag.ts";
import { ManaText } from "./ManaText.tsx";
import { mainButton } from "./main-button.ts";
import { PhaseLadder } from "./PhaseLadder.tsx";
import { PlayerInfo } from "./PlayerInfo.tsx";
import { Prompt } from "./Prompt.tsx";
import { place } from "./place.ts";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { type Browsing, ZoneBrowser } from "./ZoneBrowser.tsx";

type HudProps = {
  shown: SeatView;
  model: BoardModel;
  controls: Controls;
  busy: boolean;
  /** Sends an action; `settle` ignores it when it comes a moment after the last update (App.tsx, SETTLE_MS). */
  act: (action: Action, settle?: boolean) => void;
  onTap: (id: ObjectId) => void;
  menu: { id: ObjectId; choices: Choice[] } | null;
  closeMenu: () => void;
  handOpen: boolean;
  openHand: () => void;
  selection: ObjectId | null;
  fullControl: boolean;
  setFullControl: (on: boolean) => void;
  /** Drag to play: a hand card lifted by a drag, let go on the table, or put down (`hand-drag.ts`). */
  drag: HandDragCallbacks;
  /** The card view: how a card's region opens it, and what's being looked at now. */
  inspect: InspectCallbacks;
  /** The card view, if one is open: how, and what it shows (read from the seat view as it is now). */
  inspected: (Inspected & { details: CardDetails }) | null;
  /** A new turn's banner ("Turn 6 · Your turn"), for a moment, or null. */
  banner: string | null;
  closeInspected: () => void;
  /** Makes the large stack small or large again; null while it's small to choose for it. */
  toggleStack: (() => void) | null;
  /** A frame of what the host did is on screen (D-172): the main button skips to the end instead. */
  playing: boolean;
  skip: () => void;
  /** What the frame on screen shows, in words, while one holds; else null. */
  line: string | null;
  /** The zone browser, if open: whose zones and which tab (`ZoneBrowser.tsx`). */
  browsing: Browsing | null;
  browse: (browsing: Browsing | null) => void;
  /** The declaration's batch button, "All Attack" or "Clear Attacks" (App.tsx, `all-attack.ts`), or none now. */
  attackBatch: { label: string; run: () => void; running: boolean } | null;
};

export function Hud(props: HudProps) {
  const { shown, model, controls, busy, act } = props;
  const view = shown.view;
  const me = shown.player;
  const opponent = view.turnOrder.find((p) => p !== me) ?? me;
  const active = view.turn?.activePlayer ?? null;
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
        selection={props.selection}
        drag={props.drag}
        inspect={props.inspect}
        toggleStack={props.toggleStack}
        act={act}
      />
      <PlayerInfo
        shown={shown}
        player={opponent}
        rect={anchors.player.opponent}
        side="opponent"
        active={active === opponent}
        targets={controls.players[opponent] ?? []}
        act={act}
        browse={(zone) => props.browse({ kind: "player", player: opponent, zone })}
      />
      <PlayerInfo
        shown={shown}
        player={me}
        rect={anchors.player.mine}
        side="mine"
        active={active === me}
        targets={controls.players[me] ?? []}
        act={act}
        browse={(zone) => props.browse({ kind: "player", player: me, zone })}
      />
      {/* The open hand rises over where it sits; the pool is back when the hand is put down. */}
      {!props.handOpen && <ManaPoolChip pool={view.players[me]?.manaPool} above={anchors.player.mine} />}
      {/* The ladder sits on the side whose turn it is [R]: by the main button on the person's, at the top on the
          opponent's (the model gives that one only then). */}
      {anchors.opponentLadder === null ? (
        <PhaseLadder ladder={anchors.ladder} label="Your turn" />
      ) : (
        <PhaseLadder ladder={anchors.opponentLadder} label="Opponent's turn" />
      )}
      {/* While what the host did plays (D-172), the one button skips to the end: nothing else is pressed meanwhile. */}
      {props.playing ? (
        <button
          // Not the same element as the main button: a press on Skip as playback ends mustn't land on what replaced it.
          key="skip"
          type="button"
          className="main-button skip"
          style={place(anchors.mainButton)}
          aria-label="Skip to your decision"
          onClick={props.skip}
        >
          <span className="main-label">Skip</span>
        </button>
      ) : (
        !button.hidden && (
          <button
            key="main"
            type="button"
            // In full control the button turns blue-violet, as Arena's does [R], so it's plain the game won't pass for you.
            className={`main-button${button.action === null ? " waiting" : ""}${props.fullControl ? " full-control" : ""}`}
            style={place(anchors.mainButton)}
            // Disabled only when it has nothing to do; while an action is on its way it keeps focus (aria-disabled).
            disabled={button.action === null}
            aria-disabled={busy}
            onClick={() => button.action !== null && !busy && act(button.action, true)}
          >
            <span className="main-label">{button.label}</span>
            {button.detail !== null && (
              <span className="main-detail" style={{ fontSize: detailSize(button.detail, anchors.mainButton.width) }}>
                {button.detail}
              </span>
            )}
          </button>
        )
      )}
      {(props.playing ? [] : controls.secondary).map((choice, i) => {
        const at = anchors.secondary[i];
        return at === undefined ? null : (
          <button
            key={choice.label}
            type="button"
            className="secondary-button"
            style={place(at)}
            aria-disabled={busy}
            onClick={() => !busy && act(choice.action, true)}
          >
            {choice.label}
          </button>
        );
      })}
      {/* The batch button always in the second slot, Undo always in the first: a tap never lands on a different action
          that just moved into the place pressed (ui.md "Never"). */}
      {props.attackBatch !== null && !props.playing && anchors.secondary[1] !== undefined && (
        <button
          type="button"
          className="secondary-button"
          style={place(anchors.secondary[1])}
          aria-disabled={busy || props.attackBatch.running}
          onClick={() => !busy && !props.attackBatch?.running && props.attackBatch?.run()}
        >
          {props.attackBatch.label}
        </button>
      )}
      <div className="prompt-anchor" style={{ left: anchors.prompt.x, top: anchors.prompt.y }}>
        <Prompt
          // While what the host did plays, a frame's decision isn't the person's to answer: no prompt over it.
          prompt={props.playing ? null : controls.prompt}
          title={deciding && !props.playing ? promptTitle(shown, props.selection) : null}
          layout={promptLayout(shown)}
          decision={view.decision?.id ?? null}
          busy={busy}
          act={act}
        />
      </div>
      {props.menu !== null && menuAt !== undefined && menuAt !== null && (
        <ChoiceMenu at={menuAt} choices={props.menu.choices} act={act} close={props.closeMenu} />
      )}
      <SettingsMenu
        concede={controls.concede}
        act={act}
        fullControl={props.fullControl}
        setFullControl={props.setFullControl}
      />
      {/* Over everything else: what's being looked at. */}
      {/* Not over a finished game: the result says what matters then. */}
      {props.banner !== null && result === null && (
        // At the middle of the open table, over nothing a tap needs; read out once by a screen reader.
        <p
          // A new element for each turn's banner, so its fade plays again.
          key={props.banner}
          className="turn-banner"
          role="status"
          style={{ left: model.band.x + model.band.width / 2, top: model.band.y + model.band.height / 2 }}
        >
          {props.banner}
        </p>
      )}
      {/* What the frame on screen shows, under the turn's banner: "Your opponent cast Lightning Bolt" (D-172). */}
      {props.line !== null && result === null && (
        <p
          key={props.line}
          className="event-line"
          role="status"
          style={{ left: model.band.x + model.band.width / 2, top: model.band.y + model.band.height / 2 + 26 }}
        >
          {props.line}
        </p>
      )}
      {anchors.stackMore !== null && (
        <button
          type="button"
          className="stack-more"
          style={place(anchors.stackMore)}
          aria-label={`The stack, ${view.zones.stack.length} objects: show them all`}
          onClick={() => props.browse({ kind: "stack" })}
        >
          Stack {view.zones.stack.length}
        </button>
      )}
      {props.browsing !== null && (
        <ZoneBrowser
          shown={shown}
          browsing={props.browsing}
          choose={(zone: ZoneName) => {
            if (props.browsing?.kind === "player") props.browse({ ...props.browsing, zone });
          }}
          close={() => props.browse(null)}
        />
      )}
      {props.inspected !== null && (
        <CardView
          // A preview made full is a new view (the full one takes focus); a preview swapped to another card isn't.
          key={props.inspected.mode}
          viewKey={props.inspected.id}
          mode={props.inspected.mode}
          details={props.inspected.details}
          close={props.closeInspected}
        />
      )}
      {result !== null && (
        <p role="status" className="result">
          {result.winner === me ? "You win" : result.winner === null ? "Draw" : "You lose"}
        </p>
      )}
    </section>
  );
}

/**
 * The mana in the person's pool (CR 106.4), just above their info block while there is any: one symbol per type with
 * how much, so mana made by tapping a land for a cost that needs more is in sight until it's spent or empties (CR 500.4).
 */
function ManaPoolChip({ pool, above }: { pool: Record<string, number> | undefined; above: Rect }) {
  const held = Object.entries(pool ?? {}).filter(([, n]) => n > 0);
  if (held.length === 0) return null;
  return (
    <div
      className="mana-pool"
      style={{ left: above.x, top: above.y - 32 }}
      role="img"
      aria-label={`Mana pool: ${held.map(([type, n]) => `${n} ${type}`).join(", ")}`}
    >
      {held.map(([type, n]) => (
        <span key={type}>
          <ManaText text={`{${type}}`} />
          {n > 1 && <span className="mana-count">×{n}</span>}
        </span>
      ))}
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
