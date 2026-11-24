import { useEffect, useState } from "react";

import type { GameFormat, MatchType } from "../adapter/types";
import { bestOfThreeCeilingForFormat } from "../services/engineRuntime";

/**
 * The most games a match in `format` may be (the engine's answer), or `null`
 * while it is being asked or when no format is chosen. A failed query answers
 * Bo1, the safe ceiling.
 */
export function useBestOfThreeCeiling(format: GameFormat | null): MatchType | null {
  const [answer, setAnswer] = useState<{ format: GameFormat; ceiling: MatchType } | null>(null);
  useEffect(() => {
    if (format === null) return;
    let cancelled = false;
    void (async () => {
      let ceiling: MatchType;
      try {
        ceiling = await bestOfThreeCeilingForFormat(format);
      } catch {
        ceiling = "Bo1";
      }
      if (!cancelled) setAnswer({ format, ceiling });
    })();
    return () => {
      cancelled = true;
    };
  }, [format]);
  return format !== null && answer?.format === format ? answer.ceiling : null;
}

/** Bo3 is the one value the engine's answer admits; anything else plays Bo1. */
export function cappedMatchType(selected: MatchType, ceiling: MatchType | null): MatchType {
  return ceiling === "Bo3" ? selected : "Bo1";
}
