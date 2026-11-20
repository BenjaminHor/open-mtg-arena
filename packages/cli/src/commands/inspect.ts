// `inspect <file> <ref>`: one permanent's computed characteristics and what produced them (layer 7c changes), plus
// its status and place in combat.

import {
  type CardDatabase,
  characteristics,
  type LayerSevenCChange,
  layerSevenCChanges,
  type ObjectId,
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
    `  colors: ${c.colors.length > 0 ? c.colors.join("") : "colorless"}; keywords: ${c.keywords.length > 0 ? c.keywords.join(", ") : "none"}`,
    `  controller: ${c.controller}; owner: ${obj.owner}`,
  ];
  if (c.power !== null && c.toughness !== null) {
    lines.push(`  power/toughness: ${c.power}/${c.toughness}`);
    lines.push(`    printed: ${data?.printed.power}/${data?.printed.toughness}`);
    for (const change of layerSevenCChanges(state, id, cards)) lines.push(`    layer 7c: ${changeText(change)}`);
  }
  const counters = Object.entries(obj.counters).map(([k, n]) => `${n} ${k}`);
  lines.push(
    `  status: ${obj.tapped ? "tapped" : "untapped"}; damage ${obj.damage}; counters: ${counters.length > 0 ? counters.join(", ") : "none"}`,
  );
  lines.push(`  under its controller's control since their turn began: ${obj.controlledSinceTurnStart ? "yes" : "no"}`);
  const attack = state.combat?.attacks.find((a) => a.attacker === id);
  if (attack !== undefined) lines.push(`  attacking ${attack.defender}`);
  const blocks = (state.combat?.blocks ?? []).filter((b) => b.blocker === id);
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
