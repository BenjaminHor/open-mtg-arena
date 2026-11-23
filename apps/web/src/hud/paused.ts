// Whether the match is paused behind the "turn your phone" prompt (D-171): its main element is inert, so nothing in it
// takes a tap or focus, and every key listener on the window checks this first, so no key reaches it either.

export function matchPaused(): boolean {
  return document.querySelector("main.app[inert]") !== null;
}
