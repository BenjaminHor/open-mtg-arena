// `pnpm fuzz --jobs N` (D-117): the same games as `runFuzz`, one seed each, shared out among N worker threads. Each
// worker takes the next seed when it finishes one, so slow games don't hold the others up. The games are independent
// and each is decided by its seed alone, so the results are the same as one thread's, in seed order.

import { Worker } from "node:worker_threads";
import { type FuzzOptions, type FuzzSummary, recordFailure } from "./run-fuzz.ts";
import { type FailureFile, TURN_CAP } from "./run-game.ts";

export type WorkerTask = { seed: number; turnCap: number };
export type WorkerReply = { seed: number; failure: { problem: string; file: FailureFile } | null };

/** Plays the games on `jobs` worker threads, with every check (a worker can't be sent other check functions). */
export function runFuzzParallel(options: Omit<FuzzOptions, "checks">, jobs: number): Promise<FuzzSummary> {
  const turnCap = options.turnCap ?? TURN_CAP;
  const seeds = Array.from({ length: options.games }, (_, i) => options.seed + i);
  const failures: FuzzSummary["failures"] = [];
  let next = 0;
  let done = 0;
  return new Promise((resolve, reject) => {
    const workers = Array.from(
      { length: Math.min(jobs, seeds.length) },
      () => new Worker(new URL("./worker.ts", import.meta.url)),
    );
    const finish = (error: unknown) => {
      for (const w of workers) void w.terminate();
      if (error === null) resolve({ games: options.games, failures: failures.sort((a, b) => a.seed - b.seed) });
      else reject(error);
    };
    const give = (worker: Worker) => {
      const seed = seeds[next++];
      if (seed !== undefined) worker.postMessage({ seed, turnCap } satisfies WorkerTask);
    };
    for (const worker of workers) {
      worker.on("message", (reply: WorkerReply) => {
        if (reply.failure !== null) {
          const { problem, file } = reply.failure;
          failures.push(recordFailure(options.outDir, reply.seed, problem, file));
        }
        if (++done === seeds.length) finish(null);
        else give(worker);
      });
      worker.on("error", finish);
      give(worker);
    }
  });
}
