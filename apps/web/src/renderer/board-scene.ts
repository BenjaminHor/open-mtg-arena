// The PixiJS scene (D-013, ui.md "Board structure"): it draws the board model and nothing else, with no game logic and
// no layout math (`board-model/` does that). Cards are kept by object id and updated in place, so a card that reflows,
// piles or taps is the same sprite; one that changes zone is a new object (CR 400.7) and, until M3-07 carries sprites
// across from the view's events, a new sprite. Hidden cards (backs, libraries) are few and redrawn each time.

import { Application, Container, Graphics } from "pixi.js";
import type { BoardModel } from "../board-model/board-model.ts";
import { cardBackSprite, librarySprite } from "./card-back.ts";
import { type CardSprite, createCardSprite } from "./card-sprite.ts";
import { PALETTE } from "./palette.ts";

export type BoardScene = { draw: (model: BoardModel) => void; destroy: () => void };

export async function createBoardScene(host: HTMLElement): Promise<BoardScene> {
  const app = new Application();
  // Sized by each board model, not `resizeTo`: the model is the one measure of the board.
  await app.init({
    width: host.clientWidth,
    height: host.clientHeight,
    // The table itself is the page's background (app.css), under a transparent canvas.
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    // A phone's 3× screen gains little over 2× for the board and costs about twice the pixels to fill.
    resolution: Math.min(devicePixelRatio, 2),
  });
  // Drawn on demand: the board is still between updates, so there's no frame loop to drain a phone's battery. M3-07
  // runs the ticker while it animates.
  app.ticker.stop();
  const render = () => app.render();
  host.appendChild(app.canvas);
  const table = new Graphics();
  const hidden = new Container();
  const cardLayer = new Container({ sortableChildren: true });
  app.stage.addChild(table, hidden, cardLayer);
  const sprites = new Map<string, CardSprite>();
  return {
    draw: (model) => {
      app.renderer.resize(model.width, model.height);
      table
        .clear()
        .rect(model.band.x, model.band.y, model.band.width, model.band.height)
        .fill({ color: PALETTE.band, alpha: 0.9 })
        .rect(model.band.x, model.band.y + model.band.height / 2 - 0.5, model.band.width, 1)
        .fill({ color: 0x3a4252 });
      // `context: true` frees each Graphics' drawing too, which a plain `children: true` leaves behind.
      for (const child of hidden.removeChildren()) child.destroy({ children: true, context: true });
      for (const pile of model.libraries) hidden.addChild(librarySprite(pile));
      for (const back of model.backs) hidden.addChild(cardBackSprite(back));
      const present = new Set<string>();
      model.cards.forEach((card, i) => {
        present.add(card.id);
        const known = sprites.get(card.id);
        const sprite = known ?? createCardSprite(card, new Container(), render);
        if (known === undefined) {
          sprites.set(card.id, sprite);
          cardLayer.addChild(sprite.root);
        } else sprite.update(card);
        // The model lists cards back to front.
        sprite.root.zIndex = i;
      });
      for (const [id, sprite] of sprites) {
        if (!present.has(id)) {
          sprite.destroy();
          sprites.delete(id);
        }
      }
      exposeForTests(model, sprites);
      render();
    },
    destroy: () => {
      for (const sprite of sprites.values()) sprite.destroy();
      sprites.clear();
      app.destroy(true, { children: true, context: true });
    },
  };
}

/**
 * The test hook (ui.md, "Testing a canvas"): Playwright can't see inside a canvas, so development and test builds put
 * the current board model on `window.__board`, each card with its rectangle in CSS pixels, and `window.__artShown()`
 * lists the cards whose art is showing. Production builds don't.
 */
function exposeForTests(model: BoardModel, sprites: ReadonlyMap<string, CardSprite>): void {
  if (import.meta.env.DEV || import.meta.env.VITE_TEST_HOOKS === "1") {
    const hook = window as unknown as { __board: BoardModel; __artShown: () => string[] };
    hook.__board = model;
    hook.__artShown = () => [...sprites].flatMap(([id, sprite]) => (sprite.hasArt() ? [id] : []));
  }
}
