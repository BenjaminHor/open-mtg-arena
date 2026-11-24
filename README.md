# Open MTG Arena

A free, non-commercial fan project: Magic: The Gathering in the browser, in the spirit of MTG Arena. A rules engine
written in Rust and compiled to WebAssembly plays full matches against an AI opponent, entirely in your browser and
offline once loaded, with tens of thousands of cards parsed from their rules text. The next goals are an
LLM-powered opponent and a single-player RPG or roguelike.

Play it at https://benjaminhor.github.io/open-mtg-arena/ (installable as an app on phones and desktops).

## Layout

- `crates/`: the Rust workspace: the rules engine (`engine`), the card-text parser and its syntax tree, the AI, the
  LLM opponent, the WebAssembly bindings, drafting.
- `client/`: the React/TypeScript game client (Vite), running the engine in a web worker.
- `scripts/`: building the WebAssembly and generating card data from MTGJSON.
- `rules/`: the Comprehensive Rules, one file per section; `tools/rules/rule.mjs` looks rules up.
- `docs/`: the project's status, decisions and specs; `docs/engine/` documents the engine and client.

## Building

Needs the Rust toolchain pinned in `rust-toolchain.toml` (with the `wasm32-unknown-unknown` target), the
`wasm-bindgen-cli` version in `Cargo.lock`, Node and pnpm.

```bash
./scripts/build-wasm.sh release
./scripts/gen-card-data.sh
cd client && pnpm install --frozen-lockfile && pnpm dev
```

## Credits and license

The rules engine and client began as a copy of an MIT/Apache-2.0 open-source project; `NOTICE` credits it, and the
music, data and icons. This project is MIT or Apache-2.0 licensed
(`LICENSE-MIT`, `LICENSE-APACHE`).

Open MTG Arena is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not
approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the
Coast LLC. Card images are loaded from Scryfall at runtime and are not part of this repository.
