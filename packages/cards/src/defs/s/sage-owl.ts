import type { CardDef } from "@mtg/engine";

export const sageOwl: CardDef = {
  name: "Sage Owl",
  oracle:
    "Flying\nWhen this creature enters, look at the top four cards of your library, then put them back in any order.",
  keywords: ["flying"],
  triggers: [{ when: { kind: "selfEnters" }, targets: [], effects: [{ op: "lookAtTop", count: 4 }] }],
};
