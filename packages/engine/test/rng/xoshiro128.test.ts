import { describe, expect, it } from "vitest";
import { splitMix64 } from "../../src/rng/splitmix64.ts";
import { nextUint32, type RngState, randomInt, seedRng } from "../../src/rng/xoshiro128.ts";

// Known-answer vectors copied from the Rust crate rand_xoshiro 0.6.0 (src/xoshiro128starstar.rs and
// src/splitmix64.rs). Its comments say they were produced with Sebastiano Vigna's reference C implementations
// (xoshiro128starstar.c v1.1 and splitmix64.c).

function take(rng: RngState, n: number): number[] {
  const out: number[] = [];
  let r = rng;
  for (let i = 0; i < n; i++) {
    const next = nextUint32(r);
    out.push(next.value);
    r = next.rng;
  }
  return out;
}

describe("xoshiro128**", () => {
  it("matches the reference implementation from state [1, 2, 3, 4]", () => {
    // rand_xoshiro's from_seed([1,0,0,0, 2,0,0,0, 3,0,0,0, 4,0,0,0]) is the little-endian words [1, 2, 3, 4].
    expect(take([1, 2, 3, 4], 10)).toStrictEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804,
    ]);
  });

  it("doesn't change the state it was given (D-021)", () => {
    const rng: RngState = [1, 2, 3, 4];
    nextUint32(rng);
    expect(rng).toStrictEqual([1, 2, 3, 4]);
  });
});

describe("SplitMix64", () => {
  it("matches the reference implementation", () => {
    const expected = [
      1985237415132408290n,
      2979275885539914483n,
      13511426838097143398n,
      8488337342461049707n,
      15141737807933549159n,
    ];
    let state = 1477776061723855037n;
    for (const e of expected) {
      const next = splitMix64(state);
      expect(next.value).toBe(e);
      state = next.state;
    }
  });
});

describe("seedRng", () => {
  it("gives the same sequence for the same seed", () => {
    expect(take(seedRng(42), 5)).toStrictEqual(take(seedRng(42), 5));
  });

  it("gives different sequences for different seeds", () => {
    expect(take(seedRng(1), 5)).not.toStrictEqual(take(seedRng(2), 5));
  });

  it("keeps producing the same values for seed 42", () => {
    // Self-generated snapshot (no published vector covers our seeding path). If this changes, every saved
    // game and replay would play out differently, so a change needs a reason in docs/decisions.md.
    expect(seedRng(42)).toMatchInlineSnapshot(`
      [
        803958421,
        3184996902,
        2993090819,
        686809907,
      ]
    `);
    expect(take(seedRng(42), 5)).toMatchInlineSnapshot(`
      [
        1776835114,
        4165204688,
        17111135,
        2317295270,
        2792088233,
      ]
    `);
  });

  it("rejects seeds that aren't non-negative safe integers", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => seedRng(bad)).toThrow();
    }
  });

  it("makes a state that is plain JSON", () => {
    const rng = seedRng(7);
    expect(JSON.parse(JSON.stringify(rng))).toStrictEqual(rng);
  });
});

describe("randomInt", () => {
  it("stays in [0, n)", () => {
    let rng = seedRng(3);
    for (const n of [1, 2, 3, 7, 40, 1000, 2 ** 31 + 1]) {
      for (let i = 0; i < 200; i++) {
        const next = randomInt(rng, n);
        expect(next.value).toBeGreaterThanOrEqual(0);
        expect(next.value).toBeLessThan(n);
        expect(Number.isInteger(next.value)).toBe(true);
        rng = next.rng;
      }
    }
  });

  it("returns 0 for n = 1", () => {
    expect(randomInt(seedRng(9), 1).value).toBe(0);
  });

  it("hits every value of a small range about equally often", () => {
    let rng = seedRng(11);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60_000; i++) {
      const next = randomInt(rng, 6);
      counts[next.value] = (counts[next.value] ?? 0) + 1;
      rng = next.rng;
    }
    for (const c of counts) {
      // Expected 10,000 each; a fair generator stays within a few percent.
      expect(c).toBeGreaterThan(9_500);
      expect(c).toBeLessThan(10_500);
    }
  });

  it("rejects ranges that aren't positive integers up to 2^32", () => {
    for (const bad of [0, -3, 2.5, 2 ** 32 + 1, Number.NaN]) {
      expect(() => randomInt(seedRng(1), bad)).toThrow();
    }
  });
});
