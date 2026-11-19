// `pnpm cards:fetch`: download Scryfall's Oracle Cards and Rulings bulk files into data/scryfall/.
// Run it again to refresh them (at least whenever rules/ is refreshed), then `pnpm cards:extract`.

import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BULK_FILES, type BulkType, HEADERS, MANIFEST_FILE, type Manifest, SCRYFALL_DIR } from "./scryfall.ts";

const BULK_INDEX = "https://api.scryfall.com/bulk-data";

type BulkEntry = { type: string; updated_at: string; jsonl_download_uri?: string };

async function main(): Promise<void> {
  const res = await fetch(BULK_INDEX, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${BULK_INDEX} failed: HTTP ${res.status}`);
  const index = (await res.json()) as { data: BulkEntry[] };

  await mkdir(SCRYFALL_DIR, { recursive: true });
  const types = Object.keys(BULK_FILES) as BulkType[];
  const manifest: Partial<Manifest> = {};
  const partials: string[] = [];
  try {
    // Download everything first, and only then replace the old files and the manifest, so a failed download
    // never leaves new files next to an old manifest.
    for (const type of types) {
      const entry = index.data.find((e) => e.type === type);
      if (!entry?.jsonl_download_uri) throw new Error(`The bulk-data index has no JSONL download for "${type}"`);
      const partial = path.join(SCRYFALL_DIR, `${BULK_FILES[type]}.partial`);
      partials.push(partial);
      console.log(`Downloading ${entry.jsonl_download_uri}`);
      await download(entry.jsonl_download_uri, partial);
      manifest[type] = { updatedAt: entry.updated_at, source: entry.jsonl_download_uri };
    }
    for (const type of types) {
      await rename(path.join(SCRYFALL_DIR, `${BULK_FILES[type]}.partial`), path.join(SCRYFALL_DIR, BULK_FILES[type]));
    }
    await writeFile(path.join(SCRYFALL_DIR, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    for (const partial of partials) await rm(partial, { force: true });
  }
  console.log(`Saved to ${SCRYFALL_DIR}. Now run: pnpm cards:extract`);
}

/** Download to a file and check it's still gzip-compressed. */
async function download(url: string, partial: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": HEADERS["User-Agent"] } });
  if (!res.ok || res.body === null) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
  // fetch() decompresses responses sent with Content-Encoding: gzip, so make sure we saved the .gz file itself.
  const handle = await open(partial);
  const { buffer } = await handle.read(Buffer.alloc(2), 0, 2, 0);
  await handle.close();
  if (buffer[0] !== 0x1f || buffer[1] !== 0x8b) throw new Error(`${url} wasn't saved as gzip data`);
}

await main();
