// Every card definition, one per card in pool.txt. A test checks the two lists match exactly.

import type { CardDef } from "@mtg/engine";
import { acolyteOfXathrid } from "./a/acolyte-of-xathrid.ts";
import { airElemental } from "./a/air-elemental.ts";
import { angelsMercy } from "./a/angels-mercy.ts";
import { assassinate } from "./a/assassinate.ts";
import { birdsOfParadise } from "./b/birds-of-paradise.ts";
import { blindingMage } from "./b/blinding-mage.ts";
import { bountifulHarvest } from "./b/bountiful-harvest.ts";
import { burningInquiry } from "./b/burning-inquiry.ts";
import { cancel } from "./c/cancel.ts";
import { canyonMinotaur } from "./c/canyon-minotaur.ts";
import { celestialPurge } from "./c/celestial-purge.ts";
import { centaurCourser } from "./c/centaur-courser.ts";
import { childOfNight } from "./c/child-of-night.ts";
import { consumeSpirit } from "./c/consume-spirit.ts";
import { coralMerfolk } from "./c/coral-merfolk.ts";
import { crawWurm } from "./c/craw-wurm.ts";
import { deadlyRecluse } from "./d/deadly-recluse.ts";
import { deathmark } from "./d/deathmark.ts";
import { diabolicTutor } from "./d/diabolic-tutor.ts";
import { disentomb } from "./d/disentomb.ts";
import { disorient } from "./d/disorient.ts";
import { divination } from "./d/divination.ts";
import { divineVerdict } from "./d/divine-verdict.ts";
import { doomBlade } from "./d/doom-blade.ts";
import { duress } from "./d/duress.ts";
import { earthquake } from "./e/earthquake.ts";
import { eliteVanguard } from "./e/elite-vanguard.ts";
import { elvishPiper } from "./e/elvish-piper.ts";
import { enormousBaloth } from "./e/enormous-baloth.ts";
import { essenceScatter } from "./e/essence-scatter.ts";
import { excommunicate } from "./e/excommunicate.ts";
import { fabricate } from "./f/fabricate.ts";
import { fieryHellhound } from "./f/fiery-hellhound.ts";
import { fireElemental } from "./f/fire-elemental.ts";
import { fireball } from "./f/fireball.ts";
import { flashfreeze } from "./f/flashfreeze.ts";
import { forest } from "./f/forest.ts";
import { furnaceWhelp } from "./f/furnace-whelp.ts";
import { giantGrowth } from "./g/giant-growth.ts";
import { giantSpider } from "./g/giant-spider.ts";
import { goblinArtillery } from "./g/goblin-artillery.ts";
import { goblinPiker } from "./g/goblin-piker.ts";
import { grayOgre } from "./g/gray-ogre.ts";
import { griffinSentinel } from "./g/griffin-sentinel.ts";
import { grizzlyBears } from "./g/grizzly-bears.ts";
import { hauntingEchoes } from "./h/haunting-echoes.ts";
import { hillGiant } from "./h/hill-giant.ts";
import { hornedTurtle } from "./h/horned-turtle.ts";
import { igniteDisorder } from "./i/ignite-disorder.ts";
import { island } from "./i/island.ts";
import { kelinoreBat } from "./k/kelinore-bat.ts";
import { lavaAxe } from "./l/lava-axe.ts";
import { lightningBolt } from "./l/lightning-bolt.ts";
import { lightningElemental } from "./l/lightning-elemental.ts";
import { llanowarElves } from "./l/llanowar-elves.ts";
import { loomingShade } from "./l/looming-shade.ts";
import { merfolkLooter } from "./m/merfolk-looter.ts";
import { mightOfOaks } from "./m/might-of-oaks.ts";
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
import { prodigalPyromancer } from "./p/prodigal-pyromancer.ts";
import { pyroclasm } from "./p/pyroclasm.ts";
import { ragingGoblin } from "./r/raging-goblin.ts";
import { rampantGrowth } from "./r/rampant-growth.ts";
import { razorfootGriffin } from "./r/razorfoot-griffin.ts";
import { righteousness } from "./r/righteousness.ts";
import { rodOfRuin } from "./r/rod-of-ruin.ts";
import { royalAssassin } from "./r/royal-assassin.ts";
import { runeclawBear } from "./r/runeclaw-bear.ts";
import { seismicStrike } from "./s/seismic-strike.ts";
import { serraAngel } from "./s/serra-angel.ts";
import { shatter } from "./s/shatter.ts";
import { shivanDragon } from "./s/shivan-dragon.ts";
import { shock } from "./s/shock.ts";
import { siegeMastodon } from "./s/siege-mastodon.ts";
import { signInBlood } from "./s/sign-in-blood.ts";
import { silvercoatLion } from "./s/silvercoat-lion.ts";
import { snappingDrake } from "./s/snapping-drake.ts";
import { solemnOffering } from "./s/solemn-offering.ts";
import { spinedWurm } from "./s/spined-wurm.ts";
import { stampedingRhino } from "./s/stampeding-rhino.ts";
import { stormfrontPegasus } from "./s/stormfront-pegasus.ts";
import { swamp } from "./s/swamp.ts";
import { tempestOfLight } from "./t/tempest-of-light.ts";
import { tendrilsOfCorruption } from "./t/tendrils-of-corruption.ts";
import { terramorphicExpanse } from "./t/terramorphic-expanse.ts";
import { tomeScour } from "./t/tome-scour.ts";
import { traumatize } from "./t/traumatize.ts";
import { undeadSlayer } from "./u/undead-slayer.ts";
import { unsummon } from "./u/unsummon.ts";
import { vampireAristocrat } from "./v/vampire-aristocrat.ts";
import { viashinoSpearhunter } from "./v/viashino-spearhunter.ts";
import { volcanicHammer } from "./v/volcanic-hammer.ts";
import { warpathGhoul } from "./w/warpath-ghoul.ts";
import { windDrake } from "./w/wind-drake.ts";
import { windstorm } from "./w/windstorm.ts";
import { yawningFissure } from "./y/yawning-fissure.ts";
import { zephyrSprite } from "./z/zephyr-sprite.ts";
import { zombieGoliath } from "./z/zombie-goliath.ts";

export const CARD_DEFS: readonly CardDef[] = [
  acolyteOfXathrid,
  airElemental,
  angelsMercy,
  assassinate,
  birdsOfParadise,
  blindingMage,
  bountifulHarvest,
  burningInquiry,
  cancel,
  canyonMinotaur,
  celestialPurge,
  centaurCourser,
  childOfNight,
  consumeSpirit,
  coralMerfolk,
  crawWurm,
  deadlyRecluse,
  deathmark,
  diabolicTutor,
  disentomb,
  disorient,
  divination,
  divineVerdict,
  doomBlade,
  duress,
  earthquake,
  eliteVanguard,
  elvishPiper,
  enormousBaloth,
  essenceScatter,
  excommunicate,
  fabricate,
  fieryHellhound,
  fireball,
  fireElemental,
  flashfreeze,
  forest,
  furnaceWhelp,
  giantGrowth,
  giantSpider,
  goblinArtillery,
  goblinPiker,
  grayOgre,
  griffinSentinel,
  grizzlyBears,
  hauntingEchoes,
  hillGiant,
  hornedTurtle,
  igniteDisorder,
  island,
  kelinoreBat,
  lavaAxe,
  lightningBolt,
  lightningElemental,
  llanowarElves,
  loomingShade,
  merfolkLooter,
  mightOfOaks,
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
  prodigalPyromancer,
  pyroclasm,
  ragingGoblin,
  rampantGrowth,
  razorfootGriffin,
  righteousness,
  rodOfRuin,
  royalAssassin,
  runeclawBear,
  seismicStrike,
  serraAngel,
  shatter,
  shivanDragon,
  shock,
  siegeMastodon,
  signInBlood,
  silvercoatLion,
  snappingDrake,
  solemnOffering,
  spinedWurm,
  stampedingRhino,
  stormfrontPegasus,
  swamp,
  tempestOfLight,
  tendrilsOfCorruption,
  terramorphicExpanse,
  tomeScour,
  traumatize,
  undeadSlayer,
  unsummon,
  vampireAristocrat,
  viashinoSpearhunter,
  volcanicHammer,
  warpathGhoul,
  windDrake,
  windstorm,
  yawningFissure,
  zephyrSprite,
  zombieGoliath,
];
