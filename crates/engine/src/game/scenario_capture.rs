//! Test capture for the Odin engine (D-187): with `ENGINE_CAPTURE_DIR` set, every action a scenario test applies
//! through [`apply_as_current`] is appended, as one JSON line, to `<dir>/<test name>.jsonl`:
//! `{"pre": state | null, "action": .., "ok": bool, "result": .., "error": .., "post": state}`.
//! `pre` is null when it equals the previous line's `post` (the test didn't touch the state between actions), so a
//! file replays from its first `pre` but each line can still be checked on its own. With the variable unset this
//! only delegates: the Rust tests run exactly as before.

use std::cell::RefCell;
use std::io::Write;

use crate::game::engine::EngineError;
use crate::types::actions::GameAction;
use crate::types::game_state::{ActionResult, GameState};

thread_local! {
    /// The last `post` state this test thread wrote, to leave out an unchanged `pre`.
    static LAST_POST: RefCell<Option<String>> = const { RefCell::new(None) };
}

fn capture_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("ENGINE_CAPTURE_DIR").map(std::path::PathBuf::from)
}

/// The test running on this thread (libtest names each test's thread after it), as a file name.
fn test_file_name() -> String {
    let name = std::thread::current()
        .name()
        .unwrap_or("unnamed")
        .to_string();
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '.'
            }
        })
        .collect()
}

/// `engine::apply_as_current`, recording the step when capture is on.
pub fn apply_as_current(
    state: &mut GameState,
    action: GameAction,
) -> Result<ActionResult, EngineError> {
    let Some(dir) = capture_dir() else {
        return crate::game::engine::apply_as_current(state, action);
    };
    let pre = serde_json::to_string(state).unwrap_or_default();
    let action_json = serde_json::to_string(&action).unwrap_or_default();
    let result = crate::game::engine::apply_as_current(state, action);
    let post = serde_json::to_string(state).unwrap_or_default();
    let pre_field = LAST_POST.with(|l| {
        if l.borrow().as_deref() == Some(pre.as_str()) {
            "null".to_string()
        } else {
            pre
        }
    });
    let (ok, result_json, error_json) = match &result {
        Ok(r) => (
            true,
            serde_json::to_string(r).unwrap_or_else(|_| "null".into()),
            "null".to_string(),
        ),
        Err(e) => (
            false,
            "null".to_string(),
            serde_json::to_string(&format!("{e:?}")).unwrap_or_default(),
        ),
    };
    let line = format!(
        "{{\"pre\":{pre_field},\"action\":{action_json},\"ok\":{ok},\"result\":{result_json},\"error\":{error_json},\"post\":{post}}}\n"
    );
    LAST_POST.with(|l| *l.borrow_mut() = Some(post));
    if std::fs::create_dir_all(&dir).is_ok() {
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(format!("{}.jsonl", test_file_name())))
        {
            let _ = f.write_all(line.as_bytes());
        }
    }
    result
}
