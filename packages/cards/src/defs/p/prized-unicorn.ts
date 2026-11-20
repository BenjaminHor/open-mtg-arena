import type { CardDef } from "@mtg/engine";

export const prizedUnicorn: CardDef = {
  name: "Prized Unicorn",
  oracle: "All creatures able to block this creature do so.",
  statics: [{ kind: "mustBeBlockedByAllAble" }],
};
