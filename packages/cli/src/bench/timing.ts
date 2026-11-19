// Timing workloads: warm each up, then time them in rounds, one batch of each per round, and take each one's median
// batch. Interleaving means a slow moment (garbage collection, another process) hits every workload alike, and the
// median shrugs off the rounds it hit hardest.

const WARM_UP_MS = 200;
const BATCH_MS = 30;
const ROUNDS = 21;

/** The median time of one run of each workload, in milliseconds, by name. */
export function medianTimes(work: Record<string, () => void>): Record<string, number> {
  const perBatch: Record<string, number> = {};
  for (const [name, run] of Object.entries(work)) {
    const end = performance.now() + WARM_UP_MS;
    let runs = 0;
    while (performance.now() < end) {
      run();
      runs++;
    }
    // Enough runs per batch to last about BATCH_MS, judged from the warm-up.
    perBatch[name] = Math.max(1, Math.round((runs * BATCH_MS) / WARM_UP_MS));
  }
  const times: Record<string, number[]> = {};
  for (let round = 0; round < ROUNDS; round++) {
    for (const [name, run] of Object.entries(work)) {
      const n = perBatch[name] ?? 1;
      const start = performance.now();
      for (let i = 0; i < n; i++) run();
      const list = times[name] ?? [];
      list.push((performance.now() - start) / n);
      times[name] = list;
    }
  }
  return Object.fromEntries(Object.entries(times).map(([name, list]) => [name, median(list)]));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/**
 * A fixed amount of plain JavaScript work (sorting, building objects, JSON), to measure how fast this machine is right
 * now. Engine times are compared as multiples of it, so a baseline made on one machine still means something on
 * another, and a busy machine slows both.
 */
export function referenceWork(): void {
  let seed = 1;
  const numbers = Array.from({ length: 5_000 }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  });
  numbers.sort((a, b) => a - b);
  const objects = numbers.slice(0, 500).map((n) => ({ id: `o${n}`, value: n % 97, tags: [n % 3, n % 5] }));
  JSON.parse(JSON.stringify(objects));
}
