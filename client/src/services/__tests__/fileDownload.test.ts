import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("downloadBlob", () => {
  /** Every click in the order it happened. */
  let calls: string[] = [];

  async function fileDownload() {
    return import("../fileDownload.ts");
  }

  beforeEach(() => {
    vi.resetModules();
    calls = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "showSaveFilePicker");
  });

  function stubAnchorDownload(onClick?: () => void) {
    let downloadedBlob: Blob | null = null;
    let downloadedName: string | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      downloadedBlob = blob as Blob;
      return "blob:mock-url";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      calls.push("click");
      downloadedName = this.download;
      onClick?.();
    });
    return {
      blob: () => downloadedBlob,
      filename: () => downloadedName,
    };
  }

  it("writes through the save picker when it succeeds", async () => {
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }));
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: showSaveFilePicker,
    });
    const blob = new Blob(["data"], { type: "text/plain" });
    const { downloadBlob } = await fileDownload();

    const result = await downloadBlob("notes.txt", blob, [
      { description: "Text", accept: { "text/plain": [".txt"] } },
    ]);

    // The picker writes wherever the user pointed it and never says where.
    expect(result).toStrictEqual({ kind: "saved", filename: "notes.txt" });
    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "notes.txt",
      types: [{ description: "Text", accept: { "text/plain": [".txt"] } }],
    });
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalledOnce();
  });

  it("falls back to an anchor download when the picker fails", async () => {
    // Chrome exposes showSaveFilePicker but the picker path can fail there;
    // the download must then degrade to the plain anchor path Firefox uses.
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn(async () => {
        throw new DOMException("The picker is unavailable", "SecurityError");
      }),
    });
    const anchor = stubAnchorDownload();
    const blob = new Blob(["data"], { type: "text/plain" });
    const { downloadBlob } = await fileDownload();

    const result = await downloadBlob("notes.txt", blob);

    expect(result).toStrictEqual({ kind: "saved", filename: "notes.txt" });
    expect(anchor.filename()).toBe("notes.txt");
    expect(anchor.blob()).toBe(blob);
  });

  it("reports an anchor download by the filename it asked for", async () => {
    const anchor = stubAnchorDownload();
    const { downloadBlob } = await fileDownload();

    const result = await downloadBlob("notes.txt", new Blob(["data"]));

    // No path: a browser cannot learn one, and claiming one would be a lie.
    expect(result).toStrictEqual({ kind: "saved", filename: "notes.txt" });
    expect(anchor.filename()).toBe("notes.txt");
  });

  it("does not download when the user cancels the picker", async () => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn(async () => {
        throw new DOMException("The user aborted a request", "AbortError");
      }),
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const { downloadBlob } = await fileDownload();

    const err = await downloadBlob("notes.txt", new Blob(["data"])).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it.each(["createWritable", "write", "close"] as const)(
    "rejects without an anchor download when %s fails on the picked file",
    async (failingStep) => {
      // Once a destination is chosen it may already be empty or partial, so a
      // failed write must surface as a failure, not as a fallback "success".
      const streamError = new DOMException("Write failed", "NoModificationAllowedError");
      const steps = {
        createWritable: vi.fn(async () => {}),
        write: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      };
      steps[failingStep].mockRejectedValueOnce(streamError);
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: vi.fn(async () => ({
          createWritable: async () => {
            await steps.createWritable();
            return { write: steps.write, close: steps.close };
          },
        })),
      });
      const anchor = stubAnchorDownload();
      const { downloadBlob } = await fileDownload();

      await expect(downloadBlob("notes.txt", new Blob(["data"]))).rejects.toBe(streamError);

      expect(steps[failingStep]).toHaveBeenCalledOnce();
      expect(anchor.filename()).toBeNull();
    },
  );
});
