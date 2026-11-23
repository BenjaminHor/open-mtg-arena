import { useId } from "react";
import { useTranslation } from "react-i18next";

import { runtimeConfigValue } from "../../config/runtimeConfig";
import { isOpenableExternalUrl, openExternal } from "../../services/openExternal";
import { GameplayTooltip } from "../ui/GameplayTooltip";

function BoltIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-current">
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
    </svg>
  );
}

/**
 * Release builds expose the "Try Preview" badge for the bleeding-edge preview
 * deploy, or the site a web release build's `/config.js` names in
 * `previewSiteUrl`. It sits top-right, just below the shell's ChromeControls
 * cluster (Volume/Language/Settings — `h-9` buttons at `top:1rem`, so their
 * bottom edge is ~52px; this clears it with an ~8px gap). The badge remains
 * hidden in dev and ordinary preview web builds — see `__IS_RELEASE_BUILD__`
 * in vite.config.ts.
 *
 * Mounted by the main menu (MenuPage) so release users discover the preview
 * site from the landing screen.
 */
export function PreviewBadge() {
  const { t } = useTranslation("menu");
  const tooltipId = useId();

  if (!__IS_RELEASE_BUILD__) return null;

  // A self-hosted site points its badge at its own preview through /config.js.
  const previewSiteUrl =
    runtimeConfigValue("previewSiteUrl", isOpenableExternalUrl) ?? __PREVIEW_SITE_URL__;

  return (
    <div className="fixed right-3 top-[calc(env(safe-area-inset-top)+3.75rem)] z-30 flex max-w-[calc(100vw-1.5rem)] justify-end sm:right-4">
      <a
        href={previewSiteUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          openExternal(previewSiteUrl);
        }}
        aria-describedby={tooltipId}
        className="group relative flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-200 shadow-[0_0_16px_-2px_rgba(245,158,11,0.45)] backdrop-blur-sm transition-all hover:border-amber-300/70 hover:bg-amber-500/20 hover:text-amber-100 hover:shadow-[0_0_22px_0_rgba(245,158,11,0.65)] sm:gap-1.5 sm:px-3.5 sm:py-1.5 sm:text-xs"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 animate-ping rounded-full bg-amber-400/20 [animation-duration:2.4s]"
        />
        <BoltIcon />
        <span>{t("home.preview.cta")}</span>
        <span className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
        {/* Below the badge, not above — the default bottom-full placement would
            cover the chrome cluster overhead. */}
        <GameplayTooltip id={tooltipId} className="top-full bottom-auto! mt-2 mb-0!">
          {t("home.preview.tooltip")}
        </GameplayTooltip>
      </a>
    </div>
  );
}
