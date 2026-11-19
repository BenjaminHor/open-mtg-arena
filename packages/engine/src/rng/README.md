# engine/src/rng

The game's only source of randomness (D-002): xoshiro128** 1.1, seeded from the game's `seed` with SplitMix64.
The state is four 32-bit numbers stored in `GameState.rng`. Every function is pure: it takes a state and
returns `{ value, rng }` with the state to use next (D-021).

- `seedRng(seed)`: the starting state for a seed (a non-negative safe integer).
- `nextUint32(rng)`: the next 32-bit number.
- `randomInt(rng, n)`: a uniformly random integer from 0 to n − 1. It draws again on the rare values that would
  favor some results, so it's unbiased.

Tests: `test/rng/xoshiro128.test.ts`, with known answers from the reference implementations (through the Rust crate
rand_xoshiro 0.6.0), a snapshot of seed 42, range and distribution checks. Changing any output here changes every
saved game and replay, so it needs a decision entry.
