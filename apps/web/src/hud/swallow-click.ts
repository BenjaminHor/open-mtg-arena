// The click a press fires on release, when the press was something else: a drag (`hand-drag.ts`) or a long-press that
// opened the card view (`card-inspect.ts`). Shared by both, so neither's release ever also counts as a tap.

/**
 * A drag's or a long-press's release can also fire a click, on the card or on the table where it was let go: a tap on
 * the card, or the table's "put things down". Neither is meant, so that click is stopped before anything sees it. A
 * touch release often fires none: then the next press, or a moment's wait, takes the listener away, so a real click is
 * never eaten.
 */
export function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  const done = () => {
    window.removeEventListener("click", stop, { capture: true });
    window.removeEventListener("pointerdown", done, { capture: true });
  };
  window.addEventListener("click", stop, { capture: true });
  window.addEventListener("pointerdown", done, { capture: true });
  setTimeout(done, 300);
}
