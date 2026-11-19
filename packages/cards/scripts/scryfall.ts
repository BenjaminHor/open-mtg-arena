// Shared by the card data scripts: where Scryfall's bulk files live and how we talk to Scryfall.
// See docs/data-sources.md for Scryfall's terms (bulk files, not per-card API calls; identify ourselves).

import path from "node:path";
import { fileURLToPath } from "node:url";

export const CARDS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Large downloads, gitignored. */
export const SCRYFALL_DIR = path.join(CARDS_DIR, "data", "scryfall");

export const BULK_FILES = {
  oracle_cards: "oracle-cards.jsonl.gz",
  rulings: "rulings.jsonl.gz",
} as const;

export type BulkType = keyof typeof BULK_FILES;

/** Written next to the downloads: which bulk files we have and when Scryfall last updated them. */
export const MANIFEST_FILE = "manifest.json";
export type Manifest = Record<BulkType, { updatedAt: string; source: string }>;

// Scryfall asks API clients to send a descriptive User-Agent and an Accept header.
/** The fields of a Scryfall card object that we read (https://scryfall.com/docs/api/cards). */
export type ScryfallCard = {
  name: string;
  oracle_id: string;
  layout: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  color_indicator?: string[];
  keywords: string[];
  image_uris?: Record<string, string>;
  artist?: string;
  set: string;
  collector_number: string;
  scryfall_uri: string;
};

export const HEADERS = {
  "User-Agent": "mtg-engine-card-data/0.1 (non-commercial fan project)",
  Accept: "application/json",
};
