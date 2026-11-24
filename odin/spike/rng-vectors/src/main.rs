//! RNG test vectors for the Odin port (O-0 spike). The engine's `GameRng` is `ChaCha20Rng::seed_from_u64(seed)` and
//! draws with rand 0.9's `shuffle`, `random_range`, `choose` and `random_bool`; this prints, one per line, what each
//! of those returns for fixed seeds, so the Odin port can be checked byte for byte.
use rand::seq::{IndexedRandom, SliceRandom};
use rand::{Rng, RngCore, SeedableRng};
use rand_chacha::ChaCha20Rng;

const SEEDS: [u64; 6] = [0, 1, 42, 0xDEAD_BEEF, 0x0123_4567_89AB_CDEF, u64::MAX];

fn main() {
    for &seed in &SEEDS {
        // Raw words: 70 u32s cross the 64-word buffer boundary.
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let words: Vec<String> = (0..70).map(|_| rng.next_u32().to_string()).collect();
        println!("seed {seed} u32 {}", words.join(" "));

        // u64s starting at an odd word index, so one straddles the buffer boundary.
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        rng.next_u32();
        let longs: Vec<String> = (0..40).map(|_| rng.next_u64().to_string()).collect();
        println!("seed {seed} u64odd {}", longs.join(" "));

        // Shuffles of 0..n for several deck-like sizes, drawn one after another from one generator.
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        for n in [0usize, 1, 2, 3, 7, 13, 40, 60, 100, 250] {
            let mut v: Vec<usize> = (0..n).collect();
            v.shuffle(&mut rng);
            let s: Vec<String> = v.iter().map(|x| x.to_string()).collect();
            println!("seed {seed} shuffle{n} {}", s.join(" "));
        }

        // Integer ranges of the kinds the engine uses.
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let mut out = Vec::new();
        for n in [1usize, 2, 3, 6, 10, 20, 60, 1000, 1 << 20, (u32::MAX as usize) - 1] {
            for _ in 0..5 {
                out.push(rng.random_range(0..n).to_string());
            }
        }
        for _ in 0..5 {
            out.push(rng.random_range(1..=6u32).to_string());
            out.push(rng.random_range(-3..=3i32).to_string());
            out.push(rng.random_range(0..u64::MAX).to_string());
            out.push(rng.random_range(10u8..20).to_string());
        }
        println!("seed {seed} range {}", out.join(" "));

        // Booleans, including p = 0 and p = 1.
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let mut bools = Vec::new();
        for p in [0.0f64, 0.25, 0.5, 1.0 / 3.0, 0.9, 1.0] {
            for _ in 0..8 {
                bools.push(if rng.random_bool(p) { "1" } else { "0" });
            }
        }
        println!("seed {seed} bool {}", bools.join(" "));

        // choose from slices of several lengths.
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let mut picks = Vec::new();
        for n in [1usize, 2, 5, 17, 99] {
            let v: Vec<usize> = (0..n).collect();
            for _ in 0..4 {
                picks.push(v.choose(&mut rng).unwrap().to_string());
            }
        }
        println!("seed {seed} choose {}", picks.join(" "));
    }
}
