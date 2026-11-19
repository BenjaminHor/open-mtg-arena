import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../src/index.ts";

// A placeholder so the test pipeline runs end to end. M1-03 replaces it with real tests.
describe("engine package", () => {
  it("exports a numeric schema version", () => {
    expect(typeof ENGINE_VERSION).toBe("number");
  });
});
