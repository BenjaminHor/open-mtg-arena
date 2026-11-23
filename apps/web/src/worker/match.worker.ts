// The match host's Web Worker (architecture.md, "Match host"): the engine and the heuristic AI run here, off the UI
// thread, so a long AI turn never stalls an animation. Only wiring: the logic is `match-session.ts`.

import { cardDatabase } from "@mtg/cards";
import { handle, type Session } from "./match-session.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";

const cards = cardDatabase();
let session: Session | null = null;

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const handled = handle(session, event.data, cards);
  session = handled.session;
  const reply: FromWorker = handled.reply;
  self.postMessage(reply);
};
