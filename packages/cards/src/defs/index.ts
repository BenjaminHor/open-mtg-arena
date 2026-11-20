// Every card definition, one per card in pool.txt. A test checks the two lists match exactly.

import type { CardDef } from "@mtg/engine";
import { assassinate } from "./a/assassinate.ts";
import { blindingMage } from "./b/blinding-mage.ts";
import { burningInquiry } from "./b/burning-inquiry.ts";
import { cancel } from "./c/cancel.ts";
import { celestialPurge } from "./c/celestial-purge.ts";
import { centaurCourser } from "./c/centaur-courser.ts";
import { coralMerfolk } from "./c/coral-merfolk.ts";
import { crawWurm } from "./c/craw-wurm.ts";
import { deathmark } from "./d/deathmark.ts";
import { disentomb } from "./d/disentomb.ts";
import { divination } from "./d/divination.ts";
import { divineVerdict } from "./d/divine-verdict.ts";
import { doomBlade } from "./d/doom-blade.ts";
import { eliteVanguard } from "./e/elite-vanguard.ts";
import { essenceScatter } from "./e/essence-scatter.ts";
import { excommunicate } from "./e/excommunicate.ts";
import { fireElemental } from "./f/fire-elemental.ts";
import { fireball } from "./f/fireball.ts";
import { flashfreeze } from "./f/flashfreeze.ts";
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
import { mindShatter } from "./m/mind-shatter.ts";
import { mindSpring } from "./m/mind-spring.ts";
import { mountain } from "./m/mountain.ts";
import { naturalize } from "./n/naturalize.ts";
import { naturesSpiral } from "./n/natures-spiral.ts";
import { negate } from "./n/negate.ts";
import { ornithopter } from "./o/ornithopter.ts";
import { plains } from "./p/plains.ts";
import { planarCleansing } from "./p/planar-cleansing.ts";
import { ragingGoblin } from "./r/raging-goblin.ts";
import { righteousness } from "./r/righteousness.ts";
import { rodOfRuin } from "./r/rod-of-ruin.ts";
import { royalAssassin } from "./r/royal-assassin.ts";
import { shatter } from "./s/shatter.ts";
import { shock } from "./s/shock.ts";
import { signInBlood } from "./s/sign-in-blood.ts";
import { solemnOffering } from "./s/solemn-offering.ts";
import { spinedWurm } from "./s/spined-wurm.ts";
import { swamp } from "./s/swamp.ts";
import { tempestOfLight } from "./t/tempest-of-light.ts";
import { tomeScour } from "./t/tome-scour.ts";
import { traumatize } from "./t/traumatize.ts";
import { undeadSlayer } from "./u/undead-slayer.ts";
import { unsummon } from "./u/unsummon.ts";
import { vampireAristocrat } from "./v/vampire-aristocrat.ts";
import { volcanicHammer } from "./v/volcanic-hammer.ts";

export const CARD_DEFS: readonly CardDef[] = [
  assassinate,
  blindingMage,
  burningInquiry,
  cancel,
  celestialPurge,
  centaurCourser,
  coralMerfolk,
  crawWurm,
  deathmark,
  disentomb,
  divination,
  divineVerdict,
  doomBlade,
  eliteVanguard,
  essenceScatter,
  excommunicate,
  fireElemental,
  fireball,
  flashfreeze,
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
  mindShatter,
  mindSpring,
  mountain,
  naturalize,
  naturesSpiral,
  negate,
  ornithopter,
  plains,
  planarCleansing,
  ragingGoblin,
  righteousness,
  rodOfRuin,
  royalAssassin,
  shatter,
  shock,
  signInBlood,
  solemnOffering,
  spinedWurm,
  swamp,
  tempestOfLight,
  tomeScour,
  traumatize,
  undeadSlayer,
  unsummon,
  vampireAristocrat,
  volcanicHammer,
];
