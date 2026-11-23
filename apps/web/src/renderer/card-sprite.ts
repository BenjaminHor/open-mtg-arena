// One card drawn on the board, kept by object id and updated in place: a card that reflows in its row, piles or taps
// is the same sprite. A card that changes zone is a new object with a new id (CR 400.7), so it gets a new sprite; M3-07
// will carry the sprite across from the view's events. The face is redrawn only when how it looks changes, not when it
// only moves. Art arrives after the face and is added when it loads.

import type { Container } from "pixi.js";
import type { BoardCard } from "../board-model/board-model.ts";
import { loadArt } from "./art.ts";
import { ART_LABEL, drawFace } from "./card-face.ts";

export type CardSprite = {
  root: Container;
  update: (card: BoardCard) => void;
  /** Whether the card's art is showing (for the test hook). */
  hasArt: () => boolean;
  destroy: () => void;
};

/** `changed` is called when the sprite changes on its own (its art arrived), so the scene draws a frame. */
export function createCardSprite(card: BoardCard, root: Container, changed: () => void): CardSprite {
  root.label = card.name;
  let drawn = "";
  // The face drawn last: art that arrives for an older face (the card redrew meanwhile) is dropped.
  let current: Container | null = null;
  const update = (next: BoardCard) => {
    // The card's centre is its pivot, so a tilt turns it in place.
    root.position.set(next.x + next.width / 2, next.y + next.height / 2);
    root.rotation = next.rotation;
    const look = lookKey(next);
    if (look === drawn) return;
    drawn = look;
    for (const child of root.removeChildren()) child.destroy({ children: true, context: true });
    const face = drawFace(next);
    current = face.container;
    root.addChild(face.container);
    if (next.art !== null) {
      loadArt(next.art).then((texture) => {
        if (current === face.container && texture !== null) {
          face.showArt(texture);
          changed();
        }
      });
    }
  };
  update(card);
  return {
    root,
    update,
    hasArt: () => current?.getChildByLabel(ART_LABEL, true) != null,
    destroy: () => {
      current = null;
      root.destroy({ children: true, context: true });
    },
  };
}

/** Everything that changes how the card looks, apart from where it is: a change redraws it. */
function lookKey(c: BoardCard): string {
  const { id: _id, x: _x, y: _y, rotation: _r, ...look } = c;
  return JSON.stringify(look);
}
