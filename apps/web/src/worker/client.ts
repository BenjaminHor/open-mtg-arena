// The UI's side of the match worker: start it, send it messages, hear its replies. Vite bundles the worker from the
// `new URL(..., import.meta.url)` form, in development and in the production build alike.

import type { FromWorker, ToWorker } from "./protocol.ts";

export type MatchClient = { send: (message: ToWorker) => void; stop: () => void };

export function startMatchWorker(onReply: (reply: FromWorker) => void): MatchClient {
  const worker = new Worker(new URL("./match.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<FromWorker>) => onReply(event.data);
  return {
    send: (message) => worker.postMessage(message),
    stop: () => worker.terminate(),
  };
}
