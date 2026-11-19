// `pnpm cards:extract`: read the bulk files from `pnpm cards:fetch` and write the pool's Oracle data
// (data/pool.json) and rulings (data/rulings/<slug>.json). The output is sorted and stable, so running it twice
// changes nothing, and a diff after a refresh shows exactly what Scryfall changed (errata, new art, new rulings).

import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import {
  compareNames,
  GENERATED_NOTE,
  type PoolCard,
  type PoolFile,
  parsePoolTxt,
  type RulingsFile,
  slugify,
} from "../src/pool-data.ts";
import { choosePrinting, matchPoolCards } from "./match.ts";
import { BULK_FILES, CARDS_DIR, MANIFEST_FILE, type Manifest, SCRYFALL_DIR, type ScryfallCard } from "./scryfall.ts";

const DATA_DIR = path.join(CARDS_DIR, "data");
const RULINGS_DIR = path.join(DATA_DIR, "rulings");

type ScryfallRuling = { oracle_id: string; source: string; published_at: string; comment: string };

async function main(): Promise<void> {
  const entries = parsePoolTxt(await readFile(path.join(CARDS_DIR, "pool.txt"), "utf8"));
  const names = entries.map((e) => e.name);
  const manifest = await readManifest();

  // Keep only entries with a pool card's name while streaming (there are tens of thousands of cards), then match.
  const wanted = new Set(names);
  const candidates: ScryfallCard[] = [];
  for await (const card of readJsonLines<ScryfallCard>(BULK_FILES.oracle_cards)) {
    if (wanted.has(card.name)) candidates.push(card);
  }
  const oracleCards = matchPoolCards(names, candidates);

  // Every printing of the pool's cards, to choose which one's art to show (D-029).
  const printings = new Map<string, ScryfallCard[]>(oracleCards.map((c) => [c.oracle_id, []]));
  for await (const card of readJsonLines<ScryfallCard>(BULK_FILES.default_cards)) {
    printings.get(card.oracle_id)?.push(card);
  }
  const cards = entries.map((entry, i) => {
    const oracleCard = oracleCards[i] as ScryfallCard;
    const found = printings.get(oracleCard.oracle_id) ?? [];
    const { printing, chosenBy } = choosePrinting(
      entry,
      oracleCard,
      found,
      manifest.default_cards.updatedAt.slice(0, 10),
    );
    return toPoolCard(oracleCard, printing, chosenBy);
  });
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
      defaultCardsUpdatedAt: manifest.default_cards.updatedAt,
      rulingsUpdatedAt: manifest.rulings.updatedAt,
    },
    cards,
  };
  await writeJson(path.join(DATA_DIR, "pool.json"), pool);

  await mkdir(RULINGS_DIR, { recursive: true });
  // Remove rulings of cards that left the pool. Only .json files: anything else here was put there on purpose.
  for (const old of await readdir(RULINGS_DIR)) {
    if (old.endsWith(".json") && !slugs.has(old.slice(0, -".json".length))) await rm(path.join(RULINGS_DIR, old));
  }
  for (const card of cards) {
    const list = (rulings.get(card.oracleId) ?? []).sort(
      (a, b) => compareNames(a.publishedAt, b.publishedAt) || compareNames(a.comment, b.comment),
    );
    const file: RulingsFile = { generated: GENERATED_NOTE, name: card.name, oracleId: card.oracleId, rulings: list };
    await writeJson(path.join(RULINGS_DIR, `${card.slug}.json`), file);
  }
  console.log(`Wrote data/pool.json (${cards.length} cards) and their rulings.`);
}

async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(path.join(SCRYFALL_DIR, MANIFEST_FILE), "utf8")) as Manifest;
  } catch {
    throw new Error("No Scryfall bulk data found. Run `pnpm cards:fetch` first.");
  }
}

/** Rules data from the Oracle Cards entry; images, artist, set and collector number from the chosen printing. */
function toPoolCard(c: ScryfallCard, printing: ScryfallCard, chosenBy: PoolCard["printingChosenBy"]): PoolCard {
  // Split, flip, adventure, saga, meld and other layouts need rules the engine doesn't have yet (D-026).
  if (c.layout !== "normal") throw new Error(`"${c.name}": layout "${c.layout}" isn't supported yet`);
  const img = printing.image_uris;
  if (!img?.normal || !img.large || !img.png || !img.art_crop || !printing.artist) {
    throw new Error(`"${c.name}": the chosen printing has no images or artist on Scryfall`);
  }
  if (c.oracle_text === undefined) throw new Error(`"${c.name}" has no Oracle text on Scryfall`);
  return {
    name: c.name,
    slug: slugify(c.name),
    oracleId: c.oracle_id,
    layout: c.layout,
    manaCost: c.mana_cost ?? "",
    manaValue: c.cmc,
    typeLine: c.type_line,
    oracleText: c.oracle_text,
    power: c.power ?? null,
    toughness: c.toughness ?? null,
    colors: c.colors ?? [],
    colorIndicator: c.color_indicator ?? [],
    keywords: c.keywords,
    images: { normal: img.normal, large: img.large, png: img.png, artCrop: img.art_crop },
    artist: printing.artist,
    set: printing.set,
    collectorNumber: printing.collector_number,
    scryfallUri: printing.scryfall_uri,
    printingChosenBy: chosenBy,
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
