import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FullscreenButton } from "../FullscreenButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FullscreenButton", () => {
  it("wires the browser's fullscreen state", () => {
    const addEventListener = vi.spyOn(document, "addEventListener");

    const view = render(<FullscreenButton variant="chrome" />);

    expect(view.getByRole("button")).toBeInTheDocument();
    expect(addEventListener).toHaveBeenCalledWith("fullscreenchange", expect.any(Function));
  });
});
