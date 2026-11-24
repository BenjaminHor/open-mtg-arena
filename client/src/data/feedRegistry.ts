import type { FeedSource } from "../types/feed";
import { publicUrl } from "../config/publicUrl";

/** The deck feeds the app ships with. Each is a static file under
 *  `public/feeds/`, so it works offline; the app subscribes to every one at
 *  start-up. */
export const FEED_REGISTRY: FeedSource[] = [
  {
    id: "starter-decks",
    name: "Starter Decks",
    description: "Beginner-friendly mono and two-color decks",
    icon: "S",
    format: "standard",
    type: "bundled",
    url: publicUrl("feeds/starter-decks.json"),
  },
];
