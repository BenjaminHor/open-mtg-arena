// xoshiro128** 1.1 (David Blackman and Sebastiano Vigna), the game's only source of randomness (D-024).
// It's small, fast, well tested, and its state is four 32-bit numbers, so it fits in plain-JSON game state.
// Every function is pure: it takes a state and returns the value plus the state to use next (D-021).

import { splitMix64 } from "./splitmix64.ts";

/** Four unsigned 32-bit words. Never all zero. */
export type RngState = [number, number, number, number];

/** Build a generator state from a game seed by expanding it with SplitMix64. */
export function seedRng(seed: number): RngState {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError(`An RNG seed must be a non-negative safe integer, got ${seed}`);
  }
  const first = splitMix64(BigInt(seed));
  const second = splitMix64(first.state);
  // Each 64-bit output fills two words, low half first. SplitMix64's output is a one-to-one function of its
  // state, so only one state gives 0, two consecutive outputs can't both be 0, and the result is never all zero.
  return [low32(first.value), high32(first.value), low32(second.value), high32(second.value)];
}

/** The next unsigned 32-bit number. */
export function nextUint32(rng: RngState): { value: number; rng: RngState } {
  let [s0, s1, s2, s3] = rng;
  const value = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  s2 = (s2 ^ s0) >>> 0;
  s3 = (s3 ^ s1) >>> 0;
  s1 = (s1 ^ s2) >>> 0;
  s0 = (s0 ^ s3) >>> 0;
  s2 = (s2 ^ t) >>> 0;
  s3 = rotl(s3, 11);
  return { value, rng: [s0, s1, s2, s3] };
}

const TWO_32 = 2 ** 32;

/**
 * A uniformly random integer in [0, n), for 1 ≤ n ≤ 2^32. It rejects the few draws that would make some results
 * more likely than others (where 2^32 isn't a multiple of n) and draws again, so every result is equally likely.
 */
export function randomInt(rng: RngState, n: number): { value: number; rng: RngState } {
  if (!Number.isInteger(n) || n < 1 || n > TWO_32) {
    throw new RangeError(`randomInt needs an integer range from 1 to 2^32, got ${n}`);
  }
  const limit = TWO_32 - (TWO_32 % n);
  let current = rng;
  for (;;) {
    const next = nextUint32(current);
    if (next.value < limit) return { value: next.value % n, rng: next.rng };
    current = next.rng;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

function low32(x: bigint): number {
  return Number(x & 0xffffffffn);
}

function high32(x: bigint): number {
  return Number(x >> 32n);
}
