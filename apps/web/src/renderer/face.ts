// What drawing a card gives the sprite (card-sprite.ts): the container to show, and a way to put the art in once it
// has loaded. The art's sprite carries `ART_LABEL`, so tests and the sprite can tell whether it's shown.

import type { Container, Texture } from "pixi.js";

export const ART_LABEL = "art";

export type Face = { container: Container; showArt: (texture: Texture) => void };
