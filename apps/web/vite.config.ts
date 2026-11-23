// Vite builds the web app (M3-03). Workspace packages are bundled from their TypeScript sources (D-018), the match
// worker as an ES module, and `serviceWorker` writes `sw.js` with the list of every file the build wrote.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

export default defineConfig({
  // Where the app is served from: "/" locally and in the tests, "/open-mtg-arena/" on GitHub Pages (D-159).
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), serviceWorker()],
  worker: { format: "es" },
  // PixiJS and React come to about 500 kB; the app is loaded once and then works offline, so one chunk is fine.
  build: { chunkSizeWarningLimit: 800 },
});

/**
 * After the build, writes `sw.js` from `service-worker/sw.js`, with this build's files and a cache name that changes
 * whenever any file's name or contents do (so a changed `index.html` or icon is picked up too).
 */
function serviceWorker(): Plugin {
  let outDir = "dist";
  let base = "/";
  return {
    name: "open-mtg-arena-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      base = config.base;
    },
    closeBundle() {
      // The base ("/", or "/open-mtg-arena/" on Pages) stands for index.html: every page is the app's one page (the
      // service worker's offline fallback).
      const files = listFiles(outDir).filter((f) => !f.endsWith("sw.js") && !f.endsWith("index.html"));
      const urls = [base, ...files.map((f) => `${base}${relative(outDir, f).split("\\").join("/")}`)];
      const hash = createHash("sha256");
      for (const file of [join(outDir, "index.html"), ...files]) hash.update(file).update(readFileSync(file));
      const name = `open-mtg-arena-app-${hash.digest("hex").slice(0, 12)}`;
      const template = readFileSync(new URL("./service-worker/sw.js", import.meta.url), "utf8");
      writeFileSync(
        join(outDir, "sw.js"),
        fill(fill(template, '"__CACHE_NAME__"', JSON.stringify(name)), "__PRECACHE__", JSON.stringify(urls)),
      );
    },
  };
}

/** The template with its one placeholder filled; a template without it is a mistake worth stopping the build for. */
function fill(template: string, placeholder: string, value: string): string {
  if (!template.includes(placeholder)) throw new Error(`service-worker/sw.js has no ${placeholder}`);
  return template.replace(placeholder, () => value);
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
