// An ability's own text (M3-04c slice 6): Arena draws an ability on the stack as a card-shaped panel with "the ability
// text" [R: arena-research.md §5]. The engine keeps a card's Oracle text whole, not a text per ability, so the line is
// picked from it: activated abilities in the order printed (D-028: `{ kind: "printed", index }` counts them so), and
// triggered ones likewise. test/ability-text.test.ts checks every ability in the pool finds a line whose cost agrees
// with its definition; anything it can't place gets null, and the caller shows the whole text.

import type { AbilityRef, SeenAbility } from "@mtg/engine";

/** The ability's line of its card's Oracle text, reminder text left out, or null when no line is it. */
export function abilityText(oracle: string, ref: AbilityRef): string | null {
  switch (ref.kind) {
    case "printed":
      return activatedLines(oracle)[ref.index] ?? null;
    case "triggered":
      return triggeredLines(oracle)[ref.index] ?? null;
    // Made by an effect, written on no line of its own (CR 603.7); a land's "{T}: Add" is implied by its type (CR
    // 305.6), and a mana ability never uses the stack anyway (CR 605.3b).
    case "delayed":
    case "basicLandType":
      return null;
  }
}

/** A card's activated abilities' lines, in printed order (D-028), reminder text left out. */
export function activatedLines(oracle: string): string[] {
  return oracle.split("\n").map(withoutReminder).filter(isActivated);
}

/** A card's triggered abilities' lines, in printed order. */
export function triggeredLines(oracle: string): string[] {
  return oracle.split("\n").map(withoutReminder).filter(isTriggered);
}

/** What kind of ability it is, as a panel's type line says: activated (CR 602) or triggered (CR 603). */
export function abilityKind(ability: SeenAbility): string {
  switch (ability.ability.kind) {
    case "printed":
    case "basicLandType":
      return "Activated ability";
    case "triggered":
      return "Triggered ability";
    case "delayed":
      return "Delayed triggered ability";
  }
}

/** Reminder text, in parentheses, isn't rules text (CR 207.2). */
function withoutReminder(line: string): string {
  return line.replace(/\s*\([^)]*\)/g, "").trim();
}

/**
 * "[Cost]: [Effect]" (CR 602.1): a line whose cost comes before the first colon (and before any quoted ability a token
 * would have), or a keyword that is an activated ability, Equip (CR 702.6a). A loyalty cost is a signed number (CR
 * 606.4).
 */
function isActivated(line: string): boolean {
  if (/^Equip\b/.test(line)) return true;
  const colon = line.indexOf(":");
  if (colon < 0) return false;
  const quote = line.indexOf('"');
  if (quote >= 0 && quote < colon) return false;
  const cost = line.slice(0, colon);
  return /^(\{|[+−-]?\d|[+−-]X|Sacrifice|Remove|Tap|Exile|Discard|Pay)/.test(cost);
}

/** "When", "Whenever" or "At" begins a triggered ability (CR 603.1). */
function isTriggered(line: string): boolean {
  return /^(When|Whenever|At)\b/.test(line);
}
