# @mtg/cli

The headless text interface for playing and debugging games. It's stateless: every command reads a game file,
does one thing and writes it back, so a script (or Claude Code) can drive a game one command at a time.

The full command list and output format are in [`docs/testing.md`](../../docs/testing.md), section 2.

## Entry points

- `src/main.ts`: the `pnpm cli` command. Today only `--help` and `--version` work. The game commands arrive in M1-17.
- `src/fuzz.ts`: the `pnpm fuzz` command. A stub that exits with an error until M1-18.

```sh
pnpm cli --help
```

Node runs the TypeScript source directly (type stripping), so there is no build step.

## Tests

`pnpm test` runs this package's tests along with the rest.
