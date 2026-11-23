// The app's one typeface (D-162, D-163): Inter, a clean, even sans-serif (SIL Open Font License), the same on every
// device instead of each system's own. Only its Latin letters are loaded, one 48 KB variable file that the build bundles
// and the service worker keeps for offline play. The board's canvas measures text as it draws it, so the app waits for
// the font before its first draw; if it's slow (or fails), the system's sans-serif stands in rather than hold it up.

import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";

/** The CSS name the HUD's styles and the canvas's text use. */
export const FONT_FAMILY = "Inter";

/** ms: the longest the first draw waits for the font. */
const PATIENCE = 1500;

export async function loadFont(): Promise<void> {
  const face = new FontFace(FONT_FAMILY, `url(${interLatin})`, { weight: "100 900", display: "swap" });
  document.fonts.add(face);
  await Promise.race([face.load().catch(() => undefined), new Promise((done) => setTimeout(done, PATIENCE))]);
}
