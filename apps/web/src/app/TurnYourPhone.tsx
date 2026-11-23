// Over the paused match while a phone is upright (ui.md, "Layouts"; D-171): turning it back carries on where it was.
// It takes focus while it's up (the match behind is inert, so focus there is lost) and gives it back when it goes.

import { useEffect, useRef } from "react";

export function TurnYourPhone() {
  const prompt = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    prompt.current?.focus();
    // After `inert` is lifted from the match, so the element can take focus again.
    return () => {
      requestAnimationFrame(() => before?.focus());
    };
  }, []);
  return (
    <div
      ref={prompt}
      className="turn-your-phone"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="turn-your-phone-title"
      aria-describedby="turn-your-phone-note"
      tabIndex={-1}
    >
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <rect x="22" y="8" width="20" height="36" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M14 50 A 22 22 0 0 0 50 50" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M50 50 l-7 -2 M50 50 l2 -7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <p id="turn-your-phone-title">Turn your phone sideways to play</p>
      {/* The rule is the viewport's (ui.md): a narrow desktop window gets it too, and can be widened instead. */}
      <p id="turn-your-phone-note" className="turn-your-phone-note">
        The match waits here. On a computer, widen the window.
      </p>
    </div>
  );
}
