/** Load the visual-pack backend lazily, so its IndexedDB and Cache Storage code
 *  is evaluated only when something needs it. */
let visualPackBackendPromise: Promise<import("./visualPacks/backend.ts").VisualPackBackend | null> | null = null;

export function loadVisualPackBackend(): Promise<import("./visualPacks/backend.ts").VisualPackBackend | null> {
  if (!visualPackBackendPromise) {
    visualPackBackendPromise = import("./visualPacks/backendFactory.ts")
      .then(({ createVisualPackBackend }) => createVisualPackBackend())
      .catch((error) => {
        visualPackBackendPromise = null;
        throw error;
      });
  }
  return visualPackBackendPromise;
}
