// Every card definition, one per card in pool.txt. A test checks the two lists match exactly.

import type { CardDef } from "@mtg/engine";
import { centaurCourser } from "./c/centaur-courser.ts";
import { coralMerfolk } from "./c/coral-merfolk.ts";
import { crawWurm } from "./c/craw-wurm.ts";
import { eliteVanguard } from "./e/elite-vanguard.ts";
import { fireElemental } from "./f/fire-elemental.ts";
import { fireball } from "./f/fireball.ts";
import { forest } from "./f/forest.ts";
import { furnaceWhelp } from "./f/furnace-whelp.ts";
import { giantGrowth } from "./g/giant-growth.ts";
import { giantSpider } from "./g/giant-spider.ts";
import { grayOgre } from "./g/gray-ogre.ts";
import { grizzlyBears } from "./g/grizzly-bears.ts";
import { hillGiant } from "./h/hill-giant.ts";
import { igniteDisorder } from "./i/ignite-disorder.ts";
import { island } from "./i/island.ts";
import { lavaAxe } from "./l/lava-axe.ts";
import { lightningBolt } from "./l/lightning-bolt.ts";
import { llanowarElves } from "./l/llanowar-elves.ts";
import { mountain } from "./m/mountain.ts";
import { plains } from "./p/plains.ts";
import { ragingGoblin } from "./r/raging-goblin.ts";
import { righteousness } from "./r/righteousness.ts";
import { shock } from "./s/shock.ts";
import { spinedWurm } from "./s/spined-wurm.ts";
import { swamp } from "./s/swamp.ts";
import { volcanicHammer } from "./v/volcanic-hammer.ts";

export const CARD_DEFS: readonly CardDef[] = [
  centaurCourser,
  coralMerfolk,
  crawWurm,
  eliteVanguard,
  fireElemental,
  fireball,
  forest,
  furnaceWhelp,
  giantGrowth,
  giantSpider,
  grayOgre,
  grizzlyBears,
  hillGiant,
  igniteDisorder,
  island,
  lavaAxe,
  lightningBolt,
  llanowarElves,
  mountain,
  plains,
  ragingGoblin,
  righteousness,
  shock,
  spinedWurm,
  swamp,
  volcanicHammer,
];
