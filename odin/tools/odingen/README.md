# odingen

Generates the Odin engine's data model from the Rust engine's serde types (docs/odin-port.md, "O-1 data model
design"). Temporary tooling: it reads the Rust sources, so it goes when the Rust engine does (D-180).

```
cargo run --locked --release --manifest-path odin/tools/odingen/Cargo.toml -- gen crates odin/engine/types
```

writes `odin/engine/types/generated_{types,codecs,defaults,clone}.odin` for the default roots (`CardExportEntry`,
`GameState`, `GameAction`, `WaitingFor`, `GameEvent`, `ReplayLog`) and prints what it couldn't generate (hand-written
codecs, adapters and defaults live in `hand_codecs.odin`). CI (`.github/workflows/odin.yml`) regenerates and fails if
the committed files differ. `odingen report crates` lists the serde types it sees.
