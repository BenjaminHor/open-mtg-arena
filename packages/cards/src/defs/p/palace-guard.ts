import type { CardDef } from "@mtg/engine";

export const palaceGuard: CardDef = {
  name: "Palace Guard",
  oracle: "This creature can block any number of creatures.",
  statics: [{ kind: "canBlockAnyNumber" }],
};
