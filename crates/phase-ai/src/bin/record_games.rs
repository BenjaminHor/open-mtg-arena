//! Records seeded AI-vs-AI games as language-neutral JSON, the reference the Odin port must reproduce
//! (docs/odin-port.md, O-1: the recorder). Temporary tooling: it goes with the Rust engine (D-180).
//!
//! `record-games <card-data.json> <out-dir> <matchup> <seed> [games] [max-steps]` plays `games` games of the
//! ai-duel matchup from `seed`, `seed + 1`, ... (measurement-mode AI, so a seed always replays the same game) and
//! writes `<out-dir>/<matchup>-<seed>.jsonl`:
//!   line 1: {"matchup", "seed", "initial_state"} (after start_game: decks loaded, the d20 contest settled)
//!   then one line per action: {"step", "actor", "action", "state"} with the full game state after it.
//! Full states are large; that is the point for now (every field is compared). A compact checkpoint form comes
//! with the replay harness (O-2).

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;

use engine::database::CardDatabase;
use engine::game::deck_loading::load_and_hydrate_decks;
use engine::types::game_state::{GameState, WaitingFor};
use engine::types::player::PlayerId;
use phase_ai::auto_play::{eligible_ai_decision, run_ai_actions_headless};
use phase_ai::config::{create_config_for_players, AiDifficulty, Platform};
use phase_ai::duel_suite::find_matchup;
use phase_ai::duel_suite::run::resolve_matchup;
use rand::rngs::StdRng;
use rand::SeedableRng;
use serde::Serialize;

// Lines are written straight from the typed values, never through serde_json::Value: a Value's map keeps one
// member per key, and serde writes some keys twice (an internally tagged enum holding another with the same tag,
// TargetEffectDetail::Modification(PtDirection) is {"type": "Modification", "type": "Increase"}).
#[derive(Serialize)]
struct Header<'a> {
    matchup: &'a str,
    seed: u64,
    initial_state: &'a GameState,
}

#[derive(Serialize)]
struct Step<'a, A: Serialize> {
    step: usize,
    actor: Option<u8>,
    action: &'a A,
    state: &'a GameState,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 5 {
        eprintln!("usage: record-games <card-data.json> <out-dir> <matchup> <seed> [games] [max-steps]");
        std::process::exit(2);
    }
    let db = CardDatabase::from_export(&PathBuf::from(&args[1])).expect("card data loads");
    let out_dir = PathBuf::from(&args[2]);
    std::fs::create_dir_all(&out_dir).expect("output directory");
    let matchup = &args[3];
    let base_seed: u64 = args[4].parse().expect("seed");
    let games: u64 = args.get(5).map(|s| s.parse().expect("games")).unwrap_or(1);
    let max_steps: usize = args.get(6).map(|s| s.parse().expect("max-steps")).unwrap_or(5_000);

    let spec = find_matchup(matchup).unwrap_or_else(|| panic!("unknown matchup {matchup}"));
    let (payload, _, _) = resolve_matchup(&db, spec).expect("matchup resolves");

    for g in 0..games {
        let seed = base_seed + g;
        let path = out_dir.join(format!("{matchup}-{seed}.jsonl"));
        let mut out = std::io::BufWriter::new(std::fs::File::create(&path).expect("output file"));

        // As ai-duel's run_game: a two-player game, decks hydrated, then start_game (CR 103).
        let mut state = GameState::new_two_player(seed);
        load_and_hydrate_decks(&mut state, &payload, Some(&db));
        engine::game::engine::start_game(&mut state);
        serde_json::to_writer(&mut out, &Header { matchup, seed, initial_state: &state }).unwrap();
        writeln!(out).unwrap();

        let ai_players: HashSet<PlayerId> = [PlayerId(0), PlayerId(1)].into_iter().collect();
        let config = create_config_for_players(AiDifficulty::Medium, Platform::Native, 2).into_measurement(seed);
        let ai_configs: HashMap<PlayerId, _> =
            [(PlayerId(0), config.clone()), (PlayerId(1), config)].into_iter().collect();
        let mut ai_rng = StdRng::seed_from_u64(seed);
        let session = phase_ai::session::AiSession::arc_from_game(&state);

        let mut step = 0usize;
        while step < max_steps {
            let before = state.clone();
            let run = run_ai_actions_headless(&mut state, &ai_players, &ai_configs, &mut ai_rng, &session);
            if run.results.is_empty() {
                break;
            }
            // Each result's actor is whoever the state before it was waiting on.
            let mut prev = before;
            for result in &run.results {
                let actor = eligible_ai_decision(&prev, &ai_players).map(|(submitter, _)| submitter.0);
                let line = Step { step, actor, action: &result.action, state: &result.state };
                serde_json::to_writer(&mut out, &line).unwrap();
                writeln!(out).unwrap();
                prev = result.state.clone();
                step += 1;
            }
            if matches!(state.waiting_for, WaitingFor::GameOver { .. }) {
                break;
            }
        }
        out.flush().unwrap();
        eprintln!("{}: {step} steps, turn {}, {:?}", path.display(), state.turn_number, state.waiting_for);
    }
}
