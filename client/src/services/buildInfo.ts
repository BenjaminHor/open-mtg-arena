/**
 * The commit hash shown beside the version in the UI: only in a build made with
 * PREVIEW_BUILD=true; other builds show the bare version. Diagnostic reports
 * still embed `__BUILD_HASH__` directly.
 */
export function displayedBuildHash(): string | null {
  return __IS_PREVIEW_BUILD__ ? __BUILD_HASH__ : null;
}
