// The UI's side of the match worker: start it, send it messages, hear its replies. Vite bundles the worker from the
// `new URL(..., import.meta.url)` form, in development and in the production build alike.

import type { FromWorker, ToWorker } from "./protocol.ts";

export type MatchClient = { send: (message: ToWorker) => void; stop: () => void };

export function startMatchWorker(onReply: (reply: FromWorker) => void): MatchClient {
  const worker = new Worker(new URL("./match.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<FromWorker>) => onReply(event.data);
  // A worker that fails to load or to run, or a message that can't be read, is reported like any refusal.
  worker.onerror = (event) => onReply({ type: "error", message: `the match worker failed: ${event.message}` });
  worker.onmessageerror = () => onReply({ type: "error", message: "a message from the match worker couldn't be read" });
  return {
    send: (message) => worker.postMessage(message),
    stop: () => worker.terminate(),
  };
}
