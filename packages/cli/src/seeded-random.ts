// The seeded random numbers the agents, the fuzzer and random decks draw from: pure, so one seed is one game.

/** A tiny seeded PRNG (mulberry32): one 32-bit number of state, enough for picking actions reproducibly. */
export function nextRandom(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}
