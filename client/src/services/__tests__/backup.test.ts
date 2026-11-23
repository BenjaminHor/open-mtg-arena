import { beforeEach, describe, expect, it } from "vitest";
import { testSavedDeckTxn } from "../../test/helpers/webLocks";

import {
  applyBackup,
  buildBackup,
  importBackupFromFile,
  type PhaseBackupV1,
} from "../backup";
import {
  DECK_METADATA_KEY,
  DECK_FOLDERS_KEY,
  DRAFT_WORKSPACE_PREFERENCES_KEY,
  getDeckMeta,
  STORAGE_KEY_PREFIX,
} from "../../constants/storage";

beforeEach(() => {
  localStorage.clear();
});

const FOLDERS_JSON = JSON.stringify([{ id: "f1", name: "Control", order: 0 }]);

const backupWithoutWorkspacePreferences = (): PhaseBackupV1 => ({
  version: 1,
  exportedAt: new Date(0).toISOString(),
  preferences: null,
  decks: {},
  deckMetadata: null,
  activeDeck: null,
  feedSubscriptions: null,
  feedDeckOrigins: null,
});

describe("backup — draft workspace preferences", () => {
  it("round-trips valid noncanonical JSON bytes through V1 build and apply", () => {
    const raw = `{ "schemaVersion" : 1, "explicitView" : null }\n`;
    localStorage.setItem(DRAFT_WORKSPACE_PREFERENCES_KEY, raw);

    const backup = buildBackup();
    expect(backup.version).toBe(1);
    expect(backup.draftWorkspacePreferences).toBe(raw);

    localStorage.clear();
    applyBackup(testSavedDeckTxn, backup, "overwrite");
    expect(localStorage.getItem(DRAFT_WORKSPACE_PREFERENCES_KEY)).toBe(raw);
  });

  it("preserves merge state and clears overwrite state when an old V1 omits the field", () => {
    const raw = JSON.stringify({ schemaVersion: 1 });
    const oldBackup = backupWithoutWorkspacePreferences();
    localStorage.setItem(DRAFT_WORKSPACE_PREFERENCES_KEY, raw);

    applyBackup(testSavedDeckTxn, oldBackup, "merge");
    expect(localStorage.getItem(DRAFT_WORKSPACE_PREFERENCES_KEY)).toBe(raw);

    applyBackup(testSavedDeckTxn, oldBackup, "overwrite");
    expect(localStorage.getItem(DRAFT_WORKSPACE_PREFERENCES_KEY)).toBeNull();
  });

  it.each(["merge", "overwrite"] as const)(
    "reports malformed preferences without writing them in %s mode",
    (mode) => {
      const prior = JSON.stringify({ schemaVersion: 1 });
      const backup = {
        ...backupWithoutWorkspacePreferences(),
        draftWorkspacePreferences: "{ malformed",
      };
      localStorage.setItem(DRAFT_WORKSPACE_PREFERENCES_KEY, prior);

      const result = applyBackup(testSavedDeckTxn, backup, mode);

      expect(result.malformedKeys).toContain(DRAFT_WORKSPACE_PREFERENCES_KEY);
      expect(localStorage.getItem(DRAFT_WORKSPACE_PREFERENCES_KEY))
        .toBe(mode === "merge" ? prior : null);
    },
  );

  it("validates an old V1 file that omits the optional field", async () => {
    const file = new File(
      [JSON.stringify(backupWithoutWorkspacePreferences())],
      "phase-backup.json",
      { type: "application/json" },
    );

    const result = await importBackupFromFile(file, "merge");
    expect(result.malformedKeys).toEqual([]);
  });
});

describe("backup — deck folders", () => {
  it("round-trips the folder registry through build + apply", () => {
    localStorage.setItem(DECK_FOLDERS_KEY, FOLDERS_JSON);
    localStorage.setItem(
      STORAGE_KEY_PREFIX + "Deck A",
      JSON.stringify({ main: [], sideboard: [] }),
    );

    const backup = buildBackup();
    expect(backup.deckFolders).toBe(FOLDERS_JSON);

    localStorage.clear();
    applyBackup(testSavedDeckTxn, backup, "overwrite");
    expect(localStorage.getItem(DECK_FOLDERS_KEY)).toBe(FOLDERS_JSON);
  });

  it("overwrite-importing a pre-folders backup clears the local folder registry", () => {
    // An old backup object predates the feature: no `deckFolders` field.
    const oldBackup: PhaseBackupV1 = {
      version: 1,
      exportedAt: new Date(0).toISOString(),
      preferences: null,
      decks: {},
      deckMetadata: null,
      activeDeck: null,
      feedSubscriptions: null,
      feedDeckOrigins: null,
    };
    localStorage.setItem(DECK_FOLDERS_KEY, JSON.stringify([{ id: "stale", name: "Stale", order: 0 }]));

    applyBackup(testSavedDeckTxn, oldBackup, "overwrite");

    // Cleared by the overwrite sweep; the absent field writes nothing back.
    expect(localStorage.getItem(DECK_FOLDERS_KEY)).toBeNull();
  });

  it("validates a pre-folders backup file that omits deckFolders entirely", async () => {
    const json = JSON.stringify({
      version: 1,
      exportedAt: new Date(0).toISOString(),
      preferences: null,
      decks: { "Deck A": JSON.stringify({ main: [], sideboard: [] }) },
      deckMetadata: null,
      activeDeck: null,
      feedSubscriptions: null,
      feedDeckOrigins: null,
    });
    const file = new File([json], "phase-backup.json", { type: "application/json" });

    const result = await importBackupFromFile(file, "merge");
    expect(result.decksImported).toBe(1);
  });
});

describe("applyBackup — draft autosave ownership (merge mode)", () => {
  it("strips ownership only from decks the import loop skipped as already held locally", () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + "X", "local-bytes");
    const backup: PhaseBackupV1 = {
      version: 1,
      exportedAt: new Date(0).toISOString(),
      preferences: null,
      decks: { X: JSON.stringify({ main: [], sideboard: [] }), Y: JSON.stringify({ main: [], sideboard: [] }) },
      deckMetadata: JSON.stringify({
        X: { addedAt: 1, autosaveSlot: "Sealed" },
        Y: { addedAt: 1, autosaveSlot: "Quick" },
      }),
      activeDeck: null,
      feedSubscriptions: null,
      feedDeckOrigins: null,
    };

    const result = applyBackup(testSavedDeckTxn, backup, "merge");

    expect(result.decksImported).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY_PREFIX + "X")).toBe("local-bytes");
    expect(getDeckMeta("X")?.autosaveSlot).toBeUndefined();
    expect(getDeckMeta("Y")?.autosaveSlot).toBe("Quick");
  });

  it("strips ownership from a local deck whose backup metadata names it even when the backup's decks lack it", () => {
    // Orphaned/foreign metadata: the backup's metadata mentions a name the
    // backup's own `decks` does not carry.
    localStorage.setItem(STORAGE_KEY_PREFIX + "[Autosave] Sealed", JSON.stringify({ main: [{ name: "Mine", count: 1 }], sideboard: [] }));
    const backup: PhaseBackupV1 = {
      version: 1,
      exportedAt: new Date(0).toISOString(),
      preferences: null,
      decks: { Other: "other-bytes" },
      deckMetadata: JSON.stringify({
        "[Autosave] Sealed": { addedAt: 1, autosaveSlot: "Sealed" },
        Other: { addedAt: 2 },
      }),
      activeDeck: null,
      feedSubscriptions: null,
      feedDeckOrigins: null,
    };

    applyBackup(testSavedDeckTxn, backup, "merge");

    expect(getDeckMeta("[Autosave] Sealed")?.autosaveSlot).toBeUndefined();
    // The backup's other metadata entry still wrote through: this proves the
    // stripping ran on the imported metadata, not that nothing was written.
    expect(getDeckMeta("Other")).not.toBeNull();
  });

  it("strips ownership from every locally-held name regardless of other entries' validity", () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + "X", "local-bytes");
    localStorage.setItem(STORAGE_KEY_PREFIX + "W", "local-bytes-2");
    const backup: PhaseBackupV1 = {
      version: 1,
      exportedAt: new Date(0).toISOString(),
      preferences: null,
      decks: {},
      deckMetadata: JSON.stringify({
        X: { addedAt: 1, autosaveSlot: "Sealed" },
        W: { addedAt: 1, autosaveSlot: "Bogus" },
        Z: { addedAt: "not a number" },
      }),
      activeDeck: null,
      feedSubscriptions: null,
      feedDeckOrigins: null,
    };

    applyBackup(testSavedDeckTxn, backup, "merge");

    const raw = JSON.parse(localStorage.getItem(DECK_METADATA_KEY) ?? "{}");
    expect("autosaveSlot" in raw.X).toBe(false);
    expect("autosaveSlot" in raw.W).toBe(false);
    // The invalid sibling entry still made it through unmodified: proves the
    // backup's metadata was actually written, not silently rejected.
    expect(raw.Z).toEqual({ addedAt: "not a number" });
  });

  it("keeps the backup's marker on an import with nothing held locally", () => {
    const backup: PhaseBackupV1 = {
      version: 1,
      exportedAt: new Date(0).toISOString(),
      preferences: null,
      decks: { Y: JSON.stringify({ main: [], sideboard: [] }) },
      deckMetadata: JSON.stringify({ Y: { addedAt: 1, autosaveSlot: "Quick" } }),
      activeDeck: null,
      feedSubscriptions: null,
      feedDeckOrigins: null,
    };

    applyBackup(testSavedDeckTxn, backup, "merge");

    expect(getDeckMeta("Y")?.autosaveSlot).toBe("Quick");
  });
});
