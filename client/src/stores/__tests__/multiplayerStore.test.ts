import { beforeEach, describe, expect, it } from "vitest";

import { getOpponentDisplayName, getPlayerDisplayName, useMultiplayerStore } from "../multiplayerStore";

describe("multiplayerStore seat identities", () => {
  beforeEach(() => {
    useMultiplayerStore.setState({ playerNames: new Map(), playerAvatars: new Map() });
  });

  it("names a seat by its assigned name", () => {
    useMultiplayerStore.setState({ playerNames: new Map([[1, "Jace"]]) });
    expect(getOpponentDisplayName(1)).toBe("Jace");
  });

  it("falls back to a seat-numbered label when no name is assigned", () => {
    expect(getOpponentDisplayName(2)).not.toBe("");
    expect(getOpponentDisplayName(2)).not.toBe(getOpponentDisplayName(1));
  });

  it("calls the viewer's own seat 'you'", () => {
    useMultiplayerStore.setState({ playerNames: new Map([[0, "Chandra"]]) });
    expect(getPlayerDisplayName(0, 0)).not.toBe("Chandra");
    expect(getPlayerDisplayName(0, 1)).toBe("Chandra");
  });
});
