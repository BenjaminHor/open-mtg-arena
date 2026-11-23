// The PixiJS scene (D-013, ui.md "Board structure"): it draws the board model and nothing else, with no game logic and
// no layout math (`board-model/` does that). Cards are kept by object id and updated in place, so a card that reflows,
// piles or taps is the same sprite; one that changes zone is a new object (CR 400.7) and, until M3-07 carries sprites
// across from the view's events, a new sprite. Hidden cards (the opponent's hand) are few and redrawn each time.

import { Application, Container, Graphics } from "pixi.js";
import type { BoardModel } from "../board-model/board-model.ts";
import { cardBackSprite } from "./card-back.ts";
import { pileBadge } from "./card-marks.ts";
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
  // Art arriving (a texture per card, often a dozen at once) asks for one render in the next frame, not one each.
  let frameAsked = false;
  let destroyed = false;
  const renderSoon = () => {
    if (frameAsked) return;
    frameAsked = true;
    requestAnimationFrame(() => {
      frameAsked = false;
      if (!destroyed) render();
    });
  };
  host.appendChild(app.canvas);
  const hidden = new Container();
  const cardLayer = new Container({ sortableChildren: true });
  // Combat's links go over the cards, so a pairing is never hidden under a card between the two.
  const links = new Graphics();
  // Pile counts over everything on the board: a neighbouring row never covers one.
  const marks = new Container();
  app.stage.addChild(hidden, cardLayer, links, marks);
  const sprites = new Map<string, CardSprite>();
  return {
    draw: (model) => {
      app.renderer.resize(model.width, model.height);
      // The gap between the battlefields is open table (ui.md, "Room between the battlefields"): nothing to draw.
      // `context: true` frees each Graphics' drawing too, which a plain `children: true` leaves behind.
      for (const child of hidden.removeChildren()) child.destroy({ children: true, context: true });
      for (const back of model.backs) hidden.addChild(cardBackSprite(back));
      const present = new Set<string>();
      model.cards.forEach((card, i) => {
        present.add(card.id);
        const known = sprites.get(card.id);
        const sprite = known ?? createCardSprite(card, new Container(), renderSoon);
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
      drawLinks(links, model.links);
      for (const child of marks.removeChildren()) child.destroy({ children: true, context: true });
      for (const card of model.cards) {
        if (card.pileCount === null) continue;
        const badge = pileBadge(card.pileCount, card.width, card.height);
        const at = new Container({ x: card.x + card.width / 2, y: card.y + card.height / 2, rotation: card.rotation });
        at.addChild(badge);
        marks.addChild(at);
      }
      exposeForTests(model, sprites);
      render();
    },
    destroy: () => {
      destroyed = true;
      for (const sprite of sprites.values()) sprite.destroy();
      sprites.clear();
      app.destroy(true, { children: true, context: true });
    },
  };
}

/** Each pairing as a light line with a dark edge and a dot at each end; an attack on a planeswalker in the attack colour. */
function drawLinks(g: Graphics, links: BoardModel["links"]): void {
  g.clear();
  for (const link of links) {
    const color = link.kind === "attack" ? PALETTE.attack : PALETTE.badgeText;
    for (const [width, c] of [
      [5, PALETTE.rim],
      [2.5, color],
    ] as const) {
      g.moveTo(link.from.x, link.from.y).lineTo(link.to.x, link.to.y).stroke({ width, color: c, cap: "round" });
    }
    for (const end of [link.from, link.to])
      g.circle(end.x, end.y, 3.5).fill(color).stroke({ width: 1.5, color: PALETTE.rim });
  }
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
