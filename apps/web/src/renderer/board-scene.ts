// The PixiJS scene (D-013, ui.md "Board structure"): it draws the board model and nothing else, with no game logic and
// no layout math (`board-model/` does that). This first version redraws the whole board on each update, cards as plain
// rounded rectangles with their names; M3-04 gives them real frames and M3-07 animates between models.

import { Application, Container, Graphics, Text } from "pixi.js";
import type { BoardCard, BoardModel } from "../board-model/board-model.ts";

export type BoardScene = { draw: (model: BoardModel) => void; destroy: () => void };

const COLORS = { table: 0x16181d, mine: 0x2d3e5e, theirs: 0x5e322d, hand: 0x3b4d2c, edge: 0xd8d2c0, text: 0xf2efe6 };

export async function createBoardScene(host: HTMLElement): Promise<BoardScene> {
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: COLORS.table,
    antialias: true,
    autoDensity: true,
    resolution: devicePixelRatio,
  });
  host.appendChild(app.canvas);
  return {
    draw: (model) => {
      for (const child of app.stage.removeChildren()) child.destroy({ children: true });
      for (const card of model.cards) app.stage.addChild(cardSprite(card));
      exposeForTests(model);
    },
    destroy: () => app.destroy(true, { children: true }),
  };
}

function cardSprite(card: BoardCard): Container {
  const sprite = new Container({ x: card.x + card.width / 2, y: card.y + card.height / 2 });
  // A tapped permanent is turned sideways (CR 701.26a), about its centre.
  sprite.rotation = card.tapped ? Math.PI / 2 : 0;
  const fill = card.zone === "hand" ? COLORS.hand : card.mine ? COLORS.mine : COLORS.theirs;
  const frame = new Graphics()
    .roundRect(-card.width / 2, -card.height / 2, card.width, card.height, card.width * 0.06)
    .fill(fill)
    .stroke({ width: 1.5, color: COLORS.edge });
  const fontSize = Math.max(9, card.width * 0.12);
  const name = new Text({
    text: card.name,
    style: { fill: COLORS.text, fontSize, wordWrap: true, wordWrapWidth: card.width - 8, fontFamily: "system-ui" },
  });
  name.position.set(-card.width / 2 + 4, -card.height / 2 + 4);
  sprite.addChild(frame, name);
  if (card.power !== null && card.toughness !== null) {
    const stats = new Text({
      text: `${card.power}/${card.toughness}`,
      style: { fill: COLORS.text, fontSize, fontFamily: "system-ui" },
    });
    stats.anchor.set(1, 1);
    stats.position.set(card.width / 2 - 4, card.height / 2 - 4);
    sprite.addChild(stats);
  }
  sprite.label = card.name;
  return sprite;
}

/**
 * The test hook (ui.md, "Testing a canvas"): Playwright can't see inside a canvas, so development and test builds put
 * the current board model on `window.__board`, each card with its rectangle in CSS pixels. Production builds don't.
 */
function exposeForTests(model: BoardModel): void {
  if (import.meta.env.DEV || import.meta.env.VITE_TEST_HOOKS === "1") {
    (window as unknown as { __board: BoardModel }).__board = model;
  }
}
