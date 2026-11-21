// `inspect <file> <ref>`: one permanent's computed characteristics and what produced them (layer 7c changes), plus
// its status and place in combat.

import {
  type CardDatabase,
  type Characteristics,
  type Color,
  characteristics,
  isAttacking,
  isBlocking,
  type LayerSevenCChange,
  layeredOf,
  layerSevenCChanges,
  type ObjectId,
  type ProtectionQuality,
} from "@mtg/engine";
import { nameOf, parseRef, resolveRef } from "@mtg/scenarios";
import { durationText, objectText } from "../describe.ts";
import { currentState, readGameFile } from "../game-file.ts";

export function inspectCommand(file: string, ref: string | undefined, cards: CardDatabase): string {
  const game = readGameFile(file);
  const state = currentState(game, cards);
  const parsed = ref === undefined ? null : parseRef(ref);
  const id = parsed === null ? null : resolveRef(state, parsed, cards);
  if (id === null) throw new Error(`inspect needs a permanent like "p2:Grizzly Bears" (got ${ref ?? "nothing"})`);
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${ref} isn't a card`);
  const c = characteristics(state, id, cards);
  const data = cards[obj.oracleId];
  const lines = [
    `${objectText(state, id, cards)} (object ${id}, card ${obj.cardId})`,
    `  types: ${[...c.supertypes, ...c.types].join(" ")}${c.subtypes.length > 0 ? ` — ${c.subtypes.join(" ")}` : ""}`,
    `  colors: ${c.colors.length > 0 ? c.colors.join("") : "colorless"}; keywords: ${keywordText(c)}`,
    `  controller: ${c.controller}; owner: ${obj.owner}`,
  ];
  // Keywords granted by effects (layer 6), each with where it came from.
  for (const grant of layeredOf(state, id, cards)?.granted ?? [])
    lines.push(`    granted ${grant.keywords.join(", ")} by ${sourceName(grant.source)}`);
  if (c.power !== null && c.toughness !== null) {
    lines.push(`  power/toughness: ${c.power}/${c.toughness}`);
    const printed = data?.printed;
    const none = printed?.power === null || printed?.toughness === null;
    lines.push(`    printed: ${none ? "none" : `${printed?.power}/${printed?.toughness}`}`);
    // A "*" is set by its characteristic-defining ability: what 7c started from.
    const base = layeredOf(state, id, cards)?.base;
    if (base?.from === "ability") lines.push(`    layer 7a, its ability: ${base.power}/${base.toughness}`);
    if (base?.from === "effect")
      lines.push(`    layer 7b, set by ${sourceName(base.source)}: ${base.power}/${base.toughness}`);
    for (const change of layerSevenCChanges(state, id, cards)) lines.push(`    layer 7c: ${changeText(change)}`);
  }
  const counters = Object.entries(obj.counters).map(([k, n]) => `${n} ${k}`);
  lines.push(
    `  status: ${obj.tapped ? "tapped" : "untapped"}; damage ${obj.damage}; counters: ${counters.length > 0 ? counters.join(", ") : "none"}`,
  );
  lines.push(`  under its controller's control since their turn began: ${obj.controlledSinceTurnStart ? "yes" : "no"}`);
  // Still in combat, not just declared: a regenerated creature has left it (CR 506.4).
  const attack = isAttacking(state, id, cards) ? state.combat?.attacks.find((a) => a.attacker === id) : undefined;
  if (attack !== undefined) lines.push(`  attacking ${attack.defender}`);
  const blocks = isBlocking(state, id, cards) ? (state.combat?.blocks ?? []).filter((b) => b.blocker === id) : [];
  if (blocks.length > 0) lines.push(`  blocking ${blocks.map((b) => objectText(state, b.attacker, cards)).join(", ")}`);
  return lines.join("\n");

  /** One layer 7c change in words. Returns from each case, so a new kind of change fails to compile here. */
  function changeText(change: LayerSevenCChange): string {
    const pt = `${sign(change.power)}/${sign(change.toughness)}`;
    switch (change.kind) {
      case "effect":
        return `${pt} ${durationText(change.duration)}, from ${sourceName(change.source)} (timestamp ${change.timestamp})`;
      case "counters":
        return `${pt} from ${change.count} ${change.counter} counter${change.count === 1 ? "" : "s"}`;
      case "ruleModifier":
        return `${pt} from rule modifier ${change.index + 1} of the game`;
      case "static":
        return `${pt} from ${sourceName(change.source)}'s static ability`;
    }
  }

  function sourceName(source: ObjectId): string {
    return state.objects[source] === undefined
      ? `a spell or ability that's gone (${source})`
      : nameOf(state, source, cards);
  }
}

function sign(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** The keywords, with each protection as "protection from black" or "protection from Demons" (CR 702.16). */
function keywordText(c: Characteristics): string {
  const protections = c.protections.map((q) => `protection from ${qualityText(q)}`);
  const all = [...c.keywords, ...protections];
  return all.length > 0 ? all.join(", ") : "none";
}

const COLOR_WORDS: Record<Color, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

function qualityText(quality: ProtectionQuality): string {
  switch (quality.kind) {
    case "color":
      return COLOR_WORDS[quality.color];
    case "subtype":
      return `${quality.subtype}s`;
  }
}
