import { lazy, StrictMode, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route } from "react-router";

import { AppShell } from "./components/chrome/AppShell";
import { AppToast } from "./components/chrome/AppToast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { EngineLostModal } from "./components/modal/EngineLostModal";
import { NonFatalPanicToast } from "./components/modal/NonFatalPanicToast";
import { StuckDecisionToast } from "./components/modal/StuckDecisionToast";
import { SplashScreen } from "./components/splash/SplashScreen";
import { useFeedInitialization } from "./hooks/useFeedInitialization";
import { canonicalizeSavedDeckNames, migrateSavedDecks } from "./services/deckMigrations";
import { useDeckLibraryAutoSync } from "./services/visualPacks/deckLibraryAutoSync";
import { ensurePreload, subscribePreload } from "./startup/preloadAssets";
import { useCardDataStore } from "./stores/cardDataStore";
import { useEffectiveOffline } from "./stores/connectivityStore";
import { MenuPage } from "./pages/MenuPage";

const GamePage = lazy(() =>
  import("./pages/GamePage").then((m) => ({ default: m.GamePage })),
);
const GameSetupPage = lazy(() =>
  import("./pages/GameSetupPage").then((m) => ({ default: m.GameSetupPage })),
);
const DeckBuilderPage = lazy(() => import("./pages/DeckBuilderPage").then((m) => ({ default: m.DeckBuilderPage })));
const MyDecksPage = lazy(() => import("./pages/MyDecksPage").then((m) => ({ default: m.MyDecksPage })));
const CoveragePage = lazy(() => import("./pages/CoveragePage").then((m) => ({ default: m.CoveragePage })));
const DraftLandingPage = lazy(() => import("./pages/DraftLandingPage").then((m) => ({ default: m.DraftLandingPage })));
const DraftPage = lazy(() => import("./pages/DraftPage").then((m) => ({ default: m.DraftPage })));
const ReplayPage = lazy(() => import("./pages/ReplayPage").then((m) => ({ default: m.ReplayPage })));

function DevStrict({ children }: { children: ReactNode }) {
  if (!import.meta.env.DEV) return children;
  return <StrictMode>{children}</StrictMode>;
}


export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")} useTransitions={false}>
      <AppContent />
    </BrowserRouter>
  );
}

function AppContent() {
  const effectiveOffline = useEffectiveOffline();
  const feedInitializationReady = useFeedInitialization(effectiveOffline);

  // One-shot localStorage migrations: repair saved deck shapes once per load.
  useEffect(() => {
    migrateSavedDecks();
  }, []);

  const cardDataStatus = useCardDataStore((s) => s.status);
  useEffect(() => {
    if (cardDataStatus !== "ready") return;
    void canonicalizeSavedDeckNames().catch(() => {/* best-effort; saved names still resolve */});
  }, [cardDataStatus]);

  useDeckLibraryAutoSync(effectiveOffline, feedInitializationReady);

  const [showSplash, setShowSplash] = useState(true);
  const [progress, setProgress] = useState(0);
  const [loadLabel, setLoadLabel] = useState("Loading...");

  // Run startup preload for shell-safe assets only.
  useEffect(() => {
    if (!showSplash) return;

    const unsub = subscribePreload((p) => {
      setProgress(p.percent);
      if (p.phase === "audio") setLoadLabel("Loading audio...");
      else setLoadLabel("Ready");
    });
    ensurePreload();
    return unsub;
  }, [showSplash]);

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {showSplash && (
        <SplashScreen progress={progress} onComplete={handleSplashComplete} label={loadLabel} />
      )}
      <ErrorBoundary>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-500 border-t-white" /></div>}>
        <Routes>
          {/* Modern app shell (rail + tab bar + single scene) wraps every
              out-of-match surface; /game/:id stays full-screen outside it. */}
          <Route element={<AppShell />}>
            <Route path="/" element={<DevStrict><MenuPage /></DevStrict>} />
            <Route path="/setup" element={<DevStrict><GameSetupPage /></DevStrict>} />
            <Route path="/my-decks" element={<DevStrict><MyDecksPage /></DevStrict>} />
            <Route path="/deck-builder" element={<DevStrict><DeckBuilderPage /></DevStrict>} />
            <Route path="/coverage" element={<DevStrict><CoveragePage /></DevStrict>} />
            <Route path="/draft" element={<DevStrict><DraftLandingPage /></DevStrict>} />
            <Route path="/draft/quick" element={<DevStrict><DraftPage /></DevStrict>} />
          </Route>
          <Route path="/game/:id" element={<DevStrict><GamePage /></DevStrict>} />
          <Route path="/replay" element={<ReplayPage />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
      <AppToast />
      <EngineLostModal />
      <NonFatalPanicToast />
      <StuckDecisionToast />
    </div>
  );
}
