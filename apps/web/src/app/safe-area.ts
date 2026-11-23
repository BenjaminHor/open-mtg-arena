// The safe-area insets (ui.md, "Layouts": the notch, the home indicator) in CSS px. CSS knows them as
// `env(safe-area-inset-*)` and script doesn't, so a hidden probe takes them as padding and the computed style gives
// them back. Zero everywhere but on a phone with a notch, and only with `viewport-fit=cover` (index.html).

import type { Insets } from "../board-model/board-model.ts";

export function readInsets(): Insets {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;" +
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: Number.parseFloat(style.paddingTop) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}
