// `brief` for people: the `Brief` data as plain text, one object per line (M2-15f). Everything shown comes from the
// data, so it matches `brief --json` exactly. `withText` adds each card's Oracle text under it.

import type { ActionInfo } from "./action-info.ts";
import type { Brief, PlayerBrief } from "./brief.ts";
import type { CardInfo, PermanentInfo, StackInfo } from "./brief-objects.ts";

export function briefText(brief: Brief, withText: boolean): string {
  const lines = [headline(brief), decisionLine(brief), ""];
  // The viewer at the bottom, as across a table: the others first.
  const [you, ...others] = brief.players;
  for (const p of others) lines.push(...playerLines(p, brief, withText), "");
  lines.push(...stackLines(brief.stack, withText), "");
  if (you !== undefined) lines.push(...playerLines(you, brief, withText), "");
  if (brief.exile.length > 0) lines.push(`exile: ${brief.exile.map((c) => c.name).join(", ")}`, "");
  lines.push("since you last acted:", ...(brief.recent.length === 0 ? ["  (nothing)"] : brief.recent.map(indent)));
  if (brief.actions.length > 0) lines.push("", ...actionLines(brief.actions));
  return lines.join("\n");
}

/**
 * The viewer's actions, one line each, with cost, a payability hint and legal targets. Actions with the same text
 * (two copies of a card in hand) share a line that keeps every number; mana abilities go on one line at the end.
 */
function actionLines(actions: readonly ActionInfo[]): string[] {
  const lines = [
    "your actions: `pnpm cli do <file> <n>`, or a step that also chooses and pays,",
    '  such as `pnpm cli do <file> "cast: Shock, targets: [p2], pay: auto"`:',
  ];
  const shown = new Map<string, number[]>();
  for (const a of actions) if (!a.mana) shown.set(a.text, [...(shown.get(a.text) ?? []), a.n]);
  for (const [text, numbers] of shown) {
    const a = actions[(numbers[0] as number) - 1] as ActionInfo;
    const also = numbers.length > 1 ? ` (same as ${numbers.slice(1).join(", ")})` : "";
    const cost = a.cost === null ? "" : ` — ${a.cost}${a.payable === false ? " (not enough mana now)" : ""}`;
    lines.push(`${String(a.n).padStart(3)}. ${text}${cost}${also}`);
    for (const [i, choices] of a.targets.entries()) {
      const label = a.targets.length > 1 ? `target ${i + 1}` : "targets";
      lines.push(`       ${label}: ${choices.length === 0 ? "(none legal now)" : choices.join(", ")}`);
    }
  }
  const mana = actions.filter((a) => a.mana);
  if (mana.length > 0) lines.push(`  mana abilities: ${mana.map((a) => `${a.n}. ${a.text}`).join("; ")}`);
  return lines;
}

function headline(brief: Brief): string {
  const t = brief.turn;
  if (t === null) return "Before the first turn";
  const next = t.nextStep === null ? "the next turn" : t.nextStep;
  return `Turn ${t.number} · ${t.activePlayer}'s turn · ${t.step} (next: ${next})`;
}

function decisionLine(brief: Brief): string {
  const r = brief.result;
  if (r !== null) {
    const losses = r.losses.map((l) => `${l.player}: ${l.reason}`).join(", ");
    return `Game over: ${r.winner === null ? "a draw" : `${r.winner} wins`} (${losses}).`;
  }
  const w = brief.waitingFor;
  if (w === null) return `You are ${brief.viewer}.`;
  if (w.player === brief.viewer) return `You are ${brief.viewer}. You decide: ${w.kind}.`;
  return `You are ${brief.viewer}. Waiting for ${w.player} (${w.kind}).`;
}

function playerLines(p: PlayerBrief, brief: Brief, withText: boolean): string[] {
  const you = p.id === brief.viewer ? " (you)" : "";
  const pool = Object.entries(p.manaPool)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `{${t}}`.repeat(n))
    .join("");
  const lines = [
    `${p.id}${you}  life ${p.life} · hand ${p.handSize} · library ${p.librarySize} · mana available ${p.manaAvailable}` +
      `${pool === "" ? "" : ` (pool ${pool})`} · lands played this turn ${p.landsPlayedThisTurn}`,
  ];
  lines.push(`  battlefield:${p.battlefield.length === 0 ? " (none)" : ""}`);
  for (const perm of p.battlefield) lines.push(`    - ${permanentLine(perm)}`, ...textLines(perm, withText));
  if (p.hand !== null) {
    lines.push(`  hand:${p.hand.length === 0 ? " (empty)" : ""}`);
    // Copies of one card are folded into one line; the JSON keeps each card and its id.
    for (const [c, n] of folded(p.hand))
      lines.push(`    - ${cardLine(c)}${n > 1 ? ` (x${n})` : ""}`, ...textLines(c, withText));
  } else if (p.revealedHand !== null) {
    lines.push(`  hand (revealed): ${p.revealedHand.join(", ")}`);
  }
  if (p.revealedTop !== null) lines.push(`  library top (revealed): ${p.revealedTop}`);
  if (p.graveyard.length > 0) lines.push(`  graveyard (bottom to top): ${p.graveyard.map((c) => c.name).join(", ")}`);
  return lines;
}

/** `Lightning Bolt {R} · Instant`. */
function cardLine(c: CardInfo): string {
  return `${c.name}${c.manaCost === null ? "" : ` ${c.manaCost}`} · ${c.typeLine}`;
}

/** `Grizzly Bears 2/2 · Creature — Bear [p2:Grizzly Bears] (tapped, sick, 1 damage, flying, attacking p1)`. */
function permanentLine(p: PermanentInfo): string {
  const pt = p.power !== null && p.toughness !== null ? ` ${p.power}/${p.toughness}` : "";
  const notes: string[] = [];
  if (p.token) notes.push("token");
  if (p.owner !== p.controller) notes.push(`owned by ${p.owner}`);
  if (p.tapped) notes.push("tapped");
  if (p.summoningSick) notes.push("summoning sick");
  if (p.damage > 0) notes.push(`${p.damage} damage`);
  for (const [counter, n] of Object.entries(p.counters))
    if (n > 0) notes.push(`${n} ${counter} counter${n > 1 ? "s" : ""}`);
  notes.push(...p.keywords);
  if (p.attachedTo !== null) notes.push(`attached to ${p.attachedTo}`);
  if (p.chosen !== null) notes.push(`chose ${p.chosen}`);
  if (p.attacking !== null) notes.push(`attacking ${p.attacking}`);
  if (p.blocking.length > 0) notes.push(`blocking ${p.blocking.join(", ")}`);
  const ref = p.ref === p.name ? "" : ` [${p.ref}]`;
  return `${p.name}${pt} · ${p.typeLine}${ref}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
}

function stackLines(stack: readonly StackInfo[], withText: boolean): string[] {
  if (stack.length === 0) return ["stack: (empty)"];
  const lines = ["stack (the last resolves first):"];
  for (const [i, s] of stack.entries()) {
    const targets = s.targets.length > 0 ? ` → ${s.targets.join(", ")}` : "";
    const x = s.x === null ? "" : ` X=${s.x}`;
    lines.push(`  ${i + 1}. ${s.name}${x}${targets} (${s.kind}, ${s.controller})`, ...textLines(s, withText));
  }
  return lines;
}

function textLines(c: { text: string; typeLine?: string }, withText: boolean): string[] {
  // A basic land's text is only its mana ability's reminder (CR 305.6), already plain from its type.
  if (!withText || c.text === "" || c.typeLine?.startsWith("Basic Land") === true) return [];
  return c.text.split("\n").map((line) => `        ${line}`);
}

/** Each card once, with how many have its name, in the order first seen. */
function folded(hand: readonly CardInfo[]): [CardInfo, number][] {
  const counts = new Map<string, [CardInfo, number]>();
  for (const c of hand) {
    const entry = counts.get(c.name);
    counts.set(c.name, entry === undefined ? [c, 1] : [entry[0], entry[1] + 1]);
  }
  return [...counts.values()];
}

function indent(line: string): string {
  return `  ${line}`;
}
