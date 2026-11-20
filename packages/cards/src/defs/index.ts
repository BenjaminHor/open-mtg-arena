// Every card definition, one per card in pool.txt. A test checks the two lists match exactly.

import type { CardDef } from "@mtg/engine";
import { acidicSlime } from "./a/acidic-slime.ts";
import { acolyteOfXathrid } from "./a/acolyte-of-xathrid.ts";
import { airElemental } from "./a/air-elemental.ts";
import { alluringSiren } from "./a/alluring-siren.ts";
import { angelsFeather } from "./a/angels-feather.ts";
import { angelsMercy } from "./a/angels-mercy.ts";
import { assassinate } from "./a/assassinate.ts";
import { ballLightning } from "./b/ball-lightning.ts";
import { berserkersOfBloodRidge } from "./b/berserkers-of-blood-ridge.ts";
import { birdsOfParadise } from "./b/birds-of-paradise.ts";
import { blindingMage } from "./b/blinding-mage.ts";
import { bogWraith } from "./b/bog-wraith.ts";
import { bogardanHellkite } from "./b/bogardan-hellkite.ts";
import { borderlandRanger } from "./b/borderland-ranger.ts";
import { bountifulHarvest } from "./b/bountiful-harvest.ts";
import { brambleCreeper } from "./b/bramble-creeper.ts";
import { burningInquiry } from "./b/burning-inquiry.ts";
import { cancel } from "./c/cancel.ts";
import { canyonMinotaur } from "./c/canyon-minotaur.ts";
import { capriciousEfreet } from "./c/capricious-efreet.ts";
import { celestialPurge } from "./c/celestial-purge.ts";
import { centaurCourser } from "./c/centaur-courser.ts";
import { childOfNight } from "./c/child-of-night.ts";
import { consumeSpirit } from "./c/consume-spirit.ts";
import { coralMerfolk } from "./c/coral-merfolk.ts";
import { crawWurm } from "./c/craw-wurm.ts";
import { cudgelTroll } from "./c/cudgel-troll.ts";
import { darksteelColossus } from "./d/darksteel-colossus.ts";
import { deadlyRecluse } from "./d/deadly-recluse.ts";
import { deathmark } from "./d/deathmark.ts";
import { demonsHorn } from "./d/demons-horn.ts";
import { diabolicTutor } from "./d/diabolic-tutor.ts";
import { disentomb } from "./d/disentomb.ts";
import { disorient } from "./d/disorient.ts";
import { divination } from "./d/divination.ts";
import { divineVerdict } from "./d/divine-verdict.ts";
import { doomBlade } from "./d/doom-blade.ts";
import { dragonWhelp } from "./d/dragon-whelp.ts";
import { dragonsClaw } from "./d/dragons-claw.ts";
import { dragonskullSummit } from "./d/dragonskull-summit.ts";
import { dreadWarlock } from "./d/dread-warlock.ts";
import { drownedCatacomb } from "./d/drowned-catacomb.ts";
import { drudgeSkeletons } from "./d/drudge-skeletons.ts";
import { duress } from "./d/duress.ts";
import { earthquake } from "./e/earthquake.ts";
import { eliteVanguard } from "./e/elite-vanguard.ts";
import { elvishPiper } from "./e/elvish-piper.ts";
import { elvishVisionary } from "./e/elvish-visionary.ts";
import { emeraldOryx } from "./e/emerald-oryx.ts";
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
import { glacialFortress } from "./g/glacial-fortress.ts";
import { goblinArtillery } from "./g/goblin-artillery.ts";
import { goblinPiker } from "./g/goblin-piker.ts";
import { gravedigger } from "./g/gravedigger.ts";
import { grayOgre } from "./g/gray-ogre.ts";
import { griffinSentinel } from "./g/griffin-sentinel.ts";
import { grizzlyBears } from "./g/grizzly-bears.ts";
import { hauntingEchoes } from "./h/haunting-echoes.ts";
import { hillGiant } from "./h/hill-giant.ts";
import { hornedTurtle } from "./h/horned-turtle.ts";
import { howlingBanshee } from "./h/howling-banshee.ts";
import { howlingMine } from "./h/howling-mine.ts";
import { hypnoticSpecter } from "./h/hypnotic-specter.ts";
import { igniteDisorder } from "./i/ignite-disorder.ts";
import { illusionaryServant } from "./i/illusionary-servant.ts";
import { infernoElemental } from "./i/inferno-elemental.ts";
import { island } from "./i/island.ts";
import { jackalFamiliar } from "./j/jackal-familiar.ts";
import { kalonianBehemoth } from "./k/kalonian-behemoth.ts";
import { kelinoreBat } from "./k/kelinore-bat.ts";
import { krakensEye } from "./k/krakens-eye.ts";
import { lavaAxe } from "./l/lava-axe.ts";
import { lightningBolt } from "./l/lightning-bolt.ts";
import { lightningElemental } from "./l/lightning-elemental.ts";
import { lightwielderPaladin } from "./l/lightwielder-paladin.ts";
import { llanowarElves } from "./l/llanowar-elves.ts";
import { loomingShade } from "./l/looming-shade.ts";
import { lurkingPredators } from "./l/lurking-predators.ts";
import { manabarbs } from "./m/manabarbs.ts";
import { megrim } from "./m/megrim.ts";
import { merfolkLooter } from "./m/merfolk-looter.ts";
import { mesaEnchantress } from "./m/mesa-enchantress.ts";
import { mightOfOaks } from "./m/might-of-oaks.ts";
import { mindRot } from "./m/mind-rot.ts";
import { mindShatter } from "./m/mind-shatter.ts";
import { mindSpring } from "./m/mind-spring.ts";
import { mistLeopard } from "./m/mist-leopard.ts";
import { mountain } from "./m/mountain.ts";
import { naturalize } from "./n/naturalize.ts";
import { naturesSpiral } from "./n/natures-spiral.ts";
import { negate } from "./n/negate.ts";
import { ornithopter } from "./o/ornithopter.ts";
import { palaceGuard } from "./p/palace-guard.ts";
import { panicAttack } from "./p/panic-attack.ts";
import { phantomWarrior } from "./p/phantom-warrior.ts";
import { plains } from "./p/plains.ts";
import { planarCleansing } from "./p/planar-cleansing.ts";
import { polymorph } from "./p/polymorph.ts";
import { ponder } from "./p/ponder.ts";
import { prizedUnicorn } from "./p/prized-unicorn.ts";
import { prodigalPyromancer } from "./p/prodigal-pyromancer.ts";
import { pyroclasm } from "./p/pyroclasm.ts";
import { ragingGoblin } from "./r/raging-goblin.ts";
import { rampantGrowth } from "./r/rampant-growth.ts";
import { razorfootGriffin } from "./r/razorfoot-griffin.ts";
import { regenerate } from "./r/regenerate.ts";
import { righteousness } from "./r/righteousness.ts";
import { rodOfRuin } from "./r/rod-of-ruin.ts";
import { rootboundCrag } from "./r/rootbound-crag.ts";
import { royalAssassin } from "./r/royal-assassin.ts";
import { runeclawBear } from "./r/runeclaw-bear.ts";
import { sageOwl } from "./s/sage-owl.ts";
import { sanguineBond } from "./s/sanguine-bond.ts";
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
import { soulWarden } from "./s/soul-warden.ts";
import { sparkmageApprentice } from "./s/sparkmage-apprentice.ts";
import { spinedWurm } from "./s/spined-wurm.ts";
import { stampedingRhino } from "./s/stampeding-rhino.ts";
import { stormfrontPegasus } from "./s/stormfront-pegasus.ts";
import { sunpetalGrove } from "./s/sunpetal-grove.ts";
import { swamp } from "./s/swamp.ts";
import { tempestOfLight } from "./t/tempest-of-light.ts";
import { tendrilsOfCorruption } from "./t/tendrils-of-corruption.ts";
import { terramorphicExpanse } from "./t/terramorphic-expanse.ts";
import { tomeScour } from "./t/tome-scour.ts";
import { traumatize } from "./t/traumatize.ts";
import { undeadSlayer } from "./u/undead-slayer.ts";
import { underworldDreams } from "./u/underworld-dreams.ts";
import { unsummon } from "./u/unsummon.ts";
import { vampireAristocrat } from "./v/vampire-aristocrat.ts";
import { viashinoSpearhunter } from "./v/viashino-spearhunter.ts";
import { volcanicHammer } from "./v/volcanic-hammer.ts";
import { wallOfBone } from "./w/wall-of-bone.ts";
import { wallOfFaith } from "./w/wall-of-faith.ts";
import { wallOfFire } from "./w/wall-of-fire.ts";
import { warpathGhoul } from "./w/warpath-ghoul.ts";
import { windDrake } from "./w/wind-drake.ts";
import { windstorm } from "./w/windstorm.ts";
import { wurmsTooth } from "./w/wurms-tooth.ts";
import { xathridDemon } from "./x/xathrid-demon.ts";
import { yawningFissure } from "./y/yawning-fissure.ts";
import { zephyrSprite } from "./z/zephyr-sprite.ts";
import { zombieGoliath } from "./z/zombie-goliath.ts";

export const CARD_DEFS: readonly CardDef[] = [
  acidicSlime,
  acolyteOfXathrid,
  airElemental,
  alluringSiren,
  angelsFeather,
  angelsMercy,
  assassinate,
  ballLightning,
  berserkersOfBloodRidge,
  birdsOfParadise,
  blindingMage,
  bogWraith,
  bogardanHellkite,
  borderlandRanger,
  bountifulHarvest,
  brambleCreeper,
  burningInquiry,
  cancel,
  canyonMinotaur,
  capriciousEfreet,
  celestialPurge,
  centaurCourser,
  childOfNight,
  consumeSpirit,
  coralMerfolk,
  crawWurm,
  cudgelTroll,
  darksteelColossus,
  deadlyRecluse,
  deathmark,
  demonsHorn,
  diabolicTutor,
  disentomb,
  disorient,
  divination,
  divineVerdict,
  doomBlade,
  dragonWhelp,
  dragonsClaw,
  dragonskullSummit,
  dreadWarlock,
  drownedCatacomb,
  drudgeSkeletons,
  duress,
  earthquake,
  eliteVanguard,
  elvishPiper,
  elvishVisionary,
  emeraldOryx,
  enormousBaloth,
  essenceScatter,
  excommunicate,
  fabricate,
  fieryHellhound,
  fireElemental,
  fireball,
  flashfreeze,
  forest,
  furnaceWhelp,
  giantGrowth,
  giantSpider,
  glacialFortress,
  goblinArtillery,
  goblinPiker,
  gravedigger,
  grayOgre,
  griffinSentinel,
  grizzlyBears,
  hauntingEchoes,
  hillGiant,
  hornedTurtle,
  howlingBanshee,
  howlingMine,
  hypnoticSpecter,
  igniteDisorder,
  illusionaryServant,
  infernoElemental,
  island,
  jackalFamiliar,
  kalonianBehemoth,
  kelinoreBat,
  krakensEye,
  lavaAxe,
  lightningBolt,
  lightningElemental,
  lightwielderPaladin,
  llanowarElves,
  loomingShade,
  lurkingPredators,
  manabarbs,
  megrim,
  merfolkLooter,
  mesaEnchantress,
  mightOfOaks,
  mindRot,
  mindShatter,
  mindSpring,
  mistLeopard,
  mountain,
  naturalize,
  naturesSpiral,
  negate,
  ornithopter,
  palaceGuard,
  panicAttack,
  phantomWarrior,
  plains,
  planarCleansing,
  polymorph,
  ponder,
  prizedUnicorn,
  prodigalPyromancer,
  pyroclasm,
  ragingGoblin,
  rampantGrowth,
  razorfootGriffin,
  regenerate,
  righteousness,
  rodOfRuin,
  rootboundCrag,
  royalAssassin,
  runeclawBear,
  sageOwl,
  sanguineBond,
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
  soulWarden,
  sparkmageApprentice,
  spinedWurm,
  stampedingRhino,
  stormfrontPegasus,
  sunpetalGrove,
  swamp,
  tempestOfLight,
  tendrilsOfCorruption,
  terramorphicExpanse,
  tomeScour,
  traumatize,
  undeadSlayer,
  underworldDreams,
  unsummon,
  vampireAristocrat,
  viashinoSpearhunter,
  volcanicHammer,
  wallOfBone,
  wallOfFaith,
  wallOfFire,
  warpathGhoul,
  windDrake,
  windstorm,
  wurmsTooth,
  xathridDemon,
  yawningFissure,
  zephyrSprite,
  zombieGoliath,
];
