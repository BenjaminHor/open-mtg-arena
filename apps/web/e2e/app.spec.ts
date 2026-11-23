// The web app end to end: it loads, the match worker plays a real round trip, a fixture board draws, and it still
// works after an offline reload. Runs against the production build (playwright.config.ts). Card art comes from
// Scryfall at runtime (D-007); the tests block it, so they never need the network and see the art-less frames.

import { expect, type Page, test } from "@playwright/test";

type Board = {
  cards: {
    name: string;
    zone: string;
    mine: boolean;
    badges?: { counter: string | null; loyalty: number | null; icons: string[] };
  }[];
  backs: unknown[];
};

const board = (page: Page) => page.evaluate(() => (window as unknown as { __board?: Board }).__board ?? null);
const artShown = (page: Page) =>
  page.evaluate(() => (window as unknown as { __artShown?: () => string[] }).__artShown?.() ?? []);

/** A 1×1 PNG, served in place of every art crop: the art path runs without the network. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.route("https://cards.scryfall.io/**", (route) => route.abort());
});

test("loads a match and plays the person's first decision through the worker", async ({ page }) => {
  await page.goto("/?seed=7");
  // The mulligan is asked in the prompt, with Arena's buttons: "Keep 7", "Mulligan".
  await expect(page.getByRole("button", { name: /^Keep \d/ })).toBeVisible();
  await expect.poll(async () => (await board(page))?.cards.filter((c) => c.zone === "hand").length).toBe(7);
  await page.getByRole("button", { name: /^Keep \d/ }).click();
  // The worker applied the keep and played on until the person's next decision: the mulligan is gone, the game is
  // into its first turn (the phase ladder shows), and the main button has something to say.
  await expect(page.getByRole("button", { name: /^Keep \d/ })).toHaveCount(0);
  await expect(page.getByRole("list", { name: /turn$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Next|Pass|Resolve)/ })).toBeVisible();
});

test("draws a fixture board: permanents, the hand, the opponent's hand as backs, life totals", async ({ page }) => {
  await page.goto("/?fixture=mid-game");
  await expect(page.getByRole("img", { name: "Your life 17" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Opponent's life 14" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Your turn" })).toBeVisible();
  const drawn = await board(page);
  expect(drawn?.cards.filter((c) => c.zone === "hand").map((c) => c.name)).toContain("Shivan Dragon");
  expect(drawn?.cards.some((c) => c.name === "Elite Vanguard" && !c.mine)).toBe(true);
  expect(drawn?.backs).toHaveLength(4);
});

test("opens the hand with a tap, and closes it with another", async ({ page }) => {
  await page.goto("/?fixture=mid-game");
  const handTop = async () => {
    const b = await page.evaluate(
      () => (window as unknown as { __board?: { height: number; cards: { zone: string; y: number }[] } }).__board,
    );
    const ys = (b?.cards ?? []).filter((c) => c.zone === "hand").map((c) => c.y);
    return ys.length === 0 ? null : Math.min(...ys) / (b?.height ?? 1);
  };
  await expect.poll(handTop).toBeGreaterThan(0.8);
  await page.getByRole("button", { name: "Open your hand" }).click();
  // Open, the cards rise well up the screen to be read [R].
  await expect.poll(handTop).toBeLessThan(0.7);
  // A tap on the table, away from every card, puts it down again.
  await page.mouse.click(400, 190);
  await expect.poll(handTop).toBeGreaterThan(0.8);
});

test.describe("card art", () => {
  // The page's requests for art are answered by `page.route` below. Once a service worker controls the page (it can,
  // after the reload), Playwright can't route its requests any more and they'd go to the real image host.
  test.use({ serviceWorkers: "block" });

  test("draws each card's art when it loads, and the art-less frame when it can't", async ({ page }) => {
    await page.goto("/?fixture=mid-game");
    await expect(page.getByRole("img", { name: "Your life 17" })).toBeVisible();
    // The image host is blocked (beforeEach): every card keeps its fallback frame.
    await page.waitForTimeout(300);
    expect(await artShown(page)).toEqual([]);

    await page.unroute("https://cards.scryfall.io/**");
    await page.route("https://cards.scryfall.io/**", (route) =>
      route.fulfill({ body: PIXEL, contentType: "image/png", headers: { "access-control-allow-origin": "*" } }),
    );
    await page.reload();
    await expect.poll(async () => (await board(page))?.cards.length ?? 0).toBeGreaterThan(0);
    const drawn = (await board(page))?.cards.length ?? 0;
    // Every card in the fixture is a real card, so each one gets its art.
    // A busy CI runner with software WebGL can take several seconds to decode and draw them all.
    await expect.poll(async () => (await artShown(page)).length, { timeout: 15_000 }).toBe(drawn);
  });
});

test("draws the badges board: a permanent's keywords, counters and loyalty, and no badges in hand", async ({
  page,
}) => {
  await page.goto("/?fixture=badges");
  await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible();
  await expect
    .poll(async () => (await board(page))?.cards.find((c) => c.name === "Grizzly Bears")?.badges?.counter)
    .toBe("+2");
  const cards = (await board(page))?.cards ?? [];
  expect(cards.find((c) => c.name === "Garruk Wildspeaker")?.badges?.loyalty).toBe(3);
  expect(cards.find((c) => c.name === "Serra Angel" && c.zone === "hand")?.badges?.icons).toEqual([]);
});

test("shows a refusal rather than hanging: an unknown deck in the address", async ({ page }) => {
  await page.goto("/?deck=no-such-deck");
  await expect(page.getByRole("alert")).toContainText("no prebuilt deck");
});

test("works offline once it has loaded (the service worker)", async ({ page, context }) => {
  await page.goto("/?seed=7");
  await expect(page.getByRole("button", { name: /^Keep \d/ })).toBeVisible();
  // Wait until the service worker controls the page, so everything it precached is in its cache.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Keep \d/ })).toBeVisible();
  await expect.poll(async () => (await board(page))?.cards.length ?? 0).toBeGreaterThan(0);
});
