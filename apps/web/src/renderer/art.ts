// Card art, loaded at runtime from Scryfall's image host (D-007: never bundled), which serves it cross-origin. Each
// link loads once; a failure (offline, or the host refused) leaves the card with its art-less frame, and is forgotten
// so a later draw tries again. M3-08 adds the offline art cache and the first-run download; until then the browser's
// own cache is all there is.

import { Assets, type Texture } from "pixi.js";

const loading = new Map<string, Promise<Texture | null>>();

export function loadArt(url: string): Promise<Texture | null> {
  const known = loading.get(url);
  if (known !== undefined) return known;
  const started = Assets.load<Texture>({ src: url, parser: "loadTextures", data: { crossOrigin: "anonymous" } }).then(
    (texture) => texture,
    () => {
      loading.delete(url);
      return null;
    },
  );
  loading.set(url, started);
  return started;
}
