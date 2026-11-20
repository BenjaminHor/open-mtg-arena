// Every card definition, one per card in pool.txt. A test checks the two lists match exactly.

import type { CardDef } from "@mtg/engine";
import { acolyteOfXathrid } from "./a/acolyte-of-xathrid.ts";
import { angelsMercy } from "./a/angels-mercy.ts";
import { assassinate } from "./a/assassinate.ts";
import { blindingMage } from "./b/blinding-mage.ts";
import { bountifulHarvest } from "./b/bountiful-harvest.ts";
import { burningInquiry } from "./b/burning-inquiry.ts";
import { cancel } from "./c/cancel.ts";
import { celestialPurge } from "./c/celestial-purge.ts";
import { centaurCourser } from "./c/centaur-courser.ts";
import { consumeSpirit } from "./c/consume-spirit.ts";
import { coralMerfolk } from "./c/coral-merfolk.ts";
import { crawWurm } from "./c/craw-wurm.ts";
import { deathmark } from "./d/deathmark.ts";
import { diabolicTutor } from "./d/diabolic-tutor.ts";
import { disentomb } from "./d/disentomb.ts";
import { divination } from "./d/divination.ts";
import { divineVerdict } from "./d/divine-verdict.ts";
import { doomBlade } from "./d/doom-blade.ts";
import { duress } from "./d/duress.ts";
import { earthquake } from "./e/earthquake.ts";
import { eliteVanguard } from "./e/elite-vanguard.ts";
import { elvishPiper } from "./e/elvish-piper.ts";
import { essenceScatter } from "./e/essence-scatter.ts";
import { excommunicate } from "./e/excommunicate.ts";
import { fabricate } from "./f/fabricate.ts";
import { fireElemental } from "./f/fire-elemental.ts";
import { fireball } from "./f/fireball.ts";
import { flashfreeze } from "./f/flashfreeze.ts";
import { forest } from "./f/forest.ts";
import { furnaceWhelp } from "./f/furnace-whelp.ts";
import { giantGrowth } from "./g/giant-growth.ts";
import { giantSpider } from "./g/giant-spider.ts";
import { goblinArtillery } from "./g/goblin-artillery.ts";
import { grayOgre } from "./g/gray-ogre.ts";
import { grizzlyBears } from "./g/grizzly-bears.ts";
import { hauntingEchoes } from "./h/haunting-echoes.ts";
import { hillGiant } from "./h/hill-giant.ts";
import { igniteDisorder } from "./i/ignite-disorder.ts";
import { island } from "./i/island.ts";
import { lavaAxe } from "./l/lava-axe.ts";
import { lightningBolt } from "./l/lightning-bolt.ts";
import { llanowarElves } from "./l/llanowar-elves.ts";
import { merfolkLooter } from "./m/merfolk-looter.ts";
import { mindRot } from "./m/mind-rot.ts";
import { mindShatter } from "./m/mind-shatter.ts";
import { mindSpring } from "./m/mind-spring.ts";
import { mountain } from "./m/mountain.ts";
import { naturalize } from "./n/naturalize.ts";
import { naturesSpiral } from "./n/natures-spiral.ts";
import { negate } from "./n/negate.ts";
import { ornithopter } from "./o/ornithopter.ts";
import { plains } from "./p/plains.ts";
import { planarCleansing } from "./p/planar-cleansing.ts";
import { ponder } from "./p/ponder.ts";
import { pyroclasm } from "./p/pyroclasm.ts";
import { ragingGoblin } from "./r/raging-goblin.ts";
import { rampantGrowth } from "./r/rampant-growth.ts";
import { righteousness } from "./r/righteousness.ts";
import { rodOfRuin } from "./r/rod-of-ruin.ts";
import { royalAssassin } from "./r/royal-assassin.ts";
import { seismicStrike } from "./s/seismic-strike.ts";
import { shatter } from "./s/shatter.ts";
import { shock } from "./s/shock.ts";
import { signInBlood } from "./s/sign-in-blood.ts";
import { solemnOffering } from "./s/solemn-offering.ts";
import { spinedWurm } from "./s/spined-wurm.ts";
import { swamp } from "./s/swamp.ts";
import { tempestOfLight } from "./t/tempest-of-light.ts";
import { tendrilsOfCorruption } from "./t/tendrils-of-corruption.ts";
import { terramorphicExpanse } from "./t/terramorphic-expanse.ts";
import { tomeScour } from "./t/tome-scour.ts";
import { traumatize } from "./t/traumatize.ts";
import { undeadSlayer } from "./u/undead-slayer.ts";
import { unsummon } from "./u/unsummon.ts";
import { vampireAristocrat } from "./v/vampire-aristocrat.ts";
import { volcanicHammer } from "./v/volcanic-hammer.ts";
import { windstorm } from "./w/windstorm.ts";

export const CARD_DEFS: readonly CardDef[] = [
  acolyteOfXathrid,
  angelsMercy,
  assassinate,
  blindingMage,
  bountifulHarvest,
  burningInquiry,
  cancel,
  celestialPurge,
  centaurCourser,
  consumeSpirit,
  coralMerfolk,
  crawWurm,
  deathmark,
  diabolicTutor,
  disentomb,
  divination,
  divineVerdict,
  doomBlade,
  duress,
  earthquake,
  eliteVanguard,
  elvishPiper,
  essenceScatter,
  excommunicate,
  fabricate,
  fireball,
  fireElemental,
  flashfreeze,
  forest,
  furnaceWhelp,
  giantGrowth,
  giantSpider,
  goblinArtillery,
  grayOgre,
  grizzlyBears,
  hauntingEchoes,
  hillGiant,
  igniteDisorder,
  island,
  lavaAxe,
  lightningBolt,
  llanowarElves,
  merfolkLooter,
  mindRot,
  mindShatter,
  mindSpring,
  mountain,
  naturalize,
  naturesSpiral,
  negate,
  ornithopter,
  plains,
  planarCleansing,
  ponder,
  pyroclasm,
  ragingGoblin,
  rampantGrowth,
  righteousness,
  rodOfRuin,
  royalAssassin,
  seismicStrike,
  shatter,
  shock,
  signInBlood,
  solemnOffering,
  spinedWurm,
  swamp,
  tempestOfLight,
  tendrilsOfCorruption,
  terramorphicExpanse,
  tomeScour,
  traumatize,
  undeadSlayer,
  unsummon,
  vampireAristocrat,
  volcanicHammer,
  windstorm,
];
