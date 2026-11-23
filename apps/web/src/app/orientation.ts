// A phone held upright (ui.md, "Layouts"): the board is laid out for a phone in landscape, as Arena's phone client
// plays (D-141), so in portrait a phone shows a "turn your phone" prompt over the paused match. Decided from the
// viewport, never the device (ui.md): portrait and narrower than a phone in landscape is wide. The unfolded Duo and a
// tablet are wider than that even upright, and play as they are. `use-portrait.ts` follows the window.

/** px: narrower than this and upright is a phone in portrait. */
const PHONE_WIDTH = 700;

export function isPortraitPhone(width: number, height: number): boolean {
  return height > width && width < PHONE_WIDTH;
}
