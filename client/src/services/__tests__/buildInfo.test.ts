import { afterEach, expect, it, vi } from "vitest";

import { displayedBuildHash } from "../buildInfo";

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  { previewBuild: false, expected: null },
  { previewBuild: true, expected: __BUILD_HASH__ },
])("shows the build hash only in a preview build (previewBuild=$previewBuild)", ({ previewBuild, expected }) => {
  vi.stubGlobal("__IS_PREVIEW_BUILD__", previewBuild);
  expect(displayedBuildHash()).toBe(expected);
});
