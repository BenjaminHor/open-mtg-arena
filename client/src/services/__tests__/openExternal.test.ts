import { afterEach, describe, expect, it, vi } from "vitest";

import { openExternal } from "../openExternal";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("direct external-link routing", () => {
  it.each([
    "https://",
    "/relative",
    "file:///tmp/card.txt",
    "mailto:player@example.com",
    "tel:+123456",
    "phase://deck/1",
  ])("rejects %s before the browser is reached", (url) => {
    const browserOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    openExternal(url);
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it("uses the exact browser window.open contract for HTTPS", () => {
    const browserOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    openExternal("https://example.com/cards");
    expect(browserOpen).toHaveBeenCalledWith(
      "https://example.com/cards",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
