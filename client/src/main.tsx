import "./polyfills/cryptoRandomUUID";
import { createRoot } from "react-dom/client";
// Self-hosted variable webfonts (served from node_modules by Vite — no Google
// CDN). Newsreader = serif display; JetBrains Mono = codes / tabular numbers.
import "@fontsource-variable/newsreader";
import "@fontsource-variable/jetbrains-mono";
// Mana/loyalty/counter iconography (Andrew Gioia's mana-font). The vendored
// mana.css ships legacy eot/woff/ttf/svg faces for "Mana" plus an unused
// "MPlantin" serif; the `trimManaFont` Vite plugin rewrites this import at build
// time to a single woff2-only "Mana" @font-face (see vite.config.ts) so only one
// 187 KB font is bundled.
import "mana-font/css/mana.css";
import "./index.css";
import "./i18n"; // initialize i18next before any component renders
import { App } from "./App";
import { installHiddenDocumentMotion } from "./animation/hiddenDocumentMotion";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import { installChunkReloadHandler } from "./pwa/chunkReloadHandler";
import { initializeConnectivity } from "./stores/connectivityStore";

export async function bootstrap(): Promise<void> {
  // Before anything renders: a tab opened in the background must not start
  // CSS animations it can never finish (see animation/hiddenDocumentMotion).
  installHiddenDocumentMotion();

  // Connectivity persistence hydrates before any React effect or background
  // registration can own a network path.
  await initializeConnectivity();

  // StrictMode is scoped inside App.tsx (dev only) instead of wrapping the root.
  createRoot(document.getElementById("root")!).render(<App />);

  registerServiceWorker();
  installChunkReloadHandler();
}

void bootstrap();
