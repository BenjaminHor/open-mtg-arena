// Checks that the hand-written definitions agree with the card data. Run by the tests, so `pnpm check` fails
// when Scryfall's Oracle text changes (errata) or a card is missing a definition (docs/card-scripting.md).

import {
  type AbilityDef,
  type CardDef,
  type Color,
  type Effect,
  type EffectSubject,
  isFixedAmount,
  type ObjectFilter,
  type StaticAbilityDef,
  type TargetSpec,
  type TriggeredAbilityDef,
} from "@mtg/engine";
import { conditionalEffects, delayedAbilities, flatEffects } from "./flat-effects.ts";
import type { PoolCard } from "./pool-data.ts";
import { triggerWordProblems, triggerWordProblemsOf } from "./trigger-words.ts";

/** Keyword actions (CR 701) Scryfall lists among a card's keywords, as the pool's cards use them; add each as it comes. */
const KEYWORD_ACTIONS: readonly string[] = ["mill", "regenerate"];
/**
 * Generic terms Scryfall lists beside the keyword itself, which name no ability of their own: "Landwalk" beside
 * "Swampwalk" (CR 702.14a), and "Heal" beside "Regenerate", from its reminder text's "heal all damage on it".
 */
const GENERIC_TERMS: readonly string[] = ["landwalk", "heal"];

/** The filter a static ability has that the layer pass reads, if any (others are read by rules checks, outside it). */
function passFilter(s: StaticAbilityDef): ObjectFilter | null {
  switch (s.kind) {
    case "creaturesGet":
      return s.filter;
    case "powerToughnessEachEqual":
      return s.to === "yourLifeTotal" ? null : s.to.count;
    case "attachedGets":
      return s.perCount ?? null;
    case "attachedCantAttackOrBlock":
    case "attachedCantBeBlocked":
    case "attachedCantActivate":
    case "attachedDoesntUntap":
    case "attachedControl":
      return null;
    case "cantBeBlocked":
    case "cantAttackUnlessDefenderControls":
    case "noMaximumHandSize":
    case "canBlockAnyNumber":
    case "cantAttackOrBlockAlone":
    case "attacksEachCombat":
    case "mustBeBlockedByAllAble":
    case "cantBeCountered":
    case "plusPerSharedCreatureType":
    case "plusPerOtherSameName":
      return null;
  }
}

/** Every disagreement between the definitions and the pool's card data, as readable messages. Empty when they agree. */
export function definitionProblems(defs: readonly CardDef[], pool: readonly PoolCard[]): string[] {
  const problems: string[] = [];
  const cards = new Map(pool.map((c) => [c.name, c]));
  const defined = new Set<string>();

  for (const def of defs) {
    if (defined.has(def.name)) problems.push(`${def.name}: defined twice`);
    defined.add(def.name);
    const card = cards.get(def.name);
    if (card === undefined) {
      problems.push(`${def.name}: has a definition but isn't in pool.txt / data/pool.json`);
      continue;
    }
    if (def.oracle !== card.oracleText) {
      problems.push(
        `${def.name}: Oracle text changed. Re-read the card, update the definition and its scenarios if the ` +
          `behavior changed, then the oracle field.\n  definition: ${JSON.stringify(def.oracle)}\n  ` +
          `Oracle now:  ${JSON.stringify(card.oracleText)}`,
      );
    }
    // Scryfall lists the card's keywords, which catches a missing "flying" or "reach". Its list also has keyword
    // actions (Mill, Scry: CR 701), which aren't keyword abilities (CR 702), so those are left out, and ability words
    // (Landfall, later: CR 207.2c); see docs/future-rules.md before adding a card with those.
    const expected = card.keywords
      .map((k) => k.toLowerCase())
      .filter((k) => !KEYWORD_ACTIONS.includes(k) && !GENERIC_TERMS.includes(k))
      .sort();
    // Protection's qualities are in `protections`; Scryfall lists just "Protection" (CR 702.16).
    const actual = [
      ...(def.keywords ?? []),
      ...((def.protections?.length ?? 0) > 0 ? ["protection"] : []),
      ...(def.enchant === undefined ? [] : ["enchant"]),
      ...((def.abilities ?? []).some((a) => a.keyword === "equip") ? ["equip"] : []),
    ].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      problems.push(`${def.name}: keywords ${JSON.stringify(actual)}, but Oracle has ${JSON.stringify(expected)}`);
    }
    const protections = protectionProblem(def);
    if (protections !== null) problems.push(protections);
    // "Equip [cost]" means exactly "[cost]: attach this to target creature you control; activate only as a sorcery"
    // (CR 702.6a), so an equip ability scripted any other way is refused.
    for (const a of def.abilities ?? []) {
      if (a.keyword === "equip" && !isEquipShape(a)) problems.push(`${def.name}: an equip ability isn't CR 702.6a's`);
    }
    // A static ability's filter is read inside the layer pass, which knows nothing of combat or a trigger (D-092).
    for (const s of def.statics ?? []) {
      const filter = passFilter(s);
      if (filter !== null && filterUses(filter, (f) => f.combat !== undefined || f.controller === "triggeringPlayer"))
        problems.push(`${def.name}: a static ability's filter can't ask about combat or "that player" (D-092)`);
    }
    // A printed "*" is set by a characteristic-defining ability, and only a "*" is (CR 208.2a, 604.3). The one kind so
    // far sets both, so both must be "*"; any other mix is refused until a card needs it.
    const definesPT = (def.statics ?? []).some((s) => s.kind === "powerToughnessEachEqual");
    const stars = [card.power, card.toughness].filter((v) => v === "*").length;
    if (stars === 1 || (stars === 2) !== definesPT)
      problems.push(`${def.name}: a printed "*" needs an ability that defines it, and that ability needs a "*"`);
    // The same for a token an effect creates (CR 111.3): a "*" only with the ability that sets it, and the reverse;
    // and a token's statics are only that characteristic-defining ability so far (nothing else is read for a token).
    const allEffects = [
      ...(def.spell?.effects ?? []),
      ...(def.abilities ?? []).flatMap((a) => a.effects),
      ...(def.triggers ?? []).flatMap((t) => t.effects),
    ];
    const delayedEffects = delayedOf(def).flatMap(([, delayed]) => delayed.effects);
    for (const e of flatEffects([...allEffects, ...delayedEffects])) {
      if (e.op !== "createTokens") continue;
      const statics = e.token.statics ?? [];
      const tokenDefines = statics.some((s) => s.kind === "powerToughnessEachEqual");
      const tokenStars = [e.token.power, e.token.toughness].filter((v) => v === "*").length;
      if (tokenStars === 1 || (tokenStars === 2) !== tokenDefines)
        problems.push(`${def.name}: a token's "*" needs an ability that defines it, and that ability needs a "*"`);
      if (statics.some((s) => s.kind !== "powerToughnessEachEqual"))
        problems.push(`${def.name}: a token's static abilities are only a characteristic-defining one so far`);
    }
    for (const s of def.statics ?? [])
      if (s.kind === "cantAttackUnlessDefenderControls" && s.filter.controller !== undefined)
        problems.push(`${def.name}: "defending player controls" already says whose permanents are counted`);
    if (def.spell !== undefined)
      problems.push(
        ...targetProblems(def.name, def.spell.targets, def.spell.effects, def.spell.costIncrease !== undefined),
      );
    // "This creature's power" needs a source on the battlefield: a spell has none.
    if (def.spell?.targets.some((t) => t.kind === "permanent" && t.toughnessBelowSourcePower === true))
      problems.push(`${def.name}: toughnessBelowSourcePower is only for a permanent's ability`);
    // "Spend only black mana on X" needs an {X} to restrict.
    if (def.spell?.xPaidWith !== undefined && !card.manaCost.includes("{X}"))
      problems.push(`${def.name}: xPaidWith restricts paying X, but the mana cost has no {X}`);
    if (def.spell !== undefined && anyColor(def.spell.effects))
      problems.push(`${def.name}: mana of any color is only for a mana ability`);
    // Entering with printed loyalty is intrinsic (CR 306.5b): `replacementsOf` adds it, so a written one would apply twice.
    if ((def.replacements ?? []).some((r) => r.kind === "entersWithLoyalty"))
      problems.push(`${def.name}: entersWithLoyalty is intrinsic to a planeswalker; a definition doesn't write it`);
    for (const [i, ability] of (def.abilities ?? []).entries()) {
      // One loyalty symbol per cost (CR 107.7; several would combine, later: CR 606.5); its timing comes from it (CR 606.3).
      const loyaltyParts = ability.cost.filter((p) => p.kind === "loyalty").length;
      if (loyaltyParts > 1) problems.push(`${def.name} ability ${i + 1}: more than one loyalty cost`);
      // One X per ability: [−X] and {X} together would need two (no card has both).
      const minusX = ability.cost.some((p) => p.kind === "loyalty" && p.amount === "minusX");
      const manaX = ability.cost.some((p) => p.kind === "mana" && p.cost.some((s) => s.kind === "x"));
      if (minusX && manaX) problems.push(`${def.name} ability ${i + 1}: both [−X] and {X} in one cost`);
      if (loyaltyParts > 0 && ability.timing !== undefined)
        problems.push(`${def.name} ability ${i + 1}: a loyalty ability's timing comes from its cost (CR 606.3)`);
      if (anyColor(ability.effects) && (ability.targets.length > 0 || ability.cost.some((p) => p.kind !== "tap")))
        problems.push(`${def.name} ability ${i + 1}: mana of any color is only for a mana ability with a {T} cost`);
      problems.push(...targetProblems(`${def.name} ability ${i + 1}`, ability.targets, ability.effects));
      problems.push(...subjectProblems(`${def.name} ability ${i + 1}`, ability.targets, ability.effects));
    }
    if (def.spell !== undefined) problems.push(...subjectProblems(def.name, def.spell.targets, def.spell.effects));
    problems.push(...triggerWordProblems(def));
    if (def.spell !== undefined && countsActivations(def.spell.effects))
      problems.push(`${def.name}: ifActivatedThisTurn is only for an activated ability`);
    for (const [i, trigger] of (def.triggers ?? []).entries())
      problems.push(...triggerProblems(`${def.name} trigger ${i + 1}`, trigger));
    // A delayed triggered ability is checked as its own triggered ability: its effects run apart from the effects that
    // made it, with its own targets and trigger event.
    for (const [where, delayed] of delayedOf(def))
      problems.push(...delayedProblems(where, delayed), ...triggerProblems(where, delayed));
    problems.push(...rememberedProblems(def));
  }
  for (const card of pool) {
    if (!defined.has(card.name)) problems.push(`${card.name}: is in the pool but has no definition`);
  }
  return problems;
}

/** "Add one mana of any color" takes its color from the activation, which only a mana ability has (CR 605.1a, D-068). */
const anyColor = (effects: readonly Effect[]) =>
  flatEffects(effects).some((e) => e.op === "addMana" && e.mana === "anyColor");

/** Only an activated ability has activations to count (D-078). */
const countsActivations = (effects: readonly Effect[]) =>
  flatEffects(effects).some((e) => e.op === "ifActivatedThisTurn");

/** A triggered ability's problems, printed or delayed. */
function triggerProblems(where: string, trigger: TriggeredAbilityDef): string[] {
  return [
    ...(countsActivations(trigger.effects) ? [`${where}: ifActivatedThisTurn is only for an activated ability`] : []),
    ...(anyColor(trigger.effects) ? [`${where}: mana of any color is only for a mana ability`] : []),
    ...targetProblems(where, trigger.targets, trigger.effects),
    ...subjectProblems(where, trigger.targets, trigger.effects),
    ...triggerWordProblemsOf(where, trigger),
  ];
}

/**
 * "That creature" (`"remembered"`) only in a delayed triggered ability whose maker names what it remembers (`about`,
 * CR 603.7c): anywhere else it would name nothing.
 */
function rememberedProblems(def: CardDef): string[] {
  // Any subject field can hold it, so each effect is searched as written, as JSON, without the effects nested in it
  // (a condition's, a delayed ability's), which are checked as their own.
  const own = (e: Effect) => {
    const { effects: _nested, ability: _delayed, ...fields } = e as Effect & { effects?: unknown; ability?: unknown };
    return JSON.stringify(fields).includes('"remembered"');
  };
  const uses = (effects: readonly Effect[]) => flatEffects(effects).some(own);
  const lists = [
    def.spell?.effects ?? [],
    ...(def.abilities ?? []).map((a) => a.effects),
    ...(def.triggers ?? []).map((t) => t.effects),
  ];
  const problems: string[] = [];
  for (const effects of lists) {
    const makers = flatEffects(effects).filter((e) => e.op === "createDelayedTrigger");
    if (uses(effects)) problems.push(`${def.name}: "remembered" is only for a delayed triggered ability`);
    for (const maker of makers)
      if (maker.op === "createDelayedTrigger" && maker.about === undefined && uses(maker.ability.effects))
        problems.push(`${def.name}: a delayed ability that says "that creature" needs its maker's \`about\``);
  }
  return problems;
}

/** Each delayed triggered ability the card's spell, abilities and triggers make, named by what makes it. */
function delayedOf(def: CardDef): [string, TriggeredAbilityDef][] {
  const makers: [string, readonly Effect[]][] = [
    ...(def.spell === undefined ? [] : [[def.name, def.spell.effects] as [string, readonly Effect[]]]),
    ...(def.abilities ?? []).map((a, i): [string, readonly Effect[]] => [`${def.name} ability ${i + 1}`, a.effects]),
    ...(def.triggers ?? []).map((t, i): [string, readonly Effect[]] => [`${def.name} trigger ${i + 1}`, t.effects]),
  ];
  return makers.flatMap(([where, effects]) =>
    delayedAbilities(effects).map((ability): [string, TriggeredAbilityDef] => [`${where} delayed trigger`, ability]),
  );
}

/**
 * What a delayed trigger can't do yet. It waits for the next beginning of anyone's step, with no targets: "your next
 * upkeep" would read its source's controller, and the source may be gone. It has no "intervening if" or "you may":
 * matching it doesn't check one (CR 603.4). Later, with a card that needs them (CR 603.7).
 */
function delayedProblems(where: string, delayed: TriggeredAbilityDef): string[] {
  const waitsForAStep = delayed.when.kind === "beginningOfStep" && delayed.when.whose === "each";
  return waitsForAStep && delayed.targets.length === 0 && delayed.onlyIf === undefined && delayed.optional !== true
    ? []
    : [`${where}: waits for the beginning of anyone's step, with no targets, intervening if or "you may"`];
}

/**
 * Target shapes the engine can't use, caught here rather than in a game: a count whose minimum is above its maximum, and
 * a divided effect that doesn't divide among an instance of "target", or divides less than that instance's minimum,
 * since each target needs at least one (CR 601.2d).
 */
function targetProblems(
  where: string,
  targets: readonly TargetSpec[],
  written: readonly Effect[],
  costIncrease = false,
): string[] {
  const effects = flatEffects(written);
  const problems: string[] = [];
  for (const [i, spec] of targets.entries()) {
    const count = spec.count;
    if (count !== undefined && count.max !== "any" && count.min > count.max)
      problems.push(`${where}: target ${i} has a minimum above its maximum`);
  }
  if (costIncrease && targets.length !== 1)
    problems.push(`${where}: a cost increase per target is only read for a spell with one instance of "target"`);
  for (const effect of effects) {
    // "Can't block" is a rules effect: on targets its set is fixed by them (CR 608.2b), but on "each creature ..." it
    // would apply to creatures arriving later (later: CR 611.2c, 613.11), which nothing reads yet.
    const onTargets = (of: unknown) => typeof of === "object" && of !== null && "target" in of;
    if (
      (effect.op === "cantBlock" || effect.op === "mustAttack" || effect.op === "cantBeBlocked") &&
      !onTargets(effect.of)
    )
      problems.push(`${where}: ${effect.op} applies only to targets until rules effects read their set live`);
    if (effect.op !== "dealDamage" || effect.divided === undefined) continue;
    // A division is announced as it's cast (CR 601.2d), when nothing can be counted yet.
    if (!isFixedAmount(effect.amount)) problems.push(`${where}: a divided amount is a number or X`);
    const spec = typeof effect.to === "object" && "target" in effect.to ? targets[effect.to.target] : undefined;
    if (spec === undefined) {
      problems.push(`${where}: divided damage must divide among an instance of "target"`);
    } else if (
      effect.divided === "asYouChoose" &&
      typeof effect.amount === "number" &&
      (spec.count?.min ?? 1) > effect.amount
    ) {
      problems.push(
        `${where}: divided damage of ${effect.amount} can't give each of at least ${spec.count?.min} targets 1`,
      );
    }
  }
  return problems;
}

/** Ops that act on objects, and the subject each names them with. */
const OBJECT_SUBJECTS: Partial<Record<Effect["op"], (e: Effect) => EffectSubject>> = {
  destroy: (e) => (e as { of: EffectSubject }).of,
  exile: (e) => (e as { of: EffectSubject }).of,
  returnToHand: (e) => (e as { of: EffectSubject }).of,
  putOnTopOfLibrary: (e) => (e as { of: EffectSubject }).of,
  tap: (e) => (e as { of: EffectSubject }).of,
  doesntUntap: (e) => (e as { of: EffectSubject }).of,
  counter: (e) => (e as { of: EffectSubject }).of,
  modifyPT: (e) => (e as { of: EffectSubject }).of,
  reveal: (e) => (e as { of: EffectSubject }).of,
  put: (e) => (e as { of: EffectSubject }).of,
  regenerate: (e) => (e as { of: EffectSubject }).of,
  putCounters: (e) => (e as { of: EffectSubject }).of,
  // What a delayed ability's "that creature" remembers; "self" if it names nothing, which is an object.
  createDelayedTrigger: (e) => (e as { about?: EffectSubject }).about ?? "self",
};

/** Ops that act on players, and the subject each names them with. */
const PLAYER_SUBJECTS: Partial<Record<Effect["op"], (e: Effect) => EffectSubject>> = {
  gainLife: (e) => (e as { who: EffectSubject }).who,
  loseLife: (e) => (e as { who: EffectSubject }).who,
  draw: (e) => (e as { who: EffectSubject }).who,
  discardAtRandom: (e) => (e as { who: EffectSubject }).who,
  mill: (e) => (e as { who: EffectSubject }).who,
  discard: (e) => (e as { who: EffectSubject }).who,
  revealHand: (e) => (e as { who: EffectSubject }).who,
  cantCastSpells: (e) => (e as { who: EffectSubject }).who,
  search: (e) => (e as { library: EffectSubject }).library,
  shuffle: (e) => (e as { who: EffectSubject }).who,
  mayShuffle: (e) => (e as { who: EffectSubject }).who,
  exileGraveyard: (e) => (e as { of: EffectSubject }).of,
  sacrifice: (e) => (e as { who: EffectSubject }).who,
  revealTop: (e) => (e as { who: EffectSubject }).who,
  revealUntil: (e) => (e as { who: EffectSubject }).who,
};

/** The target kinds that are objects, whose controller "its controller" can mean. */
const OBJECT_TARGETS: readonly string[] = ["permanent", "spell", "cardInGraveyard"];

/** Every subject an effect names, in any of its fields. */
function subjectsOf(effect: Effect): EffectSubject[] {
  const isSubject = (v: unknown): v is EffectSubject =>
    typeof v === "object" && v !== null && ("target" in v || "controllerOf" in v || "eachControlledBy" in v);
  const own = Object.values(effect).filter(isSubject);
  // dealDamage's extra recipients ("and") name subjects of their own.
  const extra = effect.op === "dealDamage" ? (effect.and ?? []).map((a) => a.to).filter(isSubject) : [];
  return [...own, ...extra];
}

/**
 * Subjects of the wrong kind, which would quietly do nothing: an op on objects naming a player ("you", "each player", a
 * player target), or an op on players naming an object ("self", an object target).
 */
function subjectProblems(where: string, targets: readonly TargetSpec[], written: readonly Effect[]): string[] {
  const effects = flatEffects(written);
  const problems: string[] = [];
  const targetKind = (s: EffectSubject) =>
    typeof s === "object" && "target" in s ? targets[s.target]?.kind : undefined;
  const playerOnly = (s: EffectSubject) => {
    const kind = targetKind(s);
    return (
      s === "you" ||
      s === "triggeringPlayer" ||
      s === "eachPlayer" ||
      s === "eachOpponent" ||
      (typeof s === "object" && "controllerOf" in s) ||
      kind === "player" ||
      kind === "opponent" ||
      kind === "playerOrPlaneswalker"
    );
  };
  const objectOnly = (s: EffectSubject) => {
    const kind = targetKind(s);
    const each = typeof s === "object" && ("each" in s || "eachControlledBy" in s);
    return (
      s === "self" ||
      s === "found" ||
      s === "triggeringObject" ||
      s === "remembered" ||
      each ||
      kind === "permanent" ||
      kind === "spell" ||
      kind === "cardInGraveyard"
    );
  };
  for (const effect of effects) {
    if (effect.op === "destroyOneAtRandom" && effect.among.some(playerOnly))
      problems.push(`${where}: destroyOneAtRandom is for objects, not players`);
    // The engine reads a division and mana only from an ability's own effects, never from nested ones.
    if (
      conditionalEffects(effect).some(
        (e) => e.op === "addMana" || e.op === "ifNothingSacrificed" || ("divided" in e && e.divided !== undefined),
      )
    )
      problems.push(`${where}: a divided effect, mana or ifNothingSacrificed can't be inside ${effect.op}`);
    // Damage comes from one object (CR 120.2b): never a player, nor "each" of something.
    if (
      effect.op === "dealDamage" &&
      (playerOnly(effect.from) ||
        (typeof effect.from === "object" && ("each" in effect.from || "eachControlledBy" in effect.from)))
    )
      problems.push(`${where}: damage comes from one object`);
    const of = OBJECT_SUBJECTS[effect.op];
    if (of !== undefined && playerOnly(of(effect)))
      problems.push(`${where}: ${effect.op} acts on objects, not players`);
    const who = PLAYER_SUBJECTS[effect.op];
    if (who !== undefined && objectOnly(who(effect)))
      problems.push(`${where}: ${effect.op} is for players, not objects`);
    // A chosen discard waits for one player's choice; several players' would need APNAP order (later: CR 608.2e).
    const onePlayerOps: Effect["op"][] = [
      "discard",
      "search",
      "mayShuffle",
      "exileGraveyard",
      "sacrifice",
      "revealUntil",
    ];
    if (onePlayerOps.includes(effect.op) && PLAYER_SUBJECTS[effect.op]?.(effect) === "eachPlayer")
      problems.push(`${where}: ${effect.op} names one player, not each player`);
    // "That player's next untap step" names one player (or "its controller", each permanent's own).
    if (
      effect.op === "doesntUntap" &&
      effect.during !== "itsController" &&
      (objectOnly(effect.during) || effect.during === "eachPlayer" || effect.during === "eachOpponent")
    )
      problems.push(`${where}: doesntUntap is during one player's untap step`);
    // "The player puts that card onto the battlefield": one player, who'd also be the one asked "you may".
    if (effect.op === "put" && effect.by !== undefined) {
      if (objectOnly(effect.by) || effect.by === "eachPlayer")
        problems.push(`${where}: put is by one player, not ${JSON.stringify(effect.by)}`);
      if (effect.optional === true) problems.push(`${where}: "you may" asks "you", not the player who puts`);
    }
    // "Its controller" reads an object's controller: the target it names must be an object.
    for (const s of subjectsOf(effect))
      if (
        typeof s === "object" &&
        "controllerOf" in s &&
        !OBJECT_TARGETS.includes(targets[s.controllerOf.target]?.kind ?? "")
      )
        problems.push(`${where}: "its controller" names target ${s.controllerOf.target}, which isn't an object`);
    // "Each creature that player or that planeswalker's controller controls": the target names a player or a
    // permanent, and the subject sets the controller itself.
    for (const s of subjectsOf(effect)) {
      if (typeof s !== "object" || !("eachControlledBy" in s)) continue;
      const kind = targets[s.eachControlledBy.target]?.kind ?? "";
      if (!["player", "opponent", "playerOrPlaneswalker", "permanent"].includes(kind))
        problems.push(
          `${where}: eachControlledBy names target ${s.eachControlledBy.target}, which isn't a player or permanent`,
        );
      if (s.filter.controller !== undefined) problems.push(`${where}: eachControlledBy sets the controller itself`);
    }
    // "Found" and "exiled this way" are results of an earlier effect of the same resolution (CR 608.2c).
    const earlier = effects.slice(0, effects.indexOf(effect));
    const names = (s: EffectSubject | undefined) => s === "found";
    const foundNamed = names(OBJECT_SUBJECTS[effect.op]?.(effect)) || names(PLAYER_SUBJECTS[effect.op]?.(effect));
    if (foundNamed && !earlier.some((e) => e.op === "search" || e.op === "revealTop" || e.op === "revealUntil"))
      problems.push(`${where}: ${effect.op} names the cards found, but no search or reveal comes before it`);
    const readsSacrificed =
      effect.op === "ifNothingSacrificed" || ("amount" in effect && effect.amount === "sacrificedPower");
    if (readsSacrificed && !earlier.some((e) => e.op === "sacrifice"))
      problems.push(`${where}: ${effect.op} reads what was sacrificed, but no sacrifice comes before it`);
    if (effect.op === "search" && effect.sameNameAsExiled === true && !earlier.some((e) => e.op === "exileGraveyard"))
      problems.push(`${where}: a search for the cards exiled this way must follow exiling them`);
    // A filter, or "you" choosing from another player's hand, would show or hint at a hidden hand's cards unless it was
    // just revealed (D-062).
    if (effect.op === "discard" && (effect.filter !== undefined || effect.chosenBy !== undefined)) {
      const revealed = effects
        .slice(0, effects.indexOf(effect))
        .some((e) => e.op === "revealHand" && JSON.stringify(e.who) === JSON.stringify(effect.who));
      if (!revealed)
        problems.push(`${where}: a discard with a filter or chosen by "you" must follow revealing that hand`);
    }
  }
  return problems;
}

const COLOR_WORDS: Record<string, Color> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

/**
 * Whether `protections` says what the Oracle text's "protection from A and from B" says (CR 702.16g): colors by
 * their words, creature types by their plural ("Demons"). Null when they agree.
 */
function protectionProblem(def: CardDef): string | null {
  const match = /protection from ([^(.\n]+)/i.exec(def.oracle);
  const words = match?.[1] === undefined ? [] : match[1].split(/,? and from |, from /).map((w) => w.trim());
  const expected = words.map((w) => {
    const color = COLOR_WORDS[w.toLowerCase()];
    return color === undefined ? `subtype ${w.replace(/s$/, "")}` : `color ${color}`;
  });
  const actual = (def.protections ?? []).map((q) => (q.kind === "color" ? `color ${q.color}` : `subtype ${q.subtype}`));
  if (JSON.stringify([...expected].sort()) === JSON.stringify([...actual].sort())) return null;
  return `${def.name}: protections ${JSON.stringify(actual)}, but Oracle has ${JSON.stringify(expected)}`;
}

/** Whether a filter, or the filter inside its `not`, has something `test` looks for. */
function filterUses(filter: ObjectFilter, test: (f: ObjectFilter) => boolean): boolean {
  return test(filter) || (filter.not !== undefined && filterUses(filter.not, test));
}

/** Whether an ability is exactly what "Equip [cost]" means (CR 702.6a), whatever its cost. */
function isEquipShape(a: AbilityDef): boolean {
  const target = a.targets[0];
  const effect = a.effects[0];
  return (
    a.timing === "sorcery" &&
    a.targets.length === 1 &&
    target?.kind === "permanent" &&
    JSON.stringify(target.filter) === JSON.stringify({ types: ["creature"], controller: "you" }) &&
    a.effects.length === 1 &&
    effect?.op === "attachSelf" &&
    JSON.stringify(effect.to) === JSON.stringify({ target: 0 })
  );
}
