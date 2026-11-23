// The web app's entry: React draws the app (D-013), and the production build registers the service worker so the app
// works offline after its first load (M3-03). Development doesn't, so `pnpm dev` never serves a stale module.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import "./app/app.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}
