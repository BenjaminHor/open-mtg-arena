// Public API of the engine. See docs/architecture.md, "Engine API".
// Nothing is exported here without a reason in docs/decisions.md.

/** The current `GameState.version` (docs/architecture.md), so hosts can reject saves from another schema. See D-019. */
export const ENGINE_VERSION = 0;
