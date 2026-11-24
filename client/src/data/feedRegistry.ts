import type { FeedSource } from "../types/feed";
import { publicUrl } from "../config/publicUrl";

/**
 * The deck feeds the app ships with: static files under `public/feeds/`, so they work offline, subscribed at
 * start-up. The metagame lists are snapshots taken at import (D-177, the owner's call to keep them); nothing
 * refreshes them. The starter decks have no format of their own: they're casual decks, legal wherever their cards are.
 */
export const FEED_REGISTRY: FeedSource[] = [
  {
    id: "starter-decks",
    name: "Starter Decks",
    description: "Beginner-friendly mono and two-color decks",
    icon: "S",
    type: "bundled",
    url: publicUrl("feeds/starter-decks.json"),
  },
  {
    id: "mtggoldfish-standard",
    name: "Standard Meta",
    description: "Top Standard metagame decks",
    icon: "M",
    format: "standard",
    type: "bundled",
    url: publicUrl("feeds/mtggoldfish-standard.json"),
    attribution: { name: "MTGGoldfish", url: "https://www.mtggoldfish.com" },
  },
  {
    id: "mtggoldfish-modern",
    name: "Modern Meta",
    description: "Top Modern metagame decks",
    icon: "M",
    format: "modern",
    type: "bundled",
    url: publicUrl("feeds/mtggoldfish-modern.json"),
    attribution: { name: "MTGGoldfish", url: "https://www.mtggoldfish.com" },
  },
  {
    id: "mtggoldfish-pioneer",
    name: "Pioneer Meta",
    description: "Top Pioneer metagame decks",
    icon: "M",
    format: "pioneer",
    type: "bundled",
    url: publicUrl("feeds/mtggoldfish-pioneer.json"),
    attribution: { name: "MTGGoldfish", url: "https://www.mtggoldfish.com" },
  },
  {
    id: "mtggoldfish-commander",
    name: "Commander Meta",
    description: "Top Commander metagame decks",
    icon: "M",
    format: "commander",
    type: "bundled",
    url: publicUrl("feeds/mtggoldfish-commander.json"),
    attribution: { name: "MTGGoldfish", url: "https://www.mtggoldfish.com" },
  },
  {
    id: "topdeck-cedh",
    name: "cEDH Meta",
    description: "Top finishes from recent cEDH tournaments",
    icon: "T",
    format: "commander",
    type: "bundled",
    url: publicUrl("feeds/topdeck-cedh.json"),
    // TopDeck.gg Developer Terms §6.1: a visible credit linking to TopDeck.gg.
    attribution: { name: "TopDeck.gg", url: "https://topdeck.gg" },
  },
  {
    id: "mtggoldfish-legacy",
    name: "Legacy Meta",
    description: "Top Legacy metagame decks",
    icon: "M",
    format: "legacy",
    type: "bundled",
    url: publicUrl("feeds/mtggoldfish-legacy.json"),
    attribution: { name: "MTGGoldfish", url: "https://www.mtggoldfish.com" },
  },
  {
    id: "mtggoldfish-vintage",
    name: "Vintage Meta",
    description: "Top Vintage metagame decks",
    icon: "M",
    format: "vintage",
    type: "bundled",
    url: publicUrl("feeds/mtggoldfish-vintage.json"),
    attribution: { name: "MTGGoldfish", url: "https://www.mtggoldfish.com" },
  },
  {
    id: "mtggoldfish-pauper",
    name: "Pauper Meta",
    description: "Top Pauper metagame decks",
    icon: "M",
    format: "pauper",
    type: "bundled",
    url: publicUrl("feeds/mtggoldfish-pauper.json"),
    attribution: { name: "MTGGoldfish", url: "https://www.mtggoldfish.com" },
  },
];
