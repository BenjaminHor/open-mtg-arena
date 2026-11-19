// `pnpm cards:extract`: read the bulk files from `pnpm cards:fetch` and write the pool's Oracle data
// (data/pool.json) and rulings (data/rulings/<slug>.json). The output is sorted and stable, so running it twice
// changes nothing, and a diff after a refresh shows exactly what Scryfall changed (errata, new art, new rulings).

import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { GENERATED_NOTE, type PoolCard, type PoolFile, type RulingsFile, slugify } from "../src/pool-data.ts";
import { BULK_FILES, CARDS_DIR, MANIFEST_FILE, type Manifest, SCRYFALL_DIR } from "./scryfall.ts";

const DATA_DIR = path.join(CARDS_DIR, "data");
const RULINGS_DIR = path.join(DATA_DIR, "rulings");

// Oracle Cards also has entries that aren't Magic cards you can put in a deck. Some share a name with a real card
// (Llanowar Elves has a token), so they're left out before matching names.
const NOT_CARDS = new Set(["token", "double_faced_token", "emblem", "art_series", "vanguard", "planar", "scheme"]);

type ScryfallCard = {
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
  keywords: string[];
  image_uris?: Record<string, string>;
  artist?: string;
  set: string;
  collector_number: string;
  scryfall_uri: string;
};

type ScryfallRuling = { oracle_id: string; source: string; published_at: string; comment: string };

async function main(): Promise<void> {
  const names = await readPoolNames();
  const manifest = JSON.parse(await readFile(path.join(SCRYFALL_DIR, MANIFEST_FILE), "utf8")) as Manifest;

  const matches = new Map<string, ScryfallCard[]>(names.map((n) => [n, []]));
  for await (const card of readJsonLines<ScryfallCard>(BULK_FILES.oracle_cards)) {
    if (!NOT_CARDS.has(card.layout)) matches.get(card.name)?.push(card);
  }
  const problems = [...matches].filter(([, found]) => found.length !== 1);
  if (problems.length > 0) {
    for (const [name, found] of problems) {
      console.error(
        `"${name}": ${found.length} matches${found.map((c) => `\n  ${c.layout} ${c.set} ${c.oracle_id}`).join("")}`,
      );
    }
    throw new Error("Every pool.txt name must match exactly one card in Oracle Cards.");
  }
  const cards = names.map((name) => toPoolCard((matches.get(name) ?? [])[0] as ScryfallCard));
  const slugs = new Set(cards.map((c) => c.slug));
  if (slugs.size !== cards.length) throw new Error("Two pool cards have the same slug.");

  const rulings = new Map<string, RulingsFile["rulings"]>(cards.map((c) => [c.oracleId, []]));
  for await (const r of readJsonLines<ScryfallRuling>(BULK_FILES.rulings)) {
    rulings.get(r.oracle_id)?.push({ source: r.source, publishedAt: r.published_at, comment: r.comment });
  }

  const pool: PoolFile = {
    generated: GENERATED_NOTE,
    scryfall: {
      oracleCardsUpdatedAt: manifest.oracle_cards.updatedAt,
      rulingsUpdatedAt: manifest.rulings.updatedAt,
    },
    cards,
  };
  await writeJson(path.join(DATA_DIR, "pool.json"), pool);

  await mkdir(RULINGS_DIR, { recursive: true });
  for (const old of await readdir(RULINGS_DIR)) {
    if (!slugs.has(old.replace(/\.json$/, ""))) await rm(path.join(RULINGS_DIR, old));
  }
  for (const card of cards) {
    const list = (rulings.get(card.oracleId) ?? []).sort(
      (a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.comment.localeCompare(b.comment),
    );
    const file: RulingsFile = { generated: GENERATED_NOTE, name: card.name, oracleId: card.oracleId, rulings: list };
    await writeJson(path.join(RULINGS_DIR, `${card.slug}.json`), file);
  }
  console.log(`Wrote data/pool.json (${cards.length} cards) and their rulings.`);
}

async function readPoolNames(): Promise<string[]> {
  const text = await readFile(path.join(CARDS_DIR, "pool.txt"), "utf8");
  const names = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (new Set(names).size !== names.length) throw new Error("pool.txt lists a card twice.");
  return names.sort((a, b) => a.localeCompare(b));
}

function toPoolCard(c: ScryfallCard): PoolCard {
  const img = c.image_uris;
  if (!img?.normal || !img.large || !img.png || !img.art_crop || !c.artist) {
    throw new Error(`"${c.name}" has no single-faced images or artist. Multi-faced cards aren't supported yet.`);
  }
  return {
    name: c.name,
    slug: slugify(c.name),
    oracleId: c.oracle_id,
    layout: c.layout,
    manaCost: c.mana_cost ?? "",
    manaValue: c.cmc,
    typeLine: c.type_line,
    oracleText: c.oracle_text ?? "",
    power: c.power ?? null,
    toughness: c.toughness ?? null,
    colors: c.colors ?? [],
    keywords: c.keywords,
    images: { normal: img.normal, large: img.large, png: img.png, artCrop: img.art_crop },
    artist: c.artist,
    set: c.set,
    collectorNumber: c.collector_number,
    scryfallUri: c.scryfall_uri,
  };
}

async function* readJsonLines<T>(file: string): AsyncGenerator<T> {
  const input = createReadStream(path.join(SCRYFALL_DIR, file)).pipe(createGunzip());
  for await (const line of createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })) {
    if (line.trim() !== "") yield JSON.parse(line) as T;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

await main();
