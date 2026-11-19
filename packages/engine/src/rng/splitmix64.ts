// SplitMix64 (Steele, Lea and Flood; constants as in Sebastiano Vigna's splitmix64.c).
// Used only to turn a game seed into a xoshiro128** state, as Vigna recommends. BigInt is used
// here for 64-bit arithmetic and never stored in game state (it isn't JSON).

const MASK_64 = (1n << 64n) - 1n;

/** One SplitMix64 step: the next 64-bit output and the state to continue from. */
export function splitMix64(state: bigint): { value: bigint; state: bigint } {
  const next = (state + 0x9e3779b97f4a7c15n) & MASK_64;
  let z = next;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return { value: z ^ (z >> 31n), state: next };
}
