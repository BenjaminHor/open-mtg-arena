// The settings button at the top right [R] (a cog in Arena), for now holding only conceding, which is always possible
// (CR 104.3a) and so asks once more before it's sent.

import type { Action } from "@mtg/engine";
import { useState } from "react";

export function SettingsMenu({ concede, act }: { concede: Action | null; act: (action: Action) => void }) {
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
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
        <div className="settings-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (!sure) setSure(true);
              else {
                setOpen(false);
                setSure(false);
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
