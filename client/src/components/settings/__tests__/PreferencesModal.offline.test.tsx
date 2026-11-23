import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../../services/backup", () => ({
  downloadBackup: vi.fn(),
  importBackupFromFile: vi.fn(),
}));

import { PreferencesModal } from "../PreferencesModal";

function renderPreferences() {
  render(<PreferencesModal onClose={vi.fn()} initialTab="data" />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PreferencesModal offline controls", () => {
  it("places offline preparation first in Data, before card images and backup", () => {
    renderPreferences();

    const offlinePreparation = screen.getByRole("heading", { name: "Offline preparation" });
    const visualPacks = screen.getByRole("heading", { name: "Offline card images" });
    const data = screen.getByRole("heading", { name: "Backup & Restore" });
    expect(offlinePreparation.compareDocumentPosition(visualPacks) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(visualPacks.compareDocumentPosition(data) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
