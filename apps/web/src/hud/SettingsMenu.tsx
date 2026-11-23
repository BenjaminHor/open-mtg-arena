// The settings button at the top right [R] (a cog in Arena): full control, and conceding, which is always possible
// (CR 104.3a) and so asks once more before it's sent.

import type { Action } from "@mtg/engine";
import { useEffect, useState } from "react";
import { matchPaused } from "./paused.ts";

type Props = {
  concede: Action | null;
  act: (action: Action) => void;
  /** Full control (arena-research.md): the host never passes priority for the person while it's on. */
  fullControl: boolean;
  setFullControl: (on: boolean) => void;
};

export function SettingsMenu({ concede, act, fullControl, setFullControl }: Props) {
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const close = () => {
    setOpen(false);
    setSure(false);
  };
  // Escape closes the menu first, before the app's own Escape (a cast under way) sees it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || matchPaused()) return;
      event.stopImmediatePropagation();
      setOpen(false);
      setSure(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);
  return (
    <div className="settings">
      <button
        type="button"
        className="settings-toggle"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm7 4.5-1.6.4a5.6 5.6 0 0 1-.6 1.4l.8 1.4-1.4 1.4-1.4-.8a5.6 5.6 0 0 1-1.4.6L11 17H9l-.4-1.6a5.6 5.6 0 0 1-1.4-.6l-1.4.8-1.4-1.4.8-1.4a5.6 5.6 0 0 1-.6-1.4L3 11V9l1.6-.4a5.6 5.6 0 0 1 .6-1.4l-.8-1.4 1.4-1.4 1.4.8a5.6 5.6 0 0 1 1.4-.6L9 3h2l.4 1.6a5.6 5.6 0 0 1 1.4.6l1.4-.8 1.4 1.4-.8 1.4a5.6 5.6 0 0 1 .6 1.4L17 9Z" />
        </svg>
      </button>
      {open && concede !== null && (
        <div className="settings-menu">
          <button
            type="button"
            className="full-control"
            role="switch"
            aria-checked={fullControl}
            onClick={() => setFullControl(!fullControl)}
          >
            Full control: {fullControl ? "on" : "off"}
          </button>
          <button
            type="button"
            className="concede"
            onClick={() => {
              if (!sure) setSure(true);
              else {
                close();
                act(concede);
              }
            }}
          >
            {sure ? "Concede? Tap again" : "Concede"}
          </button>
        </div>
      )}
    </div>
  );
}
