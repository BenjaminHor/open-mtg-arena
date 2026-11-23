// The committed pool data on its own, without the card definitions: what a screen needs to draw a card (its name, mana
// cost, type line, art links and artist), so the web app's main thread can import it without the engine-side defs.

import poolJson from "../data/pool.json" with { type: "json" };
import type { PoolFile } from "./pool-data.ts";

export const POOL: PoolFile = poolJson;
