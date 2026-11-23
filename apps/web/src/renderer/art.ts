// Card art, loaded at runtime from Scryfall's image host (D-007: never bundled), which serves it cross-origin. Each
// link loads once; a failure (offline, or the host refused) leaves the card with its art-less frame, and is forgotten
// so a later draw tries again. M3-08 adds the offline art cache and the first-run download; until then the browser's
// own cache is all there is.
//
// A plain image element, not Pixi's `Assets.load`: under load (a busy CI runner, several pages at once) some loads
// through `Assets` hadn't settled after six seconds, leaving those cards art-less, as a pending load isn't asked again.
// (One full render per arriving texture was part of the slowness; renders are now one per frame.) An image element
// always ends in `load` or `error`. Its decode may now happen on the main thread: worth a look in M3-07's traces.

import { Texture } from "pixi.js";

const loading = new Map<string, Promise<Texture | null>>();

export function loadArt(url: string): Promise<Texture | null> {
  const known = loading.get(url);
  if (known !== undefined) return known;
  const started = new Promise<Texture | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(Texture.from(image));
    image.onerror = () => {
      loading.delete(url);
      resolve(null);
    };
    image.src = url;
  });
  loading.set(url, started);
  return started;
}
