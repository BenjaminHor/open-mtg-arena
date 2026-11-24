import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let releaseConnectivity!: () => void;
  const connectivityLatch = new Promise<void>((resolve) => { releaseConnectivity = resolve; });
  const calls: string[] = [];
  return {
    calls,
    releaseConnectivity,
    initializeConnectivity: vi.fn(async () => {
      calls.push("connectivity-start");
      await connectivityLatch;
      calls.push("connectivity-settled");
    }),
  };
});

vi.mock("../stores/connectivityStore", () => ({ initializeConnectivity: mocks.initializeConnectivity }));
vi.mock("../App", () => ({ App: () => null }));
vi.mock("../polyfills/cryptoRandomUUID", () => ({}));
vi.mock("../i18n", () => ({}));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: () => mocks.calls.push("render") }),
}));
vi.mock("../pwa/registerServiceWorker", () => ({
  registerServiceWorker: () => mocks.calls.push("service-worker"),
}));
vi.mock("../pwa/chunkReloadHandler", () => ({
  installChunkReloadHandler: () => mocks.calls.push("chunk-handler"),
}));

it("settles connectivity before rendering or registrations", async () => {
  await import("../main");
  await vi.waitFor(() => expect(mocks.calls).toContain("connectivity-start"));
  expect(mocks.calls).toEqual(["connectivity-start"]);

  mocks.releaseConnectivity();
  await vi.waitFor(() => expect(mocks.calls).toContain("chunk-handler"));
  expect(mocks.calls).toEqual([
    "connectivity-start",
    "connectivity-settled",
    "render",
    "service-worker",
    "chunk-handler",
  ]);
});
