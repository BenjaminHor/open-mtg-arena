import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import initEngine, { clear_game_state, get_game_state, initialize_game } from "@wasm/engine";
import type { FormatConfig, GameFormat } from "../types";
import { formatMetadata } from "../../data/formatRegistry";

const currentConfig = (format: GameFormat): FormatConfig => formatMetadata(format)!.default_config;

/** A config an engine before CR 903.12h's exclusion wrote: Brawl carried CR 704.6c's 21. */
const legacyConfig = (format: GameFormat) => ({ ...currentConfig(format), commander_damage_threshold: 21 });

beforeAll(async () => {
  const bytes = await readFile(resolve(__dirname, "../../wasm/engine_wasm_bg.wasm"));
  await initEngine({ module_or_path: await WebAssembly.compile(bytes) });
});

afterEach(() => {
  clear_game_state();
});

describe("legacy FormatConfig through the public WASM exports", () => {
  it.each(["Brawl", "HistoricBrawl"] as const)(
    "initialize_game installs a pre-change %s config under CR 903.12h",
    (format) => {
      const result = initialize_game(null, 42, legacyConfig(format), null, 2, 0) as { error?: boolean; reasons?: string[] };
      expect(result.error, result.reasons?.join("; ")).toBeUndefined();
      const installed = (get_game_state() as { state: { format_config: FormatConfig } } | null)?.state.format_config;
      expect(installed?.format).toBe(format);
      expect(installed?.commander_damage_threshold).toBeNull();
    },
  );

  it("initialize_game keeps a Commander config's threshold", () => {
    const result = initialize_game(null, 42, currentConfig("Commander"), null, 2, 0) as { error?: boolean };
    expect(result.error).toBeUndefined();
    const installed = (get_game_state() as { state: { format_config: FormatConfig } } | null)?.state.format_config;
    expect(installed?.commander_damage_threshold).toBe(21);
  });
});
