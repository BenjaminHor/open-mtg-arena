// One fuzzing worker thread (`pnpm fuzz --jobs N`, D-117): it asks for a seed, plays that game with every check, and
// sends back only whether it failed, so the main thread writes the failure files and the report.

import { parentPort } from "node:worker_threads";
import { cardDatabase } from "@mtg/cards";
import { ALL_CHECKS } from "./checks.ts";
import type { WorkerReply, WorkerTask } from "./parallel.ts";
import { fuzzGame } from "./run-game.ts";

const port = parentPort;
if (port === null) throw new Error("fuzz/worker.ts runs only as a worker thread");
const cards = cardDatabase();

port.on("message", (task: WorkerTask) => {
  const result = fuzzGame(task.seed, ALL_CHECKS, cards, task.turnCap);
  const reply: WorkerReply = result.ok
    ? { seed: task.seed, failure: null }
    : { seed: task.seed, failure: { problem: result.problem, file: result.file } };
  port.postMessage(reply);
});
