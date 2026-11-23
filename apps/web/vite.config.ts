// Vite builds the web app (M3-03). Workspace packages are bundled from their TypeScript sources (D-018), the match
// worker as an ES module, and `serviceWorker` writes `sw.js` with the list of every file the build wrote.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

export default defineConfig({
  plugins: [react(), serviceWorker()],
  worker: { format: "es" },
  // PixiJS and React come to about 500 kB; the app is loaded once and then works offline, so one chunk is fine.
  build: { chunkSizeWarningLimit: 800 },
});

/** After the build, writes `dist/sw.js` from `service-worker/sw.js`, with this build's files and a cache name. */
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "open-mtg-arena-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files = listFiles(outDir).map((f) => `/${relative(outDir, f).split("\\").join("/")}`);
      const urls = ["/", ...files.filter((f) => f !== "/sw.js")];
      const name = `open-mtg-arena-${createHash("sha256").update(urls.join("\n")).digest("hex").slice(0, 12)}`;
      const template = readFileSync(new URL("./service-worker/sw.js", import.meta.url), "utf8");
      const source = template
        .replace('"__CACHE_NAME__"', JSON.stringify(name))
        .replace("__PRECACHE__", JSON.stringify(urls));
      writeFileSync(join(outDir, "sw.js"), source);
    },
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
