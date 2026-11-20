import type { CardDef } from "@mtg/engine";

export const igniteDisorder: CardDef = {
  name: "Ignite Disorder",
  oracle:
    "Ignite Disorder deals 3 damage divided as you choose among one, two, or three target white and/or blue creatures.",
  spell: {
    // One instance of "target" with one to three targets (CR 601.2c); "white and/or blue" is either color or both.
    targets: [{ kind: "permanent", filter: { types: ["creature"], colors: ["W", "U"] }, count: { min: 1, max: 3 } }],
    // The division is announced as it's cast, at least 1 to each target (CR 601.2d).
    effects: [{ op: "dealDamage", amount: 3, from: "self", to: { target: 0 }, divided: "asYouChoose" }],
  },
};
