//! Times the Rust engine's `GameState` clone, the baseline the Odin state layout must meet (docs/odin-port.md, "State
//! layout"). Temporary tooling for the port (D-180).
//!
//! `clone-bench <game.jsonl> [every-nth-state]` reads states from a record-games recording and, for each, times:
//! - clone + drop (what a discarded simulation costs);
//! - clone, then write one object through `ObjectMap::get_mut` (copy-on-write of one `Arc<GameObject>`), then drop;
//! - looking up every object by id.
//!
//! Prints nanoseconds per operation, averaged over the states read.

use std::hint::black_box;
use std::io::BufRead;
use std::time::Instant;

use engine::types::game_state::GameState;

const REPS: u32 = 200;

/// A recording line's state, read straight from the text: never through serde_json::Value, which keeps one member
/// per key and so loses the repeated "type" key some states have (docs/status.md, Known issues).
#[derive(serde::Deserialize)]
struct Line {
    state: Option<GameState>,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: clone-bench <game.jsonl> [every-nth-state]");
        std::process::exit(2);
    }
    let every: usize = args.get(2).map(|s| s.parse().expect("every-nth-state")).unwrap_or(25);
    println!(
        "size_of: GameState {}, GameObject {}, ResolvedCommandJournalEntry {}, ZoneChangeRecord {}",
        std::mem::size_of::<GameState>(),
        std::mem::size_of::<engine::game::game_object::GameObject>(),
        std::mem::size_of::<engine::types::resolved_commands::ResolvedCommandJournalEntry>(),
        std::mem::size_of::<engine::types::game_state::ZoneChangeRecord>(),
    );
    let file = std::io::BufReader::new(std::fs::File::open(&args[1]).expect("recording"));

    let (mut states, mut clone_ns, mut write_ns, mut lookup_ns, mut objects) = (0u64, 0f64, 0f64, 0f64, 0u64);
    for (i, line) in file.lines().enumerate() {
        if i == 0 || i % every != 0 {
            continue;
        }
        let line = line.expect("line");
        let Some(state) = serde_json::from_str::<Line>(&line).expect("state decodes").state else {
            continue;
        };
        let ids: Vec<_> = state.objects.keys().copied().collect();
        if ids.is_empty() {
            continue;
        }

        let t = Instant::now();
        for _ in 0..REPS {
            drop(black_box(state.clone()));
        }
        clone_ns += t.elapsed().as_nanos() as f64 / f64::from(REPS);

        let t = Instant::now();
        for r in 0..REPS {
            let mut sim = state.clone();
            if let Some(object) = sim.objects.get_mut(&ids[r as usize % ids.len()]) {
                object.tapped = !object.tapped;
            }
            drop(black_box(sim));
        }
        write_ns += t.elapsed().as_nanos() as f64 / f64::from(REPS);

        let t = Instant::now();
        for _ in 0..REPS {
            for id in &ids {
                black_box(state.objects.get(id));
            }
        }
        lookup_ns += t.elapsed().as_nanos() as f64 / f64::from(REPS) / ids.len() as f64;

        states += 1;
        objects += ids.len() as u64;
    }
    let n = states.max(1) as f64;
    println!(
        "{states} states (avg {} objects): clone+drop {:.0} ns, clone+write one object+drop {:.0} ns, lookup {:.1} ns",
        objects / states.max(1),
        clone_ns / n,
        write_ns / n,
        lookup_ns / n
    );
}
