// The "turn your phone" prompt's rule (ui.md, "Layouts"): a phone held upright, by the viewport alone.

import { describe, expect, it } from "vitest";
import { isPortraitPhone } from "../src/app/orientation.ts";

describe("a phone in portrait", () => {
  it("is upright and narrower than a phone in landscape", () => {
    expect(isPortraitPhone(375, 812)).toBe(true);
    expect(isPortraitPhone(390, 844)).toBe(true);
  });

  it("isn't the same phone turned sideways, a desktop, or an upright tablet or unfolded Duo", () => {
    expect(isPortraitPhone(812, 375)).toBe(false);
    expect(isPortraitPhone(1280, 720)).toBe(false);
    expect(isPortraitPhone(832, 884)).toBe(false);
    expect(isPortraitPhone(768, 1024)).toBe(false);
  });
});
